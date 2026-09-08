// POST /api/permissions — the mcp/ui-permission-bridge server calls this on
// every tool-use permission check, with {runId, toolName, input}. Returns
// {id} for the bridge to poll via GET /api/permissions/:id.
// GET  /api/permissions?runId=<id> — pending requests (optionally scoped to
// one run) for the RunConsole banner to poll and render Allow/Deny for.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createRequest, listPending } from "../../../lib/permissions";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const toolName = typeof body?.toolName === "string" ? body.toolName : "";
  if (!toolName) {
    return NextResponse.json({ error: "toolName is required" }, { status: 400 });
  }
  const runId = typeof body?.runId === "string" ? body.runId : null;
  const input = body?.input ?? null;

  const record = createRequest({ runId, toolName, input });
  return NextResponse.json({ id: record.id, status: record.status });
}

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("runId");
  const pending = listPending(runId);
  return NextResponse.json({ pending });
}
