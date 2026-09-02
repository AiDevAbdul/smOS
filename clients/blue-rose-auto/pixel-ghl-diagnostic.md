# Meta Pixel + GHL Integration Diagnostic
**Blue Rose Auto Care & Repair Services**  
Generated: 2026-08-04

> **⚠ Superseded pixel ID (updated 2026-09-02):** pixel `2183558222437003` referenced
> below was owned by the agency's Ducker Creative BM; the account has since moved to
> client-owned pixel **`1798280031363662`**. Note also that `capi_report.json` (2026-08-31)
> now shows `Lead` firing healthy at 100% server-side share, so the specific symptom this
> diagnostic describes (0 attributed conversions on GHL-sourced leads) has been resolved
> for `Lead`; `Schedule` still shows `never_fired` and remains an open gap.

---

## The Problem

- **Ad "New Leads ad"**: 134 link clicks | $80.44 spend | **0 attributed conversions**
- **Account total (7d)**: 13 conversions across all campaigns
- **Likely root cause**: GHL form submissions aren't triggering Meta pixel events

---

## Why GHL Forms Don't Auto-Fire Pixels

GoHighLevel forms commonly break pixel tracking because:

1. **Iframe Embedding** (most common)
   - GHL form runs in a sandboxed iframe or redirect
   - Meta pixel on main page can't see iframe form submissions
   - Solution: Use webhook callback + server-side pixel event OR GHL native integration

2. **Async Form Submission**
   - Form submits via AJAX/fetch without page reload
   - Pixel event listener may fire before form actually submits
   - Solution: Wire GHL success callback → manual pixel.track() call

3. **Missing Pixel Event Configuration**
   - Pixel installed but no `Lead` or `Schedule` event mapped to GHL submit
   - Default PageView fires but form completion doesn't
   - Solution: Create custom conversion event in Meta, map to GHL webhook

4. **Cross-Domain Redirects**
   - GHL might redirect to thank-you page on different domain
   - Pixel loses session context, can't attribute the lead
   - Solution: Ensure pixel installed on ALL domains in the flow

---

## Diagnostic Checklist

### ✅ What We Know
- Pixel ID: `2183558222437003`
- Website: https://blueroseauto.com/
- Conversion events expected: "Lead", "Schedule"
- Forms: GHL (embedded on landing page)

### ⚠️ What To Check

1. **Pixel Installation**
   ```
   [ ] Meta pixel code present in <head> on blueroseauto.com
   [ ] Pixel ID 2183558222437003 matches website config
   [ ] Pixel fires PageView events (check Meta Events Manager)
   ```

2. **GHL Form Integration**
   ```
   [ ] GHL form embed method (iframe, inline, redirect?)
   [ ] GHL account webhook configured
   [ ] Webhook target: {your backend or GHL conversion tracking endpoint}
   [ ] GHL "Track conversions" setting enabled
   ```

3. **Pixel Event Mapping**
   ```
   [ ] "Lead" event created in Meta (Catalog → Conversions)
   [ ] "Schedule" event created in Meta
   [ ] GHL webhook → custom pixel.track("Lead") implementation
   [ ] Test: Submit GHL form, check Meta Events Manager real-time
   ```

4. **Landing Page Flow**
   ```
   [ ] Ad link URL: {check what page users land on}
   [ ] Landing page has pixel installed
   [ ] Form submit → thank you page OR modal (check domain)
   [ ] No redirect away from tracked domain
   ```

---

## Most Likely Issue: GHL Webhook Not Wired to Pixel

**Scenario:** 
- User clicks ad → lands on blueroseauto.com
- Fills GHL form → form submits via AJAX to GHL servers
- GHL stores the lead BUT doesn't fire a pixel event
- Meta pixel never sees the "Lead" event
- Attribution chain breaks

**Fix (3 steps):**

1. **GHL Webhook Setup**
   - In GHL: Settings → Webhooks → Create webhook
   - Trigger: Form submission
   - POST to your backend or use GHL's native Meta integration

2. **Backend Handler** (or use GHL native)
   ```javascript
   // Receive webhook from GHL form submission
   app.post('/ghl/lead-webhook', (req, res) => {
     // req.body contains form data
     // Fire Meta pixel event server-side
     fbq('track', 'Lead', {
       value: 175,  // LTV from profile
       currency: 'USD'
     });
     res.json({ ok: true });
   });
   ```

3. **Or Use GHL Native Integration** (simpler)
   - GHL → integrations → Meta Conversions API
   - Authenticate with Meta
   - GHL sends leads directly to Meta (server-to-server, more reliable)

---

## Server-Side Pixel Workaround

If GHL doesn't support native Meta integration:

```javascript
// Option A: Use Meta Conversions API (more reliable, server-side)
const fetch = require('node-fetch');

app.post('/ghl/lead-webhook', async (req, res) => {
  const leadData = req.body;
  
  // Send to Meta server-to-server
  await fetch(`https://graph.facebook.com/v25.0/${pixelId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        user_data: {
          em: hashEmail(leadData.email),
          ph: hashPhone(leadData.phone),
          ln: hashName(leadData.lastName),
          fn: hashName(leadData.firstName)
        },
        custom_data: {
          value: 175,
          currency: 'USD'
        }
      }],
      access_token: process.env.META_PAGE_TOKEN
    })
  });
  
  res.json({ success: true });
});
```

---

## Recommendation

**Immediate action:**
1. Ask client: "Are GHL form submissions being tracked in GHL?" (check GHL dashboard)
2. Ask: "Is GHL linked to Meta Conversions API?" 
3. If no: Set up GHL webhook → server-side pixel tracking (Conversions API)

**Expected result:**
- 134 clicks will have attributed leads once webhook fires pixel
- CPA will reflect properly
- Anomaly resolves

---

## Impact if Fixed

| Metric | Current | After Fix |
|--------|---------|-----------|
| **Link clicks** | 134 | 134 |
| **Attributed conversions** | 0 | ~8–12 est. |
| **CPA** | ∞ (undefined) | ~$7–$10 ✓ |
| **Campaign status** | ANOMALY | ✓ HEALTHY |

---

**Next step:** Share this diagnostic with the client (BlueRose contact) → confirm GHL webhook setup.
