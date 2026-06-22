# capi-setup — Domain Standards

Embedded expertise for verifying Meta pixel + Conversions API (CAPI) redundancy.
Self-contained: thresholds, taxonomies, formulas, and good/bad examples. No runtime discovery needed.

## Why redundancy matters

A conversion-objective Meta campaign optimizes on the conversion *signal* it receives.
Since iOS 14.5 (ATT) and broad third-party-cookie loss, the browser pixel alone misses
roughly 30–40% of events (blocked scripts, cleared cookies, ITP, ad blockers). The fix is
**redundant tracking**: the browser pixel fires client-side AND the Conversions API fires the
same event server-side. Meta deduplicates the pair using a shared `event_id` (+ `event_name`),
so a redundant setup recovers lost signal *without* double-counting.

"Pixel ID" and "Dataset ID" are the **same identifier**. Modern docs say Dataset; CAPI events
POST to `/{DATASET_ID}/events`; pixel stats read from `/{PIXEL_ID}/stats`. Use the one id.

## Server-side share

For each required event over the last 7 days:

```
server_share = server_count / (browser_count + server_count)
```

App-source counts are tracked separately and excluded from the denominator (server share is a
browser-vs-server redundancy measure). `server_share` is rounded to 3 decimals in the report.

## Status taxonomy (per event)

Classification order matters — earlier conditions win:

| Status | Condition | Meaning |
|--------|-----------|---------|
| `never_fired` | no `last_fired` timestamp at all | pixel likely not installed on the triggering page |
| `stale` | last fired > 48h ago | the page/action that fired it may have changed/broken |
| `healthy` | `server_share >= 0.50` | CAPI redundancy in place |
| `partial` | `0.05 <= server_share < 0.50` | CAPI covers some traffic only |
| `missing` | `server_share < 0.05` (but pixel is firing) | browser-only; CAPI not implemented for this event |

Constants (encoded in `capi-setup.js`, do not silently change):
- `STALE_HOURS = 48`
- `HEALTHY_SERVER_SHARE = 0.50`
- `PARTIAL_SERVER_SHARE = 0.05`
- Lookback window: 7 days.

Rationale for thresholds: a truly redundant event sends both browser and server, so server
should be ~half of the deduplicated total → 0.50 is "healthy". Below 0.05 server is effectively
noise/none → "missing". The band between is partial coverage (e.g. logged-in users only).

## Default conversion-event list

When `business.conversion_events` is absent/empty in the profile, default to the standard
Meta funnel events:

```
PageView, ViewContent, AddToCart, InitiateCheckout, Purchase, Lead
```

These are Meta **standard** events. A client may define **custom** events in their profile;
the skill treats whatever names appear in `business.conversion_events` as the required set.

## Gap templates (data-driven, never LLM)

| Trigger | Gap text |
|---------|----------|
| `never_fired` | `'{event}' has never fired — pixel may not be installed on the right page (check page source for fbq('track','{event}'))` |
| `stale` | `'{event}' last fired >48h ago — check whether the triggering page/action still calls the pixel` |
| `missing` | `'{event}' has 0 server-side fires — implement CAPI for this event (target server_share ≥ 50%)` |
| `partial` | `'{event}' server_share is {pct}% — CAPI fires for some traffic only; cover all paths` |
| dataset `enable_automatic_matching` is false | `Automatic Advanced Matching is OFF — turn it on in Events Manager → Settings → Automatic Advanced Matching` |

## Next-step templates

- If any event is `missing`/`never_fired`: "Set up a Conversions API Gateway (Stape, self-host, or Shopify/WooCommerce native) OR add server-side fires from your backend for missing events."
- If any `missing`/`never_fired`/`partial`: "Send the same `event_id` from pixel + CAPI for each event to enable deduplication (Meta will dedupe automatically)." + "Send rich `user_data` (em, ph, fn, ln, ct, st, zp, country) hashed SHA-256 to maximize match quality."
- Always: "Re-run /capi-setup in 48h to verify the changes."

## Good vs bad examples

**GOOD — healthy redundant event**
```json
{ "name": "Purchase", "firing": true, "client_count_7d": 412, "server_count_7d": 398,
  "server_share": 0.491, "status": "healthy" }
```
Browser and server both fire ~equally; deduplicated via shared `event_id`. No gap emitted.

**BAD — browser-only (missing CAPI)**
```json
{ "name": "Purchase", "firing": true, "client_count_7d": 412, "server_count_7d": 0,
  "server_share": 0.0, "status": "missing" }
```
All signal is client-side; ~40% lost to ATT/cookies. Gap: implement CAPI for checkout success.

**BAD — never installed**
```json
{ "name": "Lead", "firing": false, "client_count_7d": 0, "server_count_7d": 0,
  "server_share": 0.0, "last_fired": null, "status": "never_fired" }
```
Pixel isn't on the page. Gap: verify `fbq('track','Lead')` is present on the form-submit page.

**BAD — guest checkout gap (partial)**
```json
{ "name": "AddToCart", "firing": true, "client_count_7d": 900, "server_count_7d": 110,
  "server_share": 0.109, "status": "partial" }
```
Server fires only for logged-in users (~11%). Gap: add CAPI for guest traffic too.

## Match-quality guidance (advise the dev)

Stronger `user_data` → higher Event Match Quality → better optimization. Recommend hashing
(SHA-256, lowercased/trimmed) and sending as many of these as available: `em` (email),
`ph` (phone, E.164 digits), `fn`/`ln` (name), `ct`/`st`/`zp`/`country`, plus `fbp`/`fbc`
cookies and `client_ip_address`/`client_user_agent` (sent in the clear, not hashed).
