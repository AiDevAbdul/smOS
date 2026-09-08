export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { killRun } from "../../../../../lib/registry";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const killed = killRun(runId);
  return NextResponse.json({ killed });
}
