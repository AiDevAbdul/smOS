// schemas/index.js — canonical artifact contracts for the smOS paid pipeline.
//
// Every producer and consumer of a handoff JSON imports the SAME module here, so a
// field rename can never silently break a chain again. Each artifact module exports:
//   normalize(raw)  -> lenient: coerces drifted/aliased shapes to ONE canonical shape
//   validate(obj)   -> fail-closed: { ok, errors[] } naming every missing/bad field
//
// Usage in a producer:   const out = adCopy.normalize(built);
//                         adCopy.assertValid? -> use shared assertValid(name, out, adCopy.validate)
// Usage in a consumer:    const map = audienceMap.normalize(JSON.parse(read(path)));
//                         const v = audienceMap.validate(map);
//                         if (!v.ok) { halt naming v.errors }

export * as shared from "./_shared.js";
export { SchemaError, assertValid, angleId } from "./_shared.js";

export * as adCopy from "./ad_copy.js";
export * as strategyBrief from "./strategy_brief.js";
export * as audienceMap from "./audience_map.js";
export * as clientProfile from "./client_profile.js";
export * as brandProfile from "./brand_profile.js";
export * as deal from "./deal.js";
export * as baselineSnapshot from "./baseline_snapshot.js";
export * as competitorIntel from "./competitor_intel.js";
export * as launchPlan from "./launch_plan.js";

// Phase 2/3 surfaces (organic OS + differentiation)
export * as inboxItem from "./inbox_item.js";
export * as contentPlan from "./content_plan.js";
export * as attributionReport from "./attribution_report.js";
export * as asset from "./asset.js";
export * as listeningSnapshot from "./listening_snapshot.js";
