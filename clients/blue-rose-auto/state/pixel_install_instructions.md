# Meta Pixel Installation — Blue Rose Auto

> **⚠ Superseded pixel ID (updated 2026-09-02):** this doc was written against pixel
> `2183558222437003`, which was owned by the agency's Ducker Creative BM and could not be
> moved into the client's own BM. The account now runs on **`1798280031363662`**
> (client-owned) — that is the pixel any developer/GHL work should reference from here
> forward. `2183558222437003` should be retired once nothing still points at it. Every
> pixel ID below is the retired one — read it as `1798280031363662`.

**For:** Blue Rose Auto's web developer
**Site:** https://blueroseauto.com/
**Pixel (Dataset) ID:** `1798280031363662` (see notice above — supersedes `2183558222437003` referenced below)
**Events to track:** `Lead`, `Schedule`

This pixel lets us measure which ads actually produce leads and booked appointments,
and is required before we can run conversion-objective campaigns. Please install both
the base code and the two event snippets below, then let us know — we'll verify it's
firing on our end (no further work needed from you after that).

---

## Step 1 — Base pixel (every page)

Paste this as high in the `<head>` as possible, on **every page** of the site
(ideally in the shared header/layout template so it loads site-wide):

```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '2183558222437003');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=2183558222437003&ev=PageView&noscript=1"/></noscript>
<!-- End Meta Pixel Code -->
```

This alone fires `PageView` on every page automatically.

---

## Step 2 — Conversion events

Fire each event **at the moment the action completes**, not just on page load.

### `Lead` — a contact/quote/enquiry form is submitted
Fire on the form's success/confirmation (the thank-you state, or the success
callback after the form posts):

```html
<script>fbq('track', 'Lead');</script>
```

### `Schedule` — an appointment is booked
Fire on the booking confirmation page/step (after the customer successfully
schedules a service appointment):

```html
<script>fbq('track', 'Schedule');</script>
```

> If a form submission and a booking happen in the same flow, fire **both** events
> at that confirmation point.

---

## Step 3 — Tell us when it's live

Reply once both are installed. We'll confirm each event is firing correctly using
Meta Events Manager and our verification tooling — you don't need to test it yourself.

## Step 4 — Conversions API (CAPI) — server-side tracking

**Why this matters:** the browser pixel above is client-side only. iOS privacy
restrictions, consent banners, and ad blockers suppress roughly 30–40% of those events.
CAPI sends the **same** events a second time from the server, so Meta still receives the
signal even when the browser is blocked. As of 2026 this is effectively a baseline
requirement, not a nice-to-have, for any conversion campaign.

The two streams are **deduplicated** by a shared `event_id` — so an event seen by both the
pixel and CAPI is counted once, not twice.

### Recommended path for Blue Rose Auto: Server-Side Google Tag Manager (sGTM)

Blue Rose Auto already runs Google Ads through Google Tag Manager. That same GTM setup is
the cleanest way to add Meta CAPI — no separate backend code to write. The plan:

1. **Stand up a server container.** If only a *web* GTM container exists today, add a
   **server container** with a tagging server URL (Google Cloud / Stape / similar host).
   GA4 events flow into it and become the data source for Meta CAPI.
2. **Add the official "Conversions API" tag template** in the server container
   (Meta's GTM Server-Side template). Configure it with:
   - **Dataset (Pixel) ID:** `2183558222437003`
   - A **CAPI access token** (we generate this in Meta Events Manager → Settings and
     send it to you securely — do **not** hardcode it in the web container, it is a secret).
   - **Event Name Setup Method = "Inherit from client"** so GA4 event names auto-map to
     Meta's standard events (`Lead`, `Schedule`).
3. **Match the `event_id` between pixel and CAPI.** In the web container, set a custom
   `Event ID` variable on the Meta pixel events and pass the *same* value to the server
   container. This is what enables deduplication. Without matching IDs, events double-count.
4. **Send `user_data` for matching.** Pass available customer parameters (email, phone,
   `fbp`/`fbc` cookies, IP, user-agent) — hashed where required — so Meta can attribute
   server events to people. Higher match quality = better optimization.

### Verifying CAPI is live
- Use GTM **Preview Mode** on both web and server containers at once; trigger a test
  lead/booking and confirm the CAPI tag fires a `POST` to `graph.facebook.com` returning
  **200**.
- In Meta **Events Manager → your dataset**, both a "Browser" and a "Server" source should
  appear for each event, and the deduplication indicator should show events are matched.
- We will independently confirm server-side share per event on our side and flag any gaps.

> If for any reason sGTM isn't viable, the alternative is a direct server-to-server
> integration (your backend POSTs to `https://graph.facebook.com/v25.0/2183558222437003/events`).
> The sGTM route is preferred because it reuses the GTM you already maintain.

## Notes for the developer
- Use the exact event names `Lead` and `Schedule` (case-sensitive).
- If the site is a single-page app (SPA), make sure the event `fbq('track', ...)`
  runs on the client-side route/confirmation transition, not just initial HTML load.
- If you use Google Tag Manager, you can implement the same `fbq` calls via a
  Custom HTML tag triggered on the relevant events instead of inline `<script>`.
- An ad/script blocker can suppress the pixel during your own testing — verify in a
  clean browser or use Meta's "Test Events" tab if you want to see live hits.
