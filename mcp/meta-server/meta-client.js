/**
 * MCP Meta client — now a thin wrapper around the canonical client in
 * scripts/lib/meta-graph.js. This is what closed the C1 finding: the MCP path
 * and the skill path share ONE request core, so the fail-closed guard
 * chokepoint, retry/backoff, and token-expiry handling apply to both. Do not
 * reintroduce a second axios client here.
 */

import { createGraph } from "../../scripts/lib/meta-graph.js";

export function createMetaClient(token = process.env.META_ACCESS_TOKEN) {
  if (!token) throw new Error("META_ACCESS_TOKEN environment variable is required");
  // createGraph already exposes get/post/delete/act/paginate with guards + retry.
  return createGraph(token);
}

export { TokenExpiredError } from "../../scripts/lib/meta-graph.js";
