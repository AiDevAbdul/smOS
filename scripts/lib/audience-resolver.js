// scripts/lib/audience-resolver.js — turn audience_map RT/LAL specs into REAL
// Meta custom-audience IDs (H5).
//
// launch.js used to hard-code `custom_audiences: [{ id: "<TBD_...>" }]`, which Meta
// rejects on --execute. This resolver looks up existing custom audiences by a
// deterministic name and (only when create=true) creates the missing ones, then
// stores the spec_id → real_id map under audience_map.resolved_audiences so both
// the strategy brief and launch can reference real IDs.
//
// All writes go through the guarded graph chokepoint. Creating audiences is
// consequential, so create defaults to FALSE — callers opt in explicitly.

/** Deterministic, human-readable, matchable name for a retargeting/lookalike spec. */
export function audienceName(slug, layer) {
  if (layer.source === "lookalike" || layer.type === "lookalike") {
    const pct = layer.ratio ? `${Math.round(layer.ratio * 100)}pct` : (layer.label || "1pct");
    return `smOS ${slug} LAL ${pct}`.replace(/\s+/g, " ").trim();
  }
  const src = String(layer.source || "pixel").toUpperCase();
  const win = layer.window_days ? `${layer.window_days}d` : "";
  return `smOS ${slug} RT ${src} ${win}`.replace(/\s+/g, " ").trim();
}

/** Pure: merge a resolved map into an audience_map (does not mutate input). */
export function applyResolved(audienceMap, resolved) {
  return {
    ...audienceMap,
    resolved_audiences: { ...(audienceMap?.resolved_audiences || {}), ...resolved },
  };
}

/** Pure: the look up the real id for a launch audience entry, or null. */
export function resolvedIdFor(audienceMap, audience) {
  return audienceMap?.resolved_audiences?.[audience?.id] ?? null;
}

function pixelRuleBody(name, layer, pixelId) {
  const retention = layer.window_days || 30;
  if (layer.source === "pixel" && pixelId) {
    return {
      name,
      subtype: "WEBSITE",
      retention_days: retention,
      prefill: true,
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [{
            event_sources: [{ type: "pixel", id: pixelId }],
            retention_seconds: retention * 86400,
            filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "PageView" }] },
          }],
        },
      }),
    };
  }
  // Non-pixel sources (IG/FB engagement) need a page id we don't have here.
  return { name, subtype: "ENGAGEMENT", retention_days: retention };
}

/**
 * Resolve every RT/LAL spec in audience_map to a real Meta custom audience id.
 * Returns { resolved: {specId:realId}, created, errors, warnings }. Never throws
 * on a per-audience failure — collects errors so launch can decide.
 */
export async function resolveAudiences(graph, adAccountId, audienceMap, opts = {}) {
  const { slug, pixelId = null, country = "US", create = false } = opts;
  const resolved = {};
  const created = [];
  const errors = [];
  const warnings = [];

  let existing = [];
  try {
    const r = await graph.get(`/${graph.act(adAccountId)}/customaudiences`, { fields: "id,name,subtype", limit: 500 });
    existing = r.data || [];
  } catch (e) {
    errors.push(`list customaudiences: ${e.message}`);
  }
  const byName = new Map(existing.map((a) => [a.name, a.id]));

  // ── Retargeting layers ──
  for (const layer of audienceMap?.retargeting_layers || []) {
    const name = audienceName(slug, layer);
    if (byName.has(name)) { resolved[layer.id] = byName.get(name); continue; }
    if (!create) { warnings.push(`no existing audience "${name}" for ${layer.id} — re-run with --create to make it`); continue; }
    if (layer.source === "pixel" && !pixelId) { warnings.push(`cannot create ${layer.id}: no pixel_id`); continue; }
    try {
      const res = await graph.post(`/${graph.act(adAccountId)}/customaudiences`, pixelRuleBody(name, layer, pixelId));
      resolved[layer.id] = res.id;
      created.push({ id: res.id, name, spec: layer.id });
      byName.set(name, res.id);
    } catch (e) {
      errors.push(`create ${name}: ${e.message}`);
    }
  }

  // ── Lookalikes ──
  const lalSpecRaw = audienceMap?.lookalikes ?? audienceMap?.lookalike ?? [];
  const lals = (Array.isArray(lalSpecRaw) ? lalSpecRaw : [lalSpecRaw]).filter(Boolean);
  for (const lal of lals) {
    const specId = lal.id || "LAL_1PCT";
    const name = audienceName(slug, { ...lal, source: "lookalike" });
    if (byName.has(name)) { resolved[specId] = byName.get(name); continue; }
    const seedId = lal.seed_audience_id || (lal.seed && resolved[lal.seed]) || null;
    if (!create || !seedId) {
      warnings.push(`lookalike ${specId} not resolved (need seed_audience_id${create ? "" : " + --create"})`);
      continue;
    }
    try {
      const res = await graph.post(`/${graph.act(adAccountId)}/customaudiences`, {
        subtype: "LOOKALIKE",
        name,
        lookalike_spec: JSON.stringify({
          type: "similarity",
          ratio: lal.ratio || 0.01,
          country,
          origin: [{ id: seedId, type: "CUSTOM_AUDIENCE" }],
        }),
      });
      resolved[specId] = res.id;
      created.push({ id: res.id, name, spec: specId });
    } catch (e) {
      errors.push(`create LAL ${name}: ${e.message}`);
    }
  }

  return { resolved, created, errors, warnings };
}
