/**
 * Read-verification of the Meta assets a zero-start client's setup claims (E3).
 *
 * Why: /setup-accounts records the manual gates on the operator's word (`--done`),
 * which is correct for the steps the API cannot see (business verification, a card
 * on file). But two of them the API CAN see — the Page and the IG↔Page link — and
 * `ig_page_linked_at` is the one that silently breaks everything downstream:
 * /publish, /inbox and IG ad placements all resolve IG through the Page edge, so a
 * gate stamped before the link actually exists turns into a null-halt three skills
 * later. Here we read the edge and refuse the stamp until Meta agrees.
 *
 * Everything is a GET through the guarded graph client; nothing here writes.
 */

/** Treat "", null, "TBD", "tbd" as absent (mirrors meta-graph.isTbd). */
function absent(v) {
  return v == null || v === "" || String(v).trim().toUpperCase() === "TBD";
}

/**
 * Verify the Page exists and is readable with the current token.
 * @returns {Promise<{ok:boolean, page_id:string|null, name:string|null, reason:string|null}>}
 */
export async function verifyPage(graph, pageId) {
  if (absent(pageId)) return { ok: false, page_id: null, name: null, reason: "no facebook_page_id on record" };
  try {
    const res = await graph.get(`/${pageId}`, { fields: "id,name" });
    if (!res?.id) return { ok: false, page_id: String(pageId), name: null, reason: `Graph returned no id for page ${pageId}` };
    return { ok: true, page_id: String(res.id), name: res.name ?? null, reason: null };
  } catch (e) {
    return { ok: false, page_id: String(pageId), name: null, reason: `Graph GET /${pageId} failed: ${e.message}` };
  }
}

/**
 * Verify the Instagram professional account is linked to the Page, and that it is
 * the SAME account the profile already records (a mismatch means somebody linked a
 * different IG — reporting "linked" there would be worse than reporting nothing).
 *
 * @returns {Promise<{ok:boolean, page_id:string|null, instagram_business_id:string|null,
 *   username:string|null, mismatch:boolean, recorded_instagram_business_id:string|null,
 *   reason:string|null}>}
 */
export async function verifyIgPageLink(graph, { pageId, igId } = {}) {
  const base = {
    ok: false, page_id: absent(pageId) ? null : String(pageId), instagram_business_id: null,
    username: null, mismatch: false,
    recorded_instagram_business_id: absent(igId) ? null : String(igId), reason: null,
  };
  if (absent(pageId)) {
    return { ...base, reason: "no facebook_page_id on record — record the Page gate first" };
  }
  let res;
  try {
    res = await graph.get(`/${pageId}`, { fields: "id,name,instagram_business_account{id,username}" });
  } catch (e) {
    return { ...base, reason: `Graph GET /${pageId} failed: ${e.message}` };
  }
  const linked = res?.instagram_business_account;
  if (!linked?.id) {
    return {
      ...base,
      reason: `Page ${pageId} has no linked instagram_business_account. Link the IG professional account to the Page in Meta Business Suite (Settings → Linked accounts), then re-run.`,
    };
  }
  const liveId = String(linked.id);
  if (base.recorded_instagram_business_id && base.recorded_instagram_business_id !== liveId) {
    return {
      ...base,
      instagram_business_id: liveId,
      username: linked.username ?? null,
      mismatch: true,
      reason: `Page ${pageId} is linked to IG ${liveId} (@${linked.username || "?"}) but the profile records ${base.recorded_instagram_business_id}. Resolve which account is the client's before stamping the gate.`,
    };
  }
  return {
    ...base, ok: true, instagram_business_id: liveId, username: linked.username ?? null,
  };
}
