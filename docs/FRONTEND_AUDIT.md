# Frontend audit — 8 September 2026

> **All findings closed as of 9 September 2026.** The six defects were fixed in
> `456aa62`; the three items that were left open below were closed the next day
> and are marked as such.

Scope: the pages and routes actually in use — `/map`, `/log`, `/history`,
`/history/[id]`, `/calibration` — plus the layout, providers and hooks they
pull in. Looked for redundant network calls, leaked resources, wasted renders
and departures from the standards in `apps/web/CLAUDE.md`.

Everything below was measured in a real browser (Playwright against the local
dev servers), not read off the source. Every fix was re-measured afterwards.

---

## Fixed in this pass

### 1. `/api/candles` refetch storm — severe

`components/features/map/price-chart.tsx` put `Date.now()` into the React Query
key:

```ts
const anchorSeconds = Math.floor((anchorAt ? … : Date.now()) / 1000);
const windowStart = (anchorSeconds - LEAD_BARS * barSeconds) * 1000;
```

The live candle socket re-renders the chart roughly once a second. Each render
produced a different `windowStart`, so React Query saw a **brand new query**:
a new cache entry, and a new fetch of 500 candles. Measured on `/map` sitting
completely idle:

```
7 requests in 12s   —   7 distinct startTime values
23 requests over one 30s session with a few clicks
```

Each was also a miss in the Next data cache, because `revalidate: 60` keys on
the full URL and the URL changed every second. So every one of them went
through to Binance, and every one left a cache entry behind that nothing would
ever read again.

The same line hid a second bug. `startTime = now − 150 bars` combined with
`limit=500` returns only the bars that exist between then and now — so the live
chart was drawing **150 bars, not 500**.

Fix: a live chart asks for the most recent bars and passes no `startTime` at
all. Only a historical reading anchors a window, and it anchors off the stable
`anchorAt` prop.

```
idle 20s:   11 requests  →  0
on load:     2 requests  →  1
```

### 2. `Error: Object is disposed` — uncaught, on every interval click

Two uncaught page errors each time the timeframe changed.

React runs effect cleanups in the order the effects were defined. The chart
effect is defined first, so its `chart.remove()` ran *before* the price-line
effect's `series.removePriceLine(...)` — which was then calling into a series
that had already been disposed.

Fix: an `aliveRef` that the chart cleanup clears first. The price-line cleanup
skips its work when the chart is already gone; the lines die with the chart
regardless.

### 3. Series-marker plugin leak

`createSeriesMarkers(series, …)` was being called inside the candles effect.
In lightweight-charts v5 that call **attaches a new plugin** rather than
replacing the existing one, so a plugin accumulated on every candle refetch —
and combined with defect 1, that was roughly one per second.

Fix: the plugin is created once with the chart, updated through `setMarkers`,
and detached on teardown.

### 4. `/map` bypassed React Query entirely

The page hand-rolled `useEffect` + `fetch` into local state. Consequences:

- No cache. BTC → ETH → BTC was three fetches.
- `useBatch`'s `reload`, which calls `invalidateQueries({ queryKey: ['map'] })`,
  could not reach it.
- React StrictMode double-fetched on mount in dev.

Fix: moved onto `queryKeys.map(coin, universe)` — the same key `/log` already
uses — with `staleTime: Infinity`, since a reading is a moment in time and
must not change under the reader who is about to copy it out. The two screens
now share readings.

```
3 requests  →  1
```

Also stopped rebuilding the entire chart when the interval or price precision
changes; those are options, so they now go through `applyOptions`. The old code
threw away the fetched series and the reader's zoom on every interval click.

### 5. Unstable `zones` array on the detail page

`app/(dashboard)/history/[id]/page.tsx` passed `zones={snapshot?.zones ?? []}`.
The `?? []` built a new array on every render, so the price-line effect saw a
changed dependency each time and redrew every line. Memoised.

### 6. Wrong error key in the candles route

`app/api/candles/route.ts` returned `{ message }` while `lib/api/client.ts` and
every other route use `{ error }`. Chart failures surfaced as
`Request failed: 502` instead of `Binance unreachable`. Aligned with the rest.

---

## Verified clean

- `/log` — 10 map calls for 10 coins, 10 rendered sections, no sockets.
- `/history` — 2 calls (`/api/sim`, `/api/sim/stats`).
- `/calibration` — 1 call.
- No hydration warnings on any page.
- Canvas count flat at 7 across idle, interval switches and coin switches —
  no DOM leak from the chart.
- WebSockets close on unmount; reconnect backoff is capped at 30s.
- `apps/web` typechecks clean.

---

## Open items — closed 9 September 2026

### Dead code — deleted

22 modules had no reachable caller. Each was confirmed by searching for its
exported symbol, not just its filename, and the whole of `components/ui` and
`lib` was swept rather than only the files named in the first pass.

```
components/ui/  animated-collapse animated-number badge-text body caption
                card-title eyebrow fade-in headline loading-bar loading-dots
                not-wired page-transition section-head section-header
                skeleton-card skeleton-text spinner success-check
lib/            format.ts
lib/hooks/      use-health.ts use-live-prices.ts
```

`components/ui` went from 19 files to 9. Two near-misses were kept:
`lib/snapshot.check.ts` has no importer but is the `pnpm --filter web check`
script, and `app/api/health/route.ts` has no in-app caller but is exercised by
`scripts/smoke.mjs`. A filename search alone would have deleted both.

### The client-render gate — removed

`components/theme-provider.tsx` returned `null` until it had mounted, so
nothing below `Providers` was ever server-rendered.

The gate existed to avoid a flash of the wrong theme, but nothing in the app
renders differently per theme — `resolvedTheme` has exactly one consumer,
`PriceChart`, and only as an effect dependency. The theme lives in a class on
`<html>` and is expressed entirely in CSS. So blanking every page was buying
nothing that a class could not.

Replaced with a blocking script in `<head>` (`THEME_SCRIPT`) that sets the
class before first paint. `/sign-in` now server-renders its `<form>`, which it
could not do before. Verified pre-hydration in three cases:

```
system dark                  → dark
system light                 → light
stored light, system dark    → light
```

### `useBatch`'s memo — replaced with `combine`

The hand-rolled memo keyed on `results.map(r => r.dataUpdatedAt).join(',')`
with an eslint-disable. `useQueries` takes a `combine` option for exactly this,
and React Query memoises it against the queries themselves. The disable comment
and the string key are both gone.

### Verified after all three

```
/map          1 map call, 1 candles call, 0 refetches over 20s idle
/log          10 map calls, 10 sections
no hydration warnings, no page errors, typecheck clean
```

## How to reproduce the measurements

The probes live in the session scratchpad and drive Playwright against
`localhost:3000` with a session cookie:

- `audit.mjs` — counts `/api/*` calls on `/map` after load and after 20s idle.
- `audit2.mjs` — prints the `startTime` of every `/api/candles` request, which
  is what exposed defect 1.
- `audit3.mjs` — canvas count and socket list across interval and coin clicks.
- `audit4.mjs` — call counts for `/log`, `/history`, `/calibration`.
- `audit5.mjs` — listens for console errors and `pageerror`, which is what
  exposed defect 2.
- `audit6.mjs` — the detail page, including the "decided" marker.
- `audit7.mjs` — hydration warnings across all four pages.

One `SimTrade` row was seeded to exercise the detail-page marker path and then
deleted. The table is back to 0 rows.
