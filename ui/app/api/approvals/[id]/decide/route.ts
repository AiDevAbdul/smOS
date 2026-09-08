// POST /api/approvals/:id/decide — record a human decision on a pending
// approval record. This is a thin wrapper over scripts/lib/approvals.js's
// `decide()`, which is the real fail-closed state machine (role check, TTL
// expiry, single-decision enforcement, dual local+Supabase persistence). We
// do not reimplement any of that here — errors it throws (unknown id,
// already-decided, expired, insufficient role) are surfaced verbatim as 4xx
// bodies rather than swallowed, per approvals.js's fail-closed contract.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
// scripts/lib/approvals.js is untyped JS; TypeScript's structural inference
// for its destructured-default-parameter signature ends up dropping the
// properties without defaults (id/decision/role) under strict mode, so we
// pin an explicit type here rather than fight that inference.
import { decide as decideRaw } from "../../../../../../scripts/lib/approvals.js";

const decide = decideRaw as (opts: {
  id: string;
  decision: "approved" | "rejected";
  decidedBy?: string;
  role: string;
  note?: string;
}) => Promise<Record<string, unknown>>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  const decision = body?.decision;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be 'approved' or 'rejected'" },
      { status: 400 }
    );
  }
  const decidedBy =
    typeof body?.decidedBy === "string" && body.decidedBy.trim()
      ? body.decidedBy.trim()
      : "human";
  const role = typeof body?.role === "string" ? body.role.trim() : "";
  const note = typeof body?.note === "string" ? body.note : "";

  if (!role) {
    return NextResponse.json({ error: "role is required" }, { status: 400 });
  }

  try {
    const record = await decide({ id, decision, decidedBy, role, note });
    return NextResponse.json({ record });
  } catch (err) {
    // approvals.js throws Error for: unknown id, already-decided, expired,
    // insufficient role — all caller-fixable, fail-closed conditions, so 4xx.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
