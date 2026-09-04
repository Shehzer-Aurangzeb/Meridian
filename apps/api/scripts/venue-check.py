"""Every venue column against a quantity it must NOT resemble, plus proof the
Binance embargo is untouched. Prints PASS/FAIL per assertion; exits 1 on any FAIL."""
import pandas as pd, numpy as np, sys

P = 'apps/api/test/manual/results/panel.csv'
VEN = ['pxSpreadOkxBp','pxSpreadBybitBp','pxDispersionBp','fundSpreadBybit','oiShareBybit']
need = ['coin','ts','close','fundingRate','fundingRate_ageMin','openInterest','openInterest_ageMin',
        'premium_ageMin','takerBuySellRatio5m_ageMin'] + VEN
df = pd.read_csv(P, usecols=need, parse_dates=['ts']).sort_values(['coin','ts'])
fails = []
def check(name, ok, detail):
    print(f"  {'PASS' if ok else 'FAIL'}  {name:52} {detail}")
    if not ok: fails.append(name)

df['ret_bp'] = df.groupby('coin')['close'].pct_change()*1e4
# pct_change divides by the previous value and Binance publishes the odd zero,
# which becomes inf and poisons the correlation into NaN.
df['oi_chg'] = df.groupby('coin')['openInterest'].pct_change().replace([np.inf,-np.inf], np.nan)
sub = df.dropna(subset=['ret_bp','oi_chg'])

print(f"\npanel {len(df):,} rows  {df.ts.min().date()} -> {df.ts.max().date()}")

print("\n1. MAGNITUDE — a venue spread on liquid majors is single-digit bp")
for c in ['pxSpreadOkxBp','pxSpreadBybitBp','pxDispersionBp']:
    m = df[c].abs().median()
    check(f"median |{c}| under 10 bp", m < 10, f"median {m:.2f} bp, p99 {df[c].abs().quantile(.99):.1f} bp")

print("\n2. RESEMBLANCE — each column vs the thing it must not be")
for c in ['pxSpreadOkxBp','pxSpreadBybitBp','pxDispersionBp']:
    r = sub[c].abs().corr(sub.ret_bp.abs())
    check(f"|{c}| vs |1h return|", abs(r) < 0.5, f"corr {r:+.3f}")
r = sub.oiShareBybit.abs().corr(sub.oi_chg.abs())
check("|oiShareBybit| vs |Binance OI change|", abs(r) < 0.5, f"corr {r:+.3f}")
r = sub.fundSpreadBybit.corr(sub.fundingRate)
check("fundSpreadBybit vs Binance funding alone", abs(r) < 0.9, f"corr {r:+.3f}")
# A spread that is just -1x one side means the other side is absent/stale flat.
r2 = sub.fundSpreadBybit.abs().corr(sub.fundingRate.abs())
check("|fundSpreadBybit| vs |Binance funding|", abs(r2) < 0.9, f"corr {r2:+.3f}")

print("\n3. BINANCE EMBARGO UNTOUCHED")
# Funding settles 8-hourly on the hour, so with a 5-minute publication embargo
# the age at a bar closing at hour H must cycle 480,60,120,...,420 as H mod 8
# runs 0..7 -- the 480 being the settlement hour itself, correctly held back.
# That cycle IS the embargo. A median is a weaker statement and an earlier
# version of this check asserted the wrong one (240; the cycle's median is 270).
# Binance stamps fundingTime with ~29ms of jitter, hence the rounding.
cyc = df[df.coin=='BTC'].assign(h8=lambda d: d.ts.dt.hour % 8).groupby('h8').fundingRate_ageMin.median().round()
want = pd.Series([480.,60.,120.,180.,240.,300.,360.,420.], index=range(8), name='fundingRate_ageMin')
want.index.name='h8'
check("funding age cycles 480,60..420 by hour mod 8", cyc.equals(want), f"got {cyc.tolist()}")
for c, want_med in [('takerBuySellRatio5m_ageMin',5),('premium_ageMin',60),('openInterest_ageMin',5)]:
    got = df[c].median()
    check(f"{c} median == {want_med}", got == want_med, f"median {got}")

print("\n4. SHAPE")
for c in VEN:
    v = df[c].dropna()
    print(f"  {c:18} cover {df[c].notna().mean():6.1%}  p1 {v.quantile(.01):>9.4f}  p50 {v.median():>9.4f}  p99 {v.quantile(.99):>9.4f}")

print(f"\n{'ALL CHECKS PASSED' if not fails else 'FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
