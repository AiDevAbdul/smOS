# Blue Rose Auto — Pixel/CAPI Handoff: Wire Up Lead + Schedule Events

**For:** whoever manages WordPress (PixelYourSite plugin) and/or the GoHighLevel (GHL) account
**Date:** 2026-07-22
**Pixel ID:** `2183558222437003`
**Page tested:** https://promo.blueroseauto.com/car-wraps-color-change/

## Where things stand

Verified directly (browser network trace + a Meta test event):

| Layer | Status |
|---|---|
| PixelYourSite base code on the site | ✅ Installed, firing `PageView` correctly to the right pixel |
| Meta Conversions API (server-side) write access | ✅ Confirmed — test event received (`fbtrace_id: AKQ2POVf7AKbYVCCKGl-cgU`) |
| `Lead` event on real traffic (7-day) | ❌ Never fired |
| `Schedule` event on real traffic (7-day) | ❌ Never fired |
| Automatic Advanced Matching (Events Manager) | ❌ Off |

**Root cause:** the pixel connection itself is healthy — the gap is that nothing on the
site is telling the pixel *when* to fire `Lead`/`Schedule`. The quote form on the promo
page is a GoHighLevel form embedded in an iframe
(`api.leadconnectorhq.com/widget/form/s2V7dlhd4HuuIBgYMeGA`). PixelYourSite's default
"detect any WordPress form submit" trigger cannot see into a cross-origin iframe, so a
real form submission never reaches it. This is a known failure mode for GHL-embedded
forms on WordPress — it needs an explicit trigger, not the default auto-detection.

## What to do (pick one path — GHL-native is recommended)

### Option A — Fire the event from GoHighLevel directly (recommended)

GHL has a native Facebook Conversions API integration that sends server-side events
straight from the workflow, with no dependency on the WordPress iframe at all (more
reliable, survives ad blockers/ITP/Safari cookie loss).

1. In GHL: **Settings → Integrations → Facebook Conversions API** → connect pixel
   `2183558222437003` (use the client's Meta Business Manager, System User token with
   `ads_management` + `business_management` scopes).
2. On the funnel/form (`s2V7dlhd4HuuIBgYMeGA`) or the workflow it triggers, add a
   **"Facebook Conversion API — Send Event"** action:
   - Trigger: form submitted → fire `Lead`
   - Trigger: appointment booked (if/when a booking calendar is added to this funnel) →
     fire `Schedule`
3. Map `user_data`: email, phone, first name, last name — GHL will hash these
   automatically for the API call. This also fixes the "Automatic Advanced Matching off"
   gap indirectly, since GHL sends match data itself.
4. Set a shared `event_id` per submission if GHL exposes a `page_view` fbp/fbc cookie
   value at submit time (`{{contact.utm_fbp}}`/`fbc` merge fields, if enabled) so Meta can
   dedupe pixel + CAPI copies of the same event. If GHL doesn't expose this in your plan
   tier, skip — dedup is a nice-to-have, not a blocker.

### Option B — Fire the event from PixelYourSite (fallback if GHL CAPI isn't available)

Only do this if Option A isn't possible on the current GHL plan/integration.

1. GHL forms post a `message` event to the parent window on successful submit
   (`postMessage`). PixelYourSite's default form trigger doesn't listen for this — you'll
   need a small JS snippet (Code Snippets plugin or theme's footer script) that listens
   for the GHL postMessage and calls:
   ```js
   window.addEventListener('message', function (e) {
     if (e.origin.includes('leadconnectorhq.com') && e.data?.type === 'formSubmit') {
       if (window.pys_event) {
         pys_event('trackCustom', 'Lead', {}); // or pys built-in Lead trigger, per plugin version
       }
     }
   });
   ```
   Exact event name/shape from GHL's embed varies by widget version — confirm in
   browser devtools (`window.addEventListener('message', console.log)`) what GHL
   actually posts on submit before wiring this up.
2. In PixelYourSite → Facebook Pixel → Events, add a **Custom Event** rule bound to that
   JS trigger, mapped to `Lead`.
3. Still separately enable **Automatic Advanced Matching**: Events Manager → pixel
   `2183558222437003` → Settings → Automatic Advanced Matching → On.

### Either path — enable Automatic Advanced Matching

Events Manager → pixel `2183558222437003` → Settings → Automatic Advanced Matching →
turn on. This alone doesn't fix the never-fired events but improves match quality once
they do fire.

## How to confirm the fix

Re-run from the agency side:
```
node skills/capi-setup/capi-setup.js blue-rose-auto
```
Expect `Lead`/`Schedule` to move from `never_fired` to `healthy`/`partial` after a real
form submission (or ask us to re-run with a fresh `--test-event TEST<code>` from Events
Manager → Test Events to confirm connectivity again in the meantime).

## Do NOT do

- Do not fire real production `Lead`/`Schedule` events for testing — always use a
  `test_event_code` from Events Manager → Test Events tab so test traffic doesn't pollute
  the real conversion data Meta uses for optimization.
- Do not submit the live quote form with fake data to "test" it — that creates a real
  lead in the CRM and may trigger real SMS/email notifications to the shop.
