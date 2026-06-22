# Contract — API Reference (Dropbox Sign v3)

The only external API `/contract` touches, and only when `--send` is passed AND
`DROPBOX_SIGN_API_KEY` is set. Everything else (rendering, CRM, PDF) is local. The call is
**optional and fail-closed**: any failure degrades to a manual signature block, never an error.

URLs cited from `skills/references-shared.md` §14 (Dropbox Sign, formerly HelloSign, v3).

> **Host-rename caveat — verify before the first real send.** The base host
> `api.hellosign.com` and the `developers.hellosign.com` docs are the **legacy/transitional
> HelloSign domain** kept after the Dropbox Sign rename. They may be redirected to, or
> deprecated in favor of, a Dropbox-branded host. Treat the host, auth scheme, multipart
> field names, and success-payload path documented below as **unverified against
> production**. Re-confirm them against the live docs before the first real e-sign send.
> The skill fail-closes to a manual signature block on any mismatch, so a stale host
> degrades safely rather than silently dropping the request.

---

## Endpoint

| Item | Value |
|------|-------|
| Method | `POST` |
| URL | `https://api.hellosign.com/v3/signature_request/send` |
| Base host | `api.hellosign.com` (still on the `hellosign.com` domain after the Dropbox Sign rename) |
| API version | v3 |
| Body | `multipart/form-data` (file upload) |
| Auth | HTTP Basic — API key as username, empty password: `Authorization: Basic base64("<API_KEY>:")` |

Source docs:
- Signature Request docs (parent): https://developers.hellosign.com/api/signature-request
- Developer docs home (auth, host, `test_mode`): https://developers.hellosign.com/
- Send endpoint: https://api.hellosign.com/v3/signature_request/send

---

## Request fields used

| Field | Value sent | Notes |
|-------|-----------|-------|
| `title` | `"{agency.name} — Service Agreement"` | Shown to the signer |
| `subject` | `"Your service agreement is ready to sign"` | Email subject |
| `signers[0][email_address]` | `client.contact_email` | **Required**; absence → manual fallback before any call |
| `signers[0][name]` | `client.contact_name` or `client.company` | Signer display name |
| `file[0]` | the rendered PDF (or HTML if PDF skipped) as a `Blob` | The document to sign |

`test_mode` is not set by this skill; set it (and a sandbox key) when validating against the
live API. See the developer docs home for `test_mode` semantics.

---

## Response handling

| Outcome | Skill result |
|---------|--------------|
| HTTP 2xx | `{ sent: true, mode: "dropbox_sign", request_id: json.signature_request.signature_request_id ?? null }` |
| HTTP non-2xx | `{ sent: false, mode: "manual", reason: "Dropbox Sign {status}: {body…} — sending manually" }` |
| Network/throw | `{ sent: false, mode: "manual", reason: "e-sign send failed ({msg}) — send the PDF manually" }` |
| No API key | `{ sent: false, mode: "manual", reason: "No DROPBOX_SIGN_API_KEY set …" }` |
| No contact email | `{ sent: false, mode: "manual", reason: "No client contact email on the deal …" }` |

Only a 2xx is ever reported as sent — the live call is unverified against production, so any
ambiguity resolves to manual.

---

## Rate limits & reliability

- Dropbox Sign enforces per-account API rate limits (HTTP `429` with a `Retry-After` header on
  excess). This skill sends at most one request per invocation, so limits are not a practical
  concern; a `429` simply degrades to the manual fallback like any other non-2xx.
- Do not auto-retry a failed send inside the skill (would risk duplicate signature requests);
  re-run `/contract {slug} --send` deliberately after fixing the cause.

---

## Security

- `DROPBOX_SIGN_API_KEY` is read from the environment via `loadEnv()` only; never hardcode it,
  never write it to an artifact, never include it in the stdout JSON.
- Auth is Basic with the key as username and empty password — standard for this API.

---

## Verify before the first real send (required)

The multipart shape above is implemented but **not validated end-to-end against production**.
A zero-shot implementer relying solely on this reference still owes one live verification
pass before the first real signature request. Perform these steps first:

1. Obtain a sandbox key and add `test_mode=1` to the form.
2. Re-confirm the host (`api.hellosign.com` vs any Dropbox-branded successor) and the Basic
   auth scheme against the current developer docs — the HelloSign domain is transitional.
3. Confirm the `signers[N][...]` array-bracket field names against the current Signature
   Request docs (link above) — Dropbox Sign occasionally adjusts field naming.
4. Confirm the success-payload path `signature_request.signature_request_id`.

Until this pass completes, keep sends in manual mode (omit `--send` or leave
`DROPBOX_SIGN_API_KEY` unset). The skill degrades safely either way.

**Last verified:** 2026-06-22
