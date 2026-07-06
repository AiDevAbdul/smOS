# Lead webhooks — real-time setup (B4)

smOS treats **real-time webhooks as the primary lead-delivery path** and the
`sync` poller as backfill/reconciliation. Both converge on the same per-form
JSONL store (`clients/<slug>/leads/<form_id>.jsonl`) and dedupe on lead id.

## One-time setup

1. **Subscribe the app to the Page's `leadgen` field** (MCP tool
   `subscribe_lead_webhook`, or `POST /{page_id}/subscribed_apps` with
   `subscribed_fields=leadgen` and the Page access token).
2. **Configure the webhook product** in the Meta App dashboard → Webhooks →
   Page → subscribe to `leadgen`. Point it at your HTTPS callback URL.
3. **Verify the callback** — Meta sends a GET with `hub.mode=subscribe`,
   `hub.verify_token`, and `hub.challenge`. Echo back `hub.challenge` (200) iff
   `hub.verify_token` matches your configured token.
4. **Validate each POST** — verify the `X-Hub-Signature-256` header
   (`sha256=` HMAC of the raw body using the App Secret) before trusting it.

## Payload shape

```json
{
  "object": "page",
  "entry": [{
    "id": "<page_id>",
    "time": 1700000000,
    "changes": [{
      "field": "leadgen",
      "value": {
        "leadgen_id": "<lead_id>",
        "page_id": "<page_id>",
        "form_id": "<form_id>",
        "ad_id": "<ad_id>",
        "created_time": 1700000000
      }
    }]
  }]
}
```

The notification carries only the **lead id** — `leads.js webhook` fetches the
full lead via `GET /{lead_id}` (it needs `leads_retrieval` permission), scores it
with the same logic the poller uses, and appends it.

## Ingesting a delivery

Pipe the validated POST body to the skill:

```bash
node skills/leads/leads.js <slug> webhook --payload /path/to/body.json
# or
cat body.json | node skills/leads/leads.js <slug> webhook
```

Your HTTPS endpoint should respond `200` to Meta immediately, then hand the body
to this command (queue/async) so a slow lead fetch never times out the webhook.

## Backfill

Run `node skills/leads/leads.js <slug> sync` on a schedule (e.g. hourly) to catch
any leads a dropped or duplicated webhook missed. Dedup on lead id makes this
safe to run alongside live webhooks.
