// POST /api/runs — start a new Claude run (or resume one via resumeSessionId).
// GET  /api/runs?slug=foo — list runs (most recent first), optionally scoped
// to one client slug, for the Run console's session list.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { startRun, listRuns } from "../../../lib/registry";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" ? body.slug : null;
  const resumeSessionId = typeof body?.resumeSessionId === "string" ? body.resumeSessionId : null;

  const run = startRun({ prompt, slug, resumeSessionId });
  return NextResponse.json({
    runId: run.runId,
    slug: run.slug,
    status: run.status,
    startedAt: run.startedAt,
  });
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  const runs = listRuns(slug).map((r) => ({
    runId: r.runId,
    slug: r.slug,
    skillPrompt: r.skillPrompt,
    claudeSessionId: r.claudeSessionId,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    exitCode: r.exitCode,
  }));
  return NextResponse.json({ runs });
}
