# Public API performance rollout

The public storefront now exposes phase-level `Server-Timing`, returns only the first 12 products on its initial response, loads later catalogue pages independently, records view analytics on a separate non-blocking request, and sends short shared-cache directives only on anonymous GET routes.

## Safe rollout order

1. Deploy the API before the web app so `/public/shops/:slug/catalog` and `/public/shops/:slug/view` exist before the progressive client uses them.
2. Confirm the API and Postgres primary are in the same Railway region. Inspect `X-Railway-Upstream-Zone` on the API response and compare it with the database service region; cross-region database traffic should be corrected before adding more application caches.
3. Enable Railway's built-in CDN for the API service. The anonymous shop and catalogue GETs opt into shared caching with `s-maxage=30`, a 60-second stale-while-revalidate window, and a five-minute stale-if-error fallback. Authenticated routes and the analytics POST do not opt into public caching.
4. Deploy the web app and verify that direct product links still resolve products outside the first catalogue page.

Railway references: [Cache headers and CDN](https://docs.railway.com/guides/cache-headers-cdn), [edge networking](https://docs.railway.com/networking/edge-networking), and [edge rules](https://docs.railway.com/networking/edge-rules).

## Acceptance probe

Run this against the deployed API three times, replacing the example shop slug:

```powershell
curl.exe --compressed -sS -o NUL -D - -w "dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s bytes=%{size_download}`n" "https://api.useloyalloop.com/api/v1/public/shops/kings-store-demo"
```

Check for:

- `Server-Timing` entries for `slug`, `launch`, `catalog`, `trust`, and `app`;
- `Timing-Allow-Origin: *`, which lets the web app collect those timings through the browser Resource Timing API;
- `Cache-Control: public, max-age=0, s-maxage=30, stale-while-revalidate=60, stale-if-error=300`;
- Railway cache status changing to a hit on a repeated request after CDN activation;
- warm time-to-first-byte below 800 ms, with the slowest server phase identifying the next optimization target.

## Compression boundary

The previous production probe showed that the web HTML was Brotli-compressed while API JSON was not. This repository deliberately does not add a hand-written compressor or change the dependency lock outside the package-approval batch. Activate supported edge compression if the deployed Railway/CDN response offers it; otherwise add a reviewed Express compression dependency in the package-maintenance batch, then benchmark CPU time, time-to-first-byte, encoded bytes, and total time before keeping it.

Compression is useful for transfer size, but it will not solve multi-second server processing. Trust aggregation, query topology, database region, and cache hits remain the first-order checks.
