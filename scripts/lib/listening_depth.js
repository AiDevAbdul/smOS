// scripts/lib/listening_depth.js — the pure calculators behind E5 "listening
// depth": term matching, tagged-vs-UNTAGGED classification, cross-platform
// coverage accounting, share-of-voice, and rule-based crisis detection.
//
// Pure + side-effect free (no fs, no network) so /listening and the test suite
// share exactly one implementation, the way organic_bench.js already does.
//
// ─────────────────────────── the honesty problem ───────────────────────────
// "Social listening" as sold by third-party tools implies full-web coverage.
// smOS does not have full-web coverage and this module refuses to imply it:
//
//   * IG `/tags` returns ONLY media where the client's IG account was @-tagged.
//     It is structurally incapable of returning an untagged mention.
//   * IG Hashtag Search (`/ig_hashtag_search` → `/{id}/recent_media`) is the one
//     first-party path to UNTAGGED discovery — but only for posts that carry a
//     hashtag you queried, only public top-level posts, only ~24h of recency,
//     and capped at 30 unique hashtags per IG user per rolling 7 days.
//   * Facebook has no public keyword/mention search at all on the Graph API.
//     Untagged FB discovery is limited to comments on the client's own posts.
//   * TikTok / X / LinkedIn / YouTube / Reddit have no smOS-reachable listening
//     API. They report `unavailable` with `mentions: null` — NEVER 0.
//   * A web-search-backed path (Tavily, key-gated) surfaces indexed public
//     pages. It is a real signal and it is explicitly NOT a per-platform census.
//
// Every consumer therefore gets a per-source `coverage` row, and any total or
// share computed from a partial/truncated source is labelled a FLOOR.

// ───────────────────────────── source catalog ─────────────────────────────

/**
 * What each source can actually discover. `discovers` is the load-bearing
 * field: "tagged" sources cannot answer the untagged-mention question at all.
 */
export const LISTENING_SOURCES = {
  ig_tags: {
    platform: "instagram",
    label: "IG /tags",
    discovers: "tagged",
    ceiling: "partial",
    limitation: "IG /tags returns only media where the client's IG account was @-tagged — structurally cannot return untagged mentions",
  },
  ig_hashtag: {
    platform: "instagram",
    label: "IG Hashtag Search",
    discovers: "untagged",
    ceiling: "partial",
    limitation: "public top-level posts carrying a queried hashtag only; ~24h recency window; 30 unique hashtags per IG user per rolling 7 days",
  },
  fb_own_comments: {
    platform: "facebook",
    label: "FB own-post comments",
    discovers: "untagged",
    ceiling: "partial",
    limitation: "Facebook has no public keyword/mention search — only comments on the client's own Page posts are reachable",
  },
  web_search: {
    platform: "web",
    label: "Web search (Tavily)",
    discovers: "untagged",
    ceiling: "partial",
    limitation: "indexed public pages for the queried terms — not a per-platform census, and recency depends on the index",
  },
  capture: {
    platform: "capture",
    label: "Operator/3rd-party capture",
    discovers: "untagged",
    ceiling: "partial",
    limitation: "coverage is whatever the supplied export contained — smOS cannot verify its completeness",
  },
};

/**
 * Platforms with NO smOS-reachable listening API. These exist in the coverage
 * report precisely so a reader cannot mistake their absence for zero mentions.
 */
export const NO_API_PLATFORMS = {
  tiktok: "no smOS-reachable listening API (TikTok's Display API exposes no keyword or mention search)",
  x: "no smOS-reachable listening API (X API v2 recent-search requires a paid tier that is not configured)",
  linkedin: "no smOS-reachable listening API (LinkedIn exposes no public mention or keyword search)",
  youtube: "no smOS-reachable listening API (YouTube Data API search is not configured in smOS)",
  reddit: "no smOS-reachable listening API (Reddit search is not configured in smOS)",
};

// ───────────────────────────── term matching ─────────────────────────────

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does `text` contain `term` as a word/hashtag/handle rather than a substring? */
export function containsTerm(text, term) {
  const t = String(term || "").trim().toLowerCase();
  if (!t) return false;
  const hay = String(text || "").toLowerCase();
  if (!hay) return false;
  // Allow an optional leading # or @ and require a non-word boundary either
  // side, so "acme" does not match "acmefoundation" but "#acme" and "@acme" do.
  const re = new RegExp(`(^|[^\\w#@])[#@]?${escapeRe(t)}([^\\w]|$)`, "i");
  return re.test(hay);
}

/**
 * Which watchlist terms a piece of text mentions, split by list. Returns
 * canonical (lowercased, sigil-stripped) terms.
 */
export function matchTerms(text, watchlist) {
  const wl = watchlist || {};
  const hit = (list) => (list || []).filter((t) => containsTerm(text, t));
  const competitors = (wl.competitors || [])
    .filter((c) => (c.terms || [c.handle]).some((t) => containsTerm(text, t)))
    .map((c) => c.handle);
  return {
    brand_terms: hit(wl.brand_terms),
    keywords: hit(wl.keywords),
    hashtags: hit(wl.hashtags),
    competitors,
  };
}

/**
 * Normalize one raw mention from any source into the single cross-platform
 * shape. `discovery` records HOW we found it — "tagged" when the client was
 * @-tagged (or the API is tagged-only), "untagged" otherwise — which is the
 * whole point of E5's untagged-mention monitoring.
 */
export function normalizeMention(raw, { watchlist, source } = {}) {
  const r = raw || {};
  const src = source || r.source_id || r.source || "capture";
  const meta = LISTENING_SOURCES[src] || null;
  const text = r.text ?? r.caption ?? r.message ?? r.content ?? "";
  const matched = matchTerms(text, watchlist);
  const explicitlyTagged = r.tagged === true || meta?.discovers === "tagged";
  const brandTermHit = matched.brand_terms.length > 0;
  const discovery = explicitlyTagged ? "tagged" : "untagged";
  return {
    mention_id: mentionId({ source: src, url: r.url ?? r.permalink ?? null, text, at: r.at ?? r.timestamp ?? null }),
    source: src,
    platform: r.platform ?? meta?.platform ?? "unknown",
    discovery,
    text,
    url: r.url ?? r.permalink ?? r.link ?? null,
    at: r.at ?? r.timestamp ?? r.created_time ?? r.published_date ?? null,
    author: r.author ?? r.username ?? null,
    matched_terms: matched,
    // A tagged mention is about the client by construction. An untagged one is
    // only attributable when a brand term actually appears in the text.
    about_client: explicitlyTagged || brandTermHit,
    sentiment: r.sentiment ?? null,
  };
}

/** Deterministic id so the same mention re-pulled tomorrow is not a new row. */
export function mentionId({ source, url, text, at }) {
  const basis = `${source || ""}|${url || ""}|${at || ""}|${String(text || "").slice(0, 120)}`;
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  return `m_${(h >>> 0).toString(36)}`;
}

/** Drop duplicates by mention_id, keeping the first (richer) occurrence. */
export function dedupeMentions(mentions) {
  const seen = new Set();
  const out = [];
  for (const m of mentions || []) {
    if (seen.has(m.mention_id)) continue;
    seen.add(m.mention_id);
    out.push(m);
  }
  return out;
}

// ──────────────────────────── coverage report ────────────────────────────

/**
 * One coverage row per attempted source, plus one per platform smOS cannot
 * reach at all.
 *
 * status:
 *   "partial"     — the source ran and returned data, but its ceiling is partial
 *                   (every first-party source smOS has is partial; see header)
 *   "unavailable" — no API path exists, or no token/key ⇒ `mentions: null`
 *   "error"       — the call failed ⇒ `mentions: null`
 *   "skipped"     — deliberately not run (offline, flag off) ⇒ `mentions: null`
 *
 * `mentions` is NEVER 0 for a source that did not run. Zero means "ran and
 * found nothing"; null means "we do not know".
 */
export function coverageRow(source, { status, mentions = null, truncated = false, reason = null, queried = null } = {}) {
  const meta = LISTENING_SOURCES[source] || {};
  const ran = status === "partial" || status === "ok";
  return {
    source,
    platform: meta.platform ?? "unknown",
    discovers: meta.discovers ?? null,
    status,
    mentions: ran ? Number(mentions || 0) : null,
    truncated: ran ? Boolean(truncated) : null,
    queried,
    reason: reason ?? (ran ? meta.limitation ?? null : null),
    limitation: meta.limitation ?? null,
  };
}

/** Coverage rows for the platforms with no reachable API — always `null`. */
export function noApiCoverage(platforms = Object.keys(NO_API_PLATFORMS)) {
  return platforms
    .filter((p) => NO_API_PLATFORMS[p])
    .map((p) => ({
      source: `${p}_none`,
      platform: p,
      discovers: null,
      status: "unavailable",
      mentions: null,
      truncated: null,
      queried: null,
      reason: NO_API_PLATFORMS[p],
      limitation: NO_API_PLATFORMS[p],
    }));
}

/** Sources that actually produced data — the only legitimate basis for a total. */
export function measuredSources(coverage) {
  return (coverage || []).filter((c) => c.mentions != null);
}

/**
 * A cross-platform mention total is a FLOOR whenever any contributing source is
 * partial-by-ceiling or truncated, or any platform is unmeasured — which, given
 * the API reality documented above, is essentially always. Say so.
 */
export function mentionTotal(coverage) {
  const measured = measuredSources(coverage);
  const unmeasured = (coverage || []).filter((c) => c.mentions == null);
  if (!measured.length) {
    return { total: null, is_floor: null, basis: [], unmeasured: unmeasured.map((c) => c.platform), reason: "no source produced data" };
  }
  const total = measured.reduce((a, c) => a + c.mentions, 0);
  const is_floor = measured.some((c) => c.status === "partial" || c.truncated) || unmeasured.length > 0;
  return {
    total,
    is_floor,
    basis: measured.map((c) => c.source),
    unmeasured: unmeasured.map((c) => c.platform),
    reason: is_floor ? "computed from partial/truncated sources with unmeasured platforms — a floor, not the real total" : null,
  };
}

// ──────────────────────────── share of voice ────────────────────────────

/**
 * Client vs named competitors, computed ONLY over the platforms that produced
 * real data.
 *
 * Rules:
 *  - An entity with no watchlist terms cannot be counted → its share is null,
 *    not 0 (missing data must not score as good news for anyone).
 *  - `basis_platforms` names exactly which platforms the share was computed on.
 *  - `confidence` is the share of *listed* platforms that produced data.
 *  - `is_floor` is true when any contributing source was partial or truncated.
 *  - Zero attributable mentions across the board → shares null with a reason
 *    (a 100%/0% split off zero data is a lie, not a finding).
 */
export function shareOfVoice({ mentions = [], coverage = [], watchlist = {} } = {}) {
  const measured = measuredSources(coverage);
  const measuredSourceIds = new Set(measured.map((c) => c.source));
  const basisPlatforms = [...new Set(measured.map((c) => c.platform))];
  const unmeasured = [...new Set((coverage || []).filter((c) => c.mentions == null).map((c) => c.platform))];

  const brandTerms = watchlist.brand_terms || [];
  const competitors = watchlist.competitors || [];

  const scoped = (mentions || []).filter((m) => measuredSourceIds.has(m.source));

  const countFor = (predicate) => scoped.filter(predicate).length;
  const clientCount = brandTerms.length
    ? countFor((m) => m.about_client || (m.matched_terms?.brand_terms || []).length > 0)
    : null;
  const rows = competitors.map((c) => ({
    entity: c.name || c.handle,
    handle: c.handle,
    is_client: false,
    mentions: countFor((m) => (m.matched_terms?.competitors || []).includes(c.handle)),
  }));
  rows.unshift({
    entity: watchlist.client_name || "client",
    handle: brandTerms[0] ?? null,
    is_client: true,
    mentions: clientCount,
    // No brand term ⇒ we cannot tell a client mention from any other mention.
    reason: brandTerms.length ? null : "no brand_terms on the watchlist — client mentions are not identifiable",
  });

  const countable = rows.filter((r) => r.mentions != null);
  const denominator = countable.reduce((a, r) => a + r.mentions, 0);
  const withShare = rows.map((r) => ({
    ...r,
    share_pct: r.mentions == null || denominator === 0 ? null : Number(((r.mentions / denominator) * 100).toFixed(1)),
  }));

  const listedPlatforms = [...new Set((coverage || []).map((c) => c.platform))];
  const confidence = listedPlatforms.length
    ? Number((basisPlatforms.length / listedPlatforms.length).toFixed(2))
    : null;
  const isFloor = measured.some((c) => c.status === "partial" || c.truncated) || unmeasured.length > 0;

  return {
    entities: withShare,
    total_attributed: measured.length ? denominator : null,
    basis_platforms: basisPlatforms,
    unmeasured_platforms: unmeasured,
    confidence,
    is_floor: measured.length ? isFloor : null,
    status: !measured.length
      ? "no_data"
      : denominator === 0
        ? "no_attributable_mentions"
        : "computed",
    reason: !measured.length
      ? "no platform produced data — share of voice is undefined"
      : denominator === 0
        ? "no mention matched the client or any listed competitor — shares are null, not 0/100"
        : isFloor
          ? "computed on partial/truncated sources — every share is a floor for the platforms listed in basis_platforms"
          : null,
  };
}

// ───────────────────────── baseline + crisis rules ─────────────────────────

/** Minimum prior data points before any spike claim is allowed to fire. */
export const MIN_BASELINE_POINTS = 5;
/** Minimum sentiment-classified mentions before a negative-skew claim fires. */
export const MIN_CLASSIFIED_MENTIONS = 5;

/**
 * Rolling baseline over the points BEFORE the current one. Returns null when
 * there are fewer than `minPoints` — an insufficient baseline is not a zero
 * baseline, and treating it as one is exactly how a first-ever run gets
 * reported as a 100x spike.
 */
export function rollingBaseline(points, { window = 14, minPoints = MIN_BASELINE_POINTS, field = "mentions" } = {}) {
  const prior = (points || []).map((p) => p?.[field]).filter((v) => Number.isFinite(v));
  if (prior.length < minPoints) {
    return { mean: null, stddev: null, points: prior.length, sufficient: false, required: minPoints };
  }
  const win = prior.slice(-window);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const variance = win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length;
  return {
    mean: Number(mean.toFixed(2)),
    stddev: Number(Math.sqrt(variance).toFixed(2)),
    points: win.length,
    sufficient: true,
    required: minPoints,
  };
}

/** Negative share of the mentions that actually carry a sentiment verdict. */
export function sentimentSkew(mentions, { minClassified = MIN_CLASSIFIED_MENTIONS } = {}) {
  const classified = (mentions || []).filter((m) => m?.sentiment != null);
  if (classified.length < minClassified) {
    return {
      negative_share: null,
      classified: classified.length,
      required: minClassified,
      sufficient: false,
      unclassified: (mentions || []).length - classified.length,
    };
  }
  const negative = classified.filter((m) => m.sentiment === "negative").length;
  return {
    negative_share: Number((negative / classified.length).toFixed(3)),
    negative,
    classified: classified.length,
    required: minClassified,
    sufficient: true,
    unclassified: (mentions || []).length - classified.length,
  };
}

/**
 * Rule-based crisis detector.
 *
 * Three weighted signals, each scored only when its own data exists:
 *   volume_spike (weight 3) — current volume vs the rolling baseline mean
 *   negative_skew (weight 3) — share of classified mentions that are negative
 *   velocity     (weight 2) — jump vs the immediately preceding point
 *
 * A missing signal is removed from the DENOMINATOR, never scored zero (the same
 * rule /crm health follows). `confidence` reports what share of the weighting
 * had data; under 0.5 the severity is flagged provisional — a hint, not a
 * finding. With no sufficient baseline the severity is `null` /
 * `insufficient_data`: crisis detection never fires off a single datapoint.
 *
 * @param {object} o
 * @param {number} o.current            mentions in the current capture
 * @param {Array}  o.priorPoints        prior time-series points (excludes current)
 * @param {Array}  o.mentions           the current capture's normalized mentions
 * @returns {object} severity + reason + evidence
 */
export function detectCrisis({ current, priorPoints = [], mentions = [], baselineWindow = 14 } = {}) {
  const baseline = rollingBaseline(priorPoints, { window: baselineWindow });
  const skew = sentimentSkew(mentions);
  const evidence = [];

  if (!baseline.sufficient) {
    return {
      severity: null,
      status: "insufficient_data",
      confidence: null,
      baseline,
      sentiment: skew,
      reasons: [
        `only ${baseline.points} prior listening point(s) on file — ${baseline.required} are required before any spike can be called`,
      ],
      evidence: [],
    };
  }

  const cur = Number.isFinite(current) ? current : null;
  const signals = [];

  // 1. volume spike vs baseline mean
  if (cur == null) {
    signals.push({ name: "volume_spike", weight: 3, score: null, reason: "current volume unknown" });
  } else if (baseline.mean === 0) {
    // A first non-zero mention against a flat-zero baseline is notable but is
    // not a ratio; ratio arithmetic on a zero mean is undefined, not infinite.
    const hit = cur >= 3;
    signals.push({ name: "volume_spike", weight: 3, score: hit ? 1 : 0, detail: { current: cur, baseline_mean: 0, ratio: null } });
    if (hit) evidence.push(`${cur} mentions against a baseline of 0 over ${baseline.points} prior point(s) (ratio undefined — zero baseline)`);
  } else {
    const ratio = Number((cur / baseline.mean).toFixed(2));
    const score = ratio >= 3 ? 1 : ratio >= 2 ? 0.5 : 0;
    signals.push({ name: "volume_spike", weight: 3, score, detail: { current: cur, baseline_mean: baseline.mean, ratio } });
    if (score > 0) evidence.push(`volume ${cur} vs baseline mean ${baseline.mean} over ${baseline.points} point(s) = ${ratio}x`);
  }

  // 2. negative sentiment skew — excluded from the denominator when unmeasured
  if (!skew.sufficient) {
    signals.push({ name: "negative_skew", weight: 3, score: null, reason: `only ${skew.classified} of ${mentions.length} mention(s) carry a sentiment verdict — ${skew.required} required` });
  } else {
    const s = skew.negative_share;
    const score = s >= 0.5 ? 1 : s >= 0.3 ? 0.5 : 0;
    signals.push({ name: "negative_skew", weight: 3, score, detail: { negative_share: s, classified: skew.classified } });
    if (score > 0) evidence.push(`${(s * 100).toFixed(0)}% of ${skew.classified} classified mention(s) are negative`);
  }

  // 3. velocity vs the immediately preceding point
  const prev = [...priorPoints].reverse().find((p) => Number.isFinite(p?.mentions))?.mentions;
  if (cur == null || !Number.isFinite(prev)) {
    signals.push({ name: "velocity", weight: 2, score: null, reason: "no comparable preceding point" });
  } else {
    const delta = cur - prev;
    const sigma = baseline.stddev;
    const score = sigma > 0 && delta >= 2 * sigma ? 1 : delta > 0 && cur >= prev * 2 ? 0.5 : 0;
    signals.push({ name: "velocity", weight: 2, score, detail: { previous: prev, current: cur, delta, stddev: sigma } });
    if (score > 0) evidence.push(`velocity +${delta} vs the prior point (${prev} → ${cur}), baseline sd ${sigma}`);
  }

  const scored = signals.filter((s) => s.score != null);
  const availableWeight = scored.reduce((a, s) => a + s.weight, 0);
  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  if (!availableWeight) {
    return {
      severity: null,
      status: "insufficient_data",
      confidence: 0,
      baseline,
      sentiment: skew,
      signals,
      reasons: ["no crisis signal had enough data to score"],
      evidence: [],
    };
  }
  const weighted = scored.reduce((a, s) => a + s.score * s.weight, 0) / availableWeight;
  const confidence = Number((availableWeight / totalWeight).toFixed(2));

  const severity = weighted >= 0.75 ? "critical" : weighted >= 0.5 ? "elevated" : weighted > 0 ? "watch" : "none";

  return {
    severity,
    status: "computed",
    score: Number(weighted.toFixed(2)),
    confidence,
    // Under half the weighting had data — a hint, not a finding.
    severity_provisional: confidence < 0.5,
    baseline,
    sentiment: skew,
    signals,
    reasons: severity === "none"
      ? ["no signal tripped its threshold"]
      : evidence.slice(),
    evidence,
    requires_human: severity === "critical" || severity === "elevated",
  };
}
