# Lead Scoring — Domain Standards

Self-contained reference for the deterministic lead-quality model implemented in
`skills/leads/leads.js`. No LLM is used at runtime; scoring is pure local logic so it
is reproducible and auditable.

---

## 1. Score model

Every lead starts at a **base score of 70** and is adjusted by signed signals, then
clamped to `[0, 100]`. Each triggered signal pushes a machine-readable string onto
`score_reasons` so a human can audit any tier later.

```
score = clamp(0, 100, 70 + Σ(signal weights))
```

### Signal weights (exact, as implemented)

| Signal (reason string) | Weight | When it fires |
|---|---:|---|
| `malformed_email` | −60 | Email present but fails `^[^@\s]+@[^@\s]+\.[^@\s]+$` |
| `disposable_email` | −50 | Email domain is in the disposable-domain set (below) |
| `no_email` | −30 | No `email` / `email_address` field at all |
| `phone_length_invalid` | −30 | Digits-only phone length `< 7` or `> 15` |
| `phone_obvious_repeat` | −40 | Phone is all one repeated digit, or exactly `1234567890` |
| `name_too_short` | −30 | Any whitespace-split name part has `< 2` chars |
| `name_lowercase_junk` | −30 | Full name is all-lowercase ASCII words (e.g. `asdf asdf`) |
| `name_all_caps` | −10 | Full name is all-uppercase and contains a letter |
| `organic_submission` | +10 | `is_organic === true` (direct form, not paid click) |

> Weights are intentionally additive and can stack (a malformed email AND a repeated
> phone = −60 −40 = −100 → clamps to 0). Do not "early-return" on the first failure;
> the cumulative reasons are the audit trail.

### Tier floors

| Tier | Condition |
|---|---|
| `qualified` | `score >= 70` (`QUALIFIED_FLOOR`) |
| `review` | `40 <= score < 70` (`REVIEW_FLOOR`) |
| `junk` | `score < 40` |

These floors are CONSTANT in the skill. A client may want a stricter qualified bar —
that is a per-client override discussion, not a code change to make silently.

### Why base 70

A clean lead with a real Gmail address, a normal phone, and a two-word name triggers
**no** negative signals → stays at 70 → `qualified`. Generic free-mail domains
(gmail/yahoo/hotmail/outlook/icloud) are explicitly **neutral (+0)**: a consumer lead
on a free provider is normal and must not be penalized. Junk is detected by *malformed*
data, *disposable* domains, and *bot-pattern* names/phones — not by provider snobbery.

---

## 2. Disposable-domain taxonomy

Hardcoded set (case-insensitive, exact domain match on the part after `@`):

```
mailinator.com, guerrillamail.com, 10minutemail.com, tempmail.com,
throwaway.email, yopmail.com, trashmail.com, sharklasers.com,
getairmail.com, fakeinbox.com
```

Keeping current: this is a curated allow-of-known-bad list, not exhaustive. Add a domain
only when a real junk lead proves it; never wildcard a whole TLD (false-positive risk).

---

## 3. Field-name taxonomy (normalization)

Meta returns `field_data` as `[{ name, values: [...] }]`. Normalization:

1. `key = name.toLowerCase().replace(/\s+/g, "_")` (drop entries with no name).
2. Single-value arrays unwrap to the scalar; multi-value arrays stay arrays.

Scoring then reads these canonical keys (first match wins):

| Concept | Keys checked |
|---|---|
| Email | `email`, `email_address` |
| Phone | `phone_number`, `phone` (digits-only after stripping non-digits) |
| Name | `full_name`, else `first_name` + `last_name` joined |

Custom-question fields (e.g. `what_is_your_budget`) are preserved verbatim and flow
through to CSV columns, but do not affect the score.

---

## 4. Good / bad examples

**Good (qualified, score 70):**
```json
{ "email": "jane.doe@gmail.com", "phone_number": "+1 415 555 0132", "full_name": "Jane Doe" }
```
No negative signals; free-mail is neutral; phone is 11 digits (in 7–15 range).

**Bad — bot fill (score 0, junk):**
```json
{ "email": "asdf", "phone_number": "1111111111", "full_name": "asdf asdf" }
```
`malformed_email` −60, `phone_obvious_repeat` −40, `name_lowercase_junk` −30,
`name_too_short` −30 → −160 → clamps to 0.

**Borderline (review, score 50):**
```json
{ "email": "lead@guerrillamail.com", "phone_number": "+44 20 7946 0958", "full_name": "Sam P" }
```
`disposable_email` −50, `name_too_short` (`P` is 1 char) −30, plus base 70 = −10 →
clamps to 0... → actually junk. Tune intuition against the table, not memory.

> Lesson from the borderline case: stacked penalties drop fast. When in doubt, compute
> `70 + Σweights` explicitly rather than eyeballing the tier.

---

## 5. Operating cadence

- Meta retains leads for **90 days** (API/Ads Manager/Business Suite). Sync more often
  than that — a daily or weekly cron is typical.
- First run with no state defaults to the **last 7 days** per form.
- For high-volume forms, prefer a real-time `leadgen` **webhook** over polling to avoid
  both expiry and rate-limit exposure (see `api-reference.md`).
