// POST /api/permissions/:id/decide — the human's Allow/Deny click from the
// RunConsole permission banner lands here: {behavior: "allow"|"deny", note?}.
// Marks the in-memory request decided; the bridge's next poll picks it up
// and returns the MCP permission result to the running `claude -p` process.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { decideRequest } from "../../../../../lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const behavior = body?.behavior;
  if (behavior !== "allow" && behavior !== "deny") {
    return NextResponse.json({ error: "behavior must be 'allow' or 'deny'" }, { status: 400 });
  }
  const note = typeof body?.note === "string" ? body.note : undefined;
  const decidedBy = typeof body?.decidedBy === "string" ? body.decidedBy : undefined;

  const record = decideRequest(id, { behavior, note, decidedBy });
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ record });
}
