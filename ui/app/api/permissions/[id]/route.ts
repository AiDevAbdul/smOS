// GET /api/permissions/:id — polled by mcp/ui-permission-bridge (every
// ~500ms per its own loop) until `status` is no longer "pending". Simple
// short-lived poll rather than a long-poll/hold-open request: the bridge
// already owns the wait loop and timeout (~5 min, then deny-closed), so this
// handler just answers instantly with current state each time — cheaper and
// simpler than holding a Next.js route handler open for minutes.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getRequest } from "../../../../lib/permissions";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const record = getRequest(id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ record });
}
