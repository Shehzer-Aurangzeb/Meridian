"""
Phase D — the non-linear attempt.

    ../.venv-research/bin/python research/phase_d.py

Phase C combined 39 features with ridge and got 1.01 bp per trade against a
14 bp round trip, indistinguishable from a shuffled control. This is the
non-linear version of the same question, and the plan weights it deliberately:
the model is the smallest part of it.

  D1  the TARGET changes. Phases B and C predicted the raw forward return and
      scored its mean. Crypto returns are fat-tailed, so that mean is set by a
      handful of hours and a squared-error fit spends its capacity on how
      volatile a coin is rather than which way it goes. Two replacements, both
      built in the panel: the return divided by the coin's own ATR, and a
      triple-barrier label (+1 up first, -1 down first, 0 neither).

  D2  the FEATURES change. Trees get interactions and thresholds for free and
      cannot see time at all -- every row is independent to them. So the
      snapshot columns are joined by 4h and 24h deltas, cross-sectional ranks
      beside the z-scores, and market-wide context.

  D3  overlapping labels. A 72-hour label at hour t shares 71 hours with the
      label at t+1. Training is thinned to non-overlapping rows so the model
      sees each stretch of market once; a constant sample weight, which is what
      1/concurrency reduces to on an evenly sampled panel, would have been a
      no-op wearing the name of a fix.

  D4  the model. HistGradientBoosting, shallow and heavily regularised. Trees,
      not a net: 320,000 rows whose effective n is two orders of magnitude
      lower is not deep-learning territory.

  D5  validation is unchanged from Phase C, plus a holdout. Purged K-fold with
      an embargo of one horizon on each side of every test fold, and the last
      six months held out entirely and touched once.

  D6  scoring is unchanged from Phase C, so the numbers are comparable:
      basis points per trade against a 14 bp round trip, with a block-bootstrap
      interval and a shuffled control.

  D7  the bar, written here before any run: net@14 > 0 on the holdout with a
      bootstrap interval that excludes zero. Phase C's [-1.40, 42.28] is the
      reference for what a spike on a sweep looks like; that is not a pass.
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

# Redirected stdout is block-buffered, so a 5-minute run shows nothing until it
# ends and a crash loses the rows already printed.
sys.stdout.reconfigure(line_buffering=True)

RNG = np.random.default_rng(12345)
HORIZONS = [4, 12, 24, 72]
# Round trip in basis points, charged once per closed trade on total capital.
COSTS = [0, 14, 25]
# Above this, a feature's cross-sectional ordering is a coin label rather than a
# forecast. Phase B's gate, and the reason raw openInterest is not in here.
MAX_PERSIST = 0.5
MIN_COVERAGE = 0.9
HOLDOUT_DAYS = 182
# Winsorise the volatility-scaled TRAINING target here, never the P&L.
#
# Dividing the forward return by ATR was meant to tame the tail and made it
# worse: kurtosis 27 becomes 243. The cause is not a tiny-ATR artefact -- the
# 27 rows responsible have a normal ATR and a median absolute 4h move of 19.7%.
# They are real crashes. A squared-error fit will chase 27 rows out of 320,000
# and learn nothing else, so the model does not see past +-5 (kurtosis 2.3).
#
# The book is scored on the raw `fwd{H}h` return throughout, so every one of
# those moves is still paid or suffered in the P&L. Only the lesson is clipped.
WINSOR = 5.0


def load(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, parse_dates=["ts"])
    return df.sort_values(["ts", "coin"]).reset_index(drop=True)


def base_features(df: pd.DataFrame) -> list[str]:
    """Everything that is not a key, a price, a staleness reading or a target."""
    drop = {"coin", "ts", "close"}
    return [
        c
        for c in df.columns
        if c not in drop
        and not c.endswith("_ageMin")
        and not c.startswith(("fwd", "tb"))
    ]


def rank_persistence(df: pd.DataFrame, col: str, lag_hours: int = 30 * 24) -> float:
    """Correlation of a feature's cross-sectional ordering with itself a month on."""
    wide = df.pivot_table(index="ts", columns="coin", values=col)
    if wide.shape[0] <= lag_hours:
        return np.nan
    a = wide.iloc[:-lag_hours:72]
    b = wide.iloc[lag_hours::72]
    n = min(len(a), len(b))
    rs = []
    for i in range(n):
        x, y = a.iloc[i], b.iloc[i]
        ok = x.notna() & y.notna()
        if ok.sum() < 8:
            continue
        r = pd.Series(x[ok]).rank().corr(pd.Series(y[ok]).rank())
        if pd.notna(r):
            rs.append(r)
    return float(np.mean(rs)) if rs else np.nan


def screen(df: pd.DataFrame, cols: list[str]) -> tuple[list[str], list[str]]:
    keep, dropped = [], []
    for c in cols:
        cover = df[c].notna().mean()
        if cover < MIN_COVERAGE:
            dropped.append(f"{c} (coverage {cover:.0%})")
            continue
        p = rank_persistence(df, c)
        if not np.isfinite(p):
            dropped.append(f"{c} (persistence unmeasurable)")
        elif abs(p) >= MAX_PERSIST:
            dropped.append(f"{c} (persistence {p:.2f})")
        else:
            keep.append(c)
    return keep, dropped


def engineer(df: pd.DataFrame, cols: list[str]) -> tuple[pd.DataFrame, list[str], list[str]]:
    """D2. Deltas, cross-sectional ranks, and market context.

    Every column added here is either a difference over that coin's own past or
    a comparison against the other coins at the same instant. Nothing reaches
    forward, and `groupby(coin).shift` is what guarantees it.
    """
    out = df.copy()
    made: list[str] = []

    g = out.groupby("coin", sort=False)
    for c in cols:
        for lag in (4, 24):
            name = f"{c}_d{lag}"
            out[name] = out[c] - g[c].shift(lag)
            made.append(name)

    # Cross-sectional rank in [0, 1]. Robust to the outliers that made Phase B's
    # rank IC point the opposite way to the money.
    byts = out.groupby("ts", sort=False)
    for c in cols:
        name = f"{c}_xr"
        out[name] = byts[c].rank(pct=True)
        made.append(name)

    # Market context: one number per hour, identical across coins, so it cannot
    # say WHICH coin. It lets the model condition on the regime.
    # Built from ATR and funding, never from a forward return. An earlier draft
    # used the cross-sectional spread of `fwd4h` and lagged it to stay legal.
    # It was legal and it was a bad idea: a context column one shift away from
    # the target is one refactor away from being the target.
    out["mkt_atr"] = byts["atrPct"].transform("mean")
    out["mkt_atr_disp"] = byts["atrPct"].transform("std")
    out["mkt_funding"] = byts["fundingRate"].transform("mean")
    out["mkt_book"] = byts["bookImbalanceFar"].transform("mean")
    market = ["mkt_atr", "mkt_atr_disp", "mkt_funding", "mkt_book"]
    made += market

    return out, cols + made, market


def cross_sectional_standardise(
    df: pd.DataFrame, cols: list[str], passthrough: list[str] | None = None
) -> np.ndarray:
    """Centre and scale each feature within each hour, so the market move is gone.

    `passthrough` columns are handed over untouched. The market-context columns
    are identical across coins by construction -- that is what makes them
    context -- so standardising them cross-sectionally is 0/0 and turns each one
    entirely into NaN. sklearn's binner then fails with "window shape cannot be
    larger than input array shape", which is a long way from saying "your column
    is empty". Trees are scale-invariant, so raw is the right answer for these.
    """
    passthrough = passthrough or []
    z_cols = [c for c in cols if c not in passthrough]
    g = df.groupby("ts", sort=False)[z_cols]
    z = (df[z_cols] - g.transform("mean")) / g.transform("std").replace(0, np.nan)
    out = pd.concat([z, df[passthrough]], axis=1)[cols]
    # A column that is empty after this is a column the model cannot use, and
    # finding that out here beats finding it out inside the binner.
    empty = [c for c in cols if not np.isfinite(out[c]).any()]
    if empty:
        raise ValueError(f"all-NaN after standardisation: {', '.join(empty)}")
    return out.to_numpy(dtype=np.float32)


def non_overlapping(ts: pd.Series, horizon: int) -> np.ndarray:
    """D3. Keep one training row per `horizon` hours.

    A 72-hour label at hour t shares 71 of its hours with the label at t+1. The
    textbook fix is to weight each row by 1/concurrency, but on an evenly
    sampled hourly panel every interior row has the same concurrency, and a
    CONSTANT sample weight changes nothing at all -- it is a no-op that looks
    like rigour. Thinning the training set to non-overlapping rows is what
    actually removes the duplication.

    It costs `horizon`-fold training data and buys a model that has seen each
    stretch of market once. Given the effective n here is already one to two
    orders of magnitude below the raw n, the data was never really there.
    """
    hours = ((ts - ts.min()) / pd.Timedelta("1h")).to_numpy().astype(np.int64)
    return hours % horizon == 0


def purged_folds(ts: pd.Series, folds: int, horizon: int):
    """Contiguous calendar folds; training drops `horizon` hours either side.

    Without the purge, a 72-hour forward return stamped one hour before a fold
    boundary carries 71 hours of the test period into training, and every number
    downstream is the model being scored on its own answer.
    """
    hours = ((ts - ts.min()) / pd.Timedelta("1h")).to_numpy()
    span = hours.max() + 1
    per = span / folds
    for f in range(folds):
        lo, hi = f * per, span if f == folds - 1 else (f + 1) * per
        test = (hours >= lo) & (hours < hi)
        train = (hours < lo - horizon) | (hours >= hi + horizon)
        yield train, test


def block_bootstrap(values: np.ndarray, times: np.ndarray, block_days=30, draws=2000):
    if len(values) == 0:
        return np.nan, np.nan
    t0 = times.min()
    key = ((times - t0) / np.timedelta64(1, "D") // block_days).astype(int)
    blocks = [values[key == k] for k in np.unique(key)]
    means = np.empty(draws)
    for i in range(draws):
        pick = RNG.integers(0, len(blocks), len(blocks))
        means[i] = np.concatenate([blocks[j] for j in pick]).mean()
    return float(np.quantile(means, 0.025)), float(np.quantile(means, 0.975))


def score_book(pred: np.ndarray, y: np.ndarray, ts: np.ndarray, horizon: int, k=3):
    """D6. Long the top k coins by forecast, short the bottom k, half capital
    each leg, held `horizon` hours, never overlapping.

    Non-overlapping matters: overlapping holds would report the same move up to
    `horizon` times and make the trade count, and therefore the cost, a fiction.
    """
    frame = pd.DataFrame({"p": pred, "y": y, "ts": ts}).dropna()
    rets, times = [], []
    next_free = None
    for t, grp in frame.groupby("ts", sort=True):
        if len(grp) < 2 * k:
            continue
        if next_free is not None and t < next_free:
            continue
        next_free = t + pd.Timedelta(hours=horizon)
        s = grp.sort_values("p")
        rets.append((s["y"].iloc[-k:].mean() - s["y"].iloc[:k].mean()) / 2)
        times.append(t)
    if not rets:
        return dict(trades=0, gross_bp=np.nan, lo=np.nan, hi=np.nan)
    r = np.array(rets) * 1e4
    lo, hi = block_bootstrap(r, np.array(times, dtype="datetime64[ns]"))
    return dict(trades=len(r), gross_bp=float(r.mean()), lo=lo, hi=hi)


def fit_predict(xtr, ytr, xte, classifier: bool):
    """D4. Shallow trees, strong regularisation. The defaults are deliberate:
    depth 3 and 300 leaves-worth of iterations is already generous for a signal
    that a linear model measured at 1 bp."""
    common = dict(
        max_depth=3,
        max_iter=300,
        learning_rate=0.03,
        min_samples_leaf=200,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.15,
        random_state=12345,
    )
    if classifier:
        m = HistGradientBoostingClassifier(**common)
        m.fit(xtr, ytr)
        # P(up) - P(down). The neutral class carries no directional view, so
        # leaving it out of the score is the point rather than an omission.
        proba = m.predict_proba(xte)
        cls = list(m.classes_)
        up = proba[:, cls.index(1)] if 1 in cls else 0
        dn = proba[:, cls.index(-1)] if -1 in cls else 0
        return up - dn
    m = HistGradientBoostingRegressor(**common)
    m.fit(xtr, ytr)
    return m.predict(xte)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--panel", default="apps/api/test/manual/results/panel.csv")
    ap.add_argument("--out", default="apps/api/test/manual/results/phase-d.csv")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--k", type=int, default=3)
    ap.add_argument("--shuffle", action="store_true")
    args = ap.parse_args()

    df = load(args.panel)
    base = base_features(df)
    kept, dropped = screen(df, base)

    if args.shuffle:
        # Permute which coin got which outcome, inside each hour. The market
        # move and every feature's distribution survive; only the pairing dies.
        for c in [f"fwd{h}h" for h in HORIZONS] + [f"fwdVol{h}h" for h in HORIZONS] + [f"tb{h}h" for h in HORIZONS]:
            df[c] = df.groupby("ts", sort=False)[c].transform(lambda s: RNG.permutation(s.values))

    df, all_cols, market = engineer(df, kept)

    cutoff = df["ts"].max() - pd.Timedelta(days=HOLDOUT_DAYS)
    dev = df[df["ts"] < cutoff].reset_index(drop=True)
    hold = df[df["ts"] >= cutoff].reset_index(drop=True)

    print(f"\nPHASE D — non-linear{'  [SHUFFLED CONTROL]' if args.shuffle else ''}")
    print(f"panel      {args.panel}  {df['ts'].nunique():,} hours x {df['coin'].nunique()} coins")
    print("\n── pre-registered ──")
    print(f"features   {len(all_cols)} ({len(kept)} screened base + deltas + ranks + context)")
    print(f"dropped    {len(dropped)}: {', '.join(dropped)}")
    print("model      HistGradientBoosting, depth 3, lr 0.03, l2 1.0, early stopping")
    print(f"validation {args.folds} contiguous calendar folds, embargo = horizon")
    print(f"holdout    last {HOLDOUT_DAYS} days, {hold['ts'].nunique():,} hours, touched once")
    print(f"book       long top {args.k}, short bottom {args.k}, half capital each leg, non-overlapping")
    print("the bar    net@14 > 0 on the HOLDOUT with a bootstrap interval excluding zero\n")

    # Built once. It does not depend on the horizon or the target.
    xdev = cross_sectional_standardise(dev, all_cols, market)
    xhold = cross_sectional_standardise(hold, all_cols, market)

    rows = []
    hdr = f"{'target':>10} {'horizon':>8} {'split':>8} {'trades':>7} {'gross bp':>9} {'net@14':>8} {'95% interval':>20}"
    print(hdr)
    for horizon in HORIZONS:
        for target, is_cls in ((f"fwdVol{horizon}h", False), (f"tb{horizon}h", True)):
            ydev = dev[target].to_numpy()
            if not is_cls:
                ydev = np.clip(ydev, -WINSOR, WINSOR)
            # Non-overlapping rows only, for TRAINING. Prediction and scoring
            # still run on every hour.
            ok = np.isfinite(ydev) & non_overlapping(dev["ts"], horizon)

            oos = np.full(len(dev), np.nan)
            for train, test in purged_folds(dev["ts"], args.folds, horizon):
                tr = train & ok
                if tr.sum() < 1000 or test.sum() == 0:
                    continue
                oos[test] = fit_predict(
                    xdev[tr], ydev[tr].astype(int) if is_cls else ydev[tr], xdev[test], is_cls
                )

            # The dev book is scored on the RAW return, never on the target the
            # model was fit to. A model can rank volatility-scaled moves well and
            # still lose money, and money is the question.
            b = score_book(oos, dev[f"fwd{horizon}h"].to_numpy(), dev["ts"].to_numpy(), horizon, args.k)
            rows.append(dict(target=target, horizon=horizon, split="dev", **b))
            print(
                f"{target:>10} {horizon:>7}h {'dev':>8} {b['trades']:>7,} {b['gross_bp']:>9.2f} "
                f"{b['gross_bp'] - 14:>8.2f} {f'[{b['lo']:.2f}, {b['hi']:.2f}]':>20}"
            )

            # The holdout, fit on ALL of dev, predicted once.
            ph = fit_predict(
                xdev[ok], ydev[ok].astype(int) if is_cls else ydev[ok], xhold, is_cls
            )
            bh = score_book(ph, hold[f"fwd{horizon}h"].to_numpy(), hold["ts"].to_numpy(), horizon, args.k)
            rows.append(dict(target=target, horizon=horizon, split="holdout", **bh))
            print(
                f"{target:>10} {horizon:>7}h {'HOLDOUT':>8} {bh['trades']:>7,} {bh['gross_bp']:>9.2f} "
                f"{bh['gross_bp'] - 14:>8.2f} {f'[{bh['lo']:.2f}, {bh['hi']:.2f}]':>20}"
            )

    pd.DataFrame(rows).to_csv(args.out, index=False)
    passes = [
        r for r in rows
        if r["split"] == "holdout" and np.isfinite(r["lo"]) and r["gross_bp"] - 14 > 0 and r["lo"] > 14
    ]
    print(f"\nHoldout rows clearing the bar (net@14 > 0 AND interval above 14): {len(passes)}")
    print(f"written {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
