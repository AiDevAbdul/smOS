# brand-name — Domain Standards

Self-contained naming + verbal-identity expertise for `/brand-name`. Read this when
generating candidates, interpreting screen results, or drafting the verbal layer.

## 1. Name-Type Taxonomy

| Type | Definition | Example | Trademark defensibility |
|------|-----------|---------|-------------------------|
| Descriptive | Says what it does | "Salesforce", "PayPal" | WEAK — hard to register, generic risk |
| Suggestive | Hints at benefit | "Netflix", "Pinterest" | MEDIUM — register-able, evocative |
| Abstract / arbitrary | Real word, unrelated meaning | "Apple", "Amazon" | STRONG |
| Coined / invented | Made-up word | "Kodak", "Häagen-Dazs", "Verizon" | STRONGEST — inherently distinctive |
| Compound | Two words fused | "Facebook", "Snapchat" | MEDIUM–STRONG |

**Rule:** In a crowded category, bias toward coined/abstract — they screen cleaner on
trademark and own a unique `.com`. Descriptive names trade short-term clarity for
long-term legal weakness.

## 2. Generation Targets

- Generate **15–30** candidates spanning all five types (do not produce only one type).
- Shortlist **~6** for screening. Screening is network-bound; do not screen all 30.
- Reuse the approved **strategy layer** (archetype, positioning, persona, values) as the
  generation seed — never cold-prompt. A "sage" archetype names differently from an "outlaw".

## 3. Shortlist Scoring Dimensions

Score each candidate 1–5 on:

| Dimension | What good looks like |
|-----------|----------------------|
| Memorability | Sticks after one exposure; concrete imagery |
| Pronounceability | One obvious reading; no spelling ambiguity |
| Distinctiveness | Not a near-clone of category leaders |
| Cultural soundness | No negative meaning/slur in target-market languages |
| Extensibility | Won't box the brand into one product line |

## 4. The Three Independent Gates

The gates are **independent** — a name can pass `.com` and fail trademark, or vice versa.
All three must look clean (and the attorney must clear) before a name is safe.

### Gate A — `.com` availability (authority signal)
- Method: `node:dns` `resolveNs` then `resolve`. A resolvable record ⇒ **taken** (`available: false`).
- No record ⇒ **`null` (unknown)** — DNS absence is a weak signal, not proof of availability.
  Confirm at a registrar / RDAP before relying on it.

### Gate B — Trademark knockout (advisory ONLY)
- A hit rules a name **OUT**. No hit is **NEVER** clearance.
- `trademark_knockout_clear` semantics: `false` = conflicting live mark(s) found;
  `true` = no identical live marks in the quick search (still NOT clearance);
  `null` = could not run (no API key / API error).
- `attorney_clearance_flagged` is **always `true`**, regardless of the knockout result.

### Gate C — Social handles (can only PROVE free)
- Unauthenticated GET. Clean **404 ⇒ `true`** (definitely free).
- **200 / redirect / block ⇒ `null`** (unknown) — IG/FB/TikTok/X serve a 200 app shell for
  nonexistent handles, so 200 ≠ taken. Never report `false` from an unauthenticated 200.
- Handles checked: instagram, facebook, x, tiktok, linkedin (company path).

**The `null` discipline:** every gate fails OPEN to `null`, never silently to "available".
A `null` is an instruction to verify manually, not a green light.

## 5. Verbal Identity Frameworks (post-pick)

### Voice
- **3–5 traits** (e.g. "Confident, Warm, Plainspoken").
- **Spectrums** (NN/g style): Formal↔Casual, Serious↔Funny, Respectful↔Irreverent,
  Matter-of-fact↔Enthusiastic — place the brand on each.
- **Do / Don't** lists feed the `brand-compliance` guard's `avoid` enforcement downstream.

### Messaging House
- **Roof** = the single overarching message / brand promise.
- **Walls** = 3 supporting message pillars.
- **Foundation** = proof points / reasons to believe under the pillars.

### Tagline / pitch / boilerplate
- Tagline ≤ ~5 words, ownable, not a category descriptor.
- Elevator pitch: one sentence, problem → solution → differentiator.
- Boilerplate: 2–4 sentence "About" paragraph for press/profiles.

## 6. Good vs Bad

| Situation | Bad | Good |
|-----------|-----|------|
| Trademark `null` (no API key) | Tell client "name is clear" | "Knockout not run — manual USPTO search + attorney required" |
| Handle returns 200 | Mark `facebook: false` (taken) | Mark `facebook: null` (unknown, verify authenticated) |
| Crowded SaaS category | "DataCloudPro" (descriptive, weak) | "Vantia" (coined, defensible, clean `.com`) |
| Picking the name | AI auto-selects the top score | AI recommends; human picks and stamps `--approve-name` |
| `.com` has no DNS record | Report `available: true` | Report `available: null`, confirm at registrar |
