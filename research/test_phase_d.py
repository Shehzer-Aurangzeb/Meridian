"""Self-check for phase_d. Run: ../.venv-research/bin/python research/test_phase_d.py"""
import numpy as np
import pandas as pd

from phase_d import (
    cross_sectional_standardise,
    fit_predict,
    non_overlapping,
    purged_folds,
    score_book,
)

RNG = np.random.default_rng(7)


def frame(hours=2000, coins=10, oracle=True):
    ts = pd.date_range("2024-01-01", periods=hours, freq="h").repeat(coins)
    r = RNG.uniform(-0.02, 0.02, len(ts))
    f = r if oracle else RNG.normal(size=len(ts))
    return pd.DataFrame(
        {"ts": ts, "coin": np.tile([f"C{i}" for i in range(coins)], hours), "f": f, "fwd4h": r}
    )


def test_purge():
    df = frame(1000)
    for train, test in purged_folds(df["ts"], 5, 24):
        assert not (train & test).any(), "a row is in both train and test"
        if test.sum() == 0 or train.sum() == 0:
            continue
        gap = (df.loc[test, "ts"].min() - df.loc[train & (df["ts"] < df.loc[test, "ts"].min()), "ts"].max())
        if pd.notna(gap):
            assert gap >= pd.Timedelta(hours=24), f"embargo not applied, gap {gap}"
    print("purge          ok")


def test_thin():
    df = frame(1000)
    keep = non_overlapping(df["ts"], 24)
    kept_hours = df.loc[keep, "ts"].nunique()
    assert abs(kept_hours - 1000 / 24) < 2, kept_hours
    # And it must be the SAME hours for every coin, or the panel tears.
    assert df.loc[keep].groupby("ts").size().nunique() == 1
    print("thinning       ok")


def test_standardise():
    df = frame(50)
    x = cross_sectional_standardise(df, ["f"])
    first = x[: df["coin"].nunique(), 0]
    assert abs(first.mean()) < 1e-5, first.mean()
    # pandas std is sample (ddof=1); with n coins that is sqrt(n/(n-1)) off 1.
    n = len(first)
    assert abs(first.std() - np.sqrt((n - 1) / n)) < 1e-5, first.std()
    # A column constant across coins is 0/0 and must be caught, not passed to
    # the binner, which reports it as a window-shape error.
    df["mkt"] = df.groupby("ts")["f"].transform("mean")
    try:
        cross_sectional_standardise(df, ["f", "mkt"])
        raise AssertionError("all-NaN column was not caught")
    except ValueError as e:
        assert "mkt" in str(e), e
    x2 = cross_sectional_standardise(df, ["f", "mkt"], ["mkt"])
    assert np.isfinite(x2[:, 1]).all(), "passthrough column should survive intact"
    print("standardise    ok")


def test_book_is_non_overlapping():
    df = frame(1000)
    b = score_book(df["f"].to_numpy(), df["fwd4h"].to_numpy(), df["ts"].to_numpy(), 4, 3)
    assert b["trades"] <= 1000 // 4 + 1, b["trades"]
    assert b["trades"] > 200, b["trades"]
    print("book spacing   ok")


def test_finds_planted_and_rejects_noise():
    df = frame(3000, oracle=True)
    x = cross_sectional_standardise(df, ["f"])
    y = df["fwd4h"].to_numpy()
    keep = non_overlapping(df["ts"], 4)
    pred = np.full(len(df), np.nan)
    for train, test in purged_folds(df["ts"], 5, 4):
        tr = train & keep
        if tr.sum() < 500 or test.sum() == 0:
            continue
        pred[test] = fit_predict(x[tr], y[tr], x[test], False)
    hit = score_book(pred, y, df["ts"].to_numpy(), 4, 3)
    assert hit["gross_bp"] > 30, f"planted signal not found: {hit}"

    noise = frame(3000, oracle=False)
    xn = cross_sectional_standardise(noise, ["f"])
    yn = noise["fwd4h"].to_numpy()
    keep = non_overlapping(noise["ts"], 4)
    predn = np.full(len(noise), np.nan)
    for train, test in purged_folds(noise["ts"], 5, 4):
        tr = train & keep
        if tr.sum() < 500 or test.sum() == 0:
            continue
        predn[test] = fit_predict(xn[tr], yn[tr], xn[test], False)
    miss = score_book(predn, yn, noise["ts"].to_numpy(), 4, 3)
    assert abs(miss["gross_bp"]) < 20, f"found signal in noise: {miss}"
    print(f"oracle {hit['gross_bp']:.1f} bp, noise {miss['gross_bp']:.1f} bp   ok")


if __name__ == "__main__":
    test_purge()
    test_thin()
    test_standardise()
    test_book_is_non_overlapping()
    test_finds_planted_and_rejects_noise()
    print("\nall checks passed")
