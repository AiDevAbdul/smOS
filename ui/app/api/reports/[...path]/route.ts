// GET /api/reports/<slug>/<date>/<file> or /api/reports/_public/<slug>/<file>
// Serves rendered report HTML/PDF for the in-app iframe viewer. Reports are
// self-contained (design-system CSS inlined by the renderers), so this is a
// plain static read with path-traversal guards — no templating here.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { repoRoot, clientReportDir } from "../../../../../scripts/lib/paths.js";
import { publicHub } from "../../../../../scripts/lib/paths.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function isInside(root: string, target: string): boolean {
  const normalizedRoot = resolve(root) + "/";
  const normalizedTarget = resolve(target) + "/";
  return normalizedTarget.startsWith(normalizedRoot) || resolve(target) === resolve(root);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;
  if (!segments || segments.length < 2) {
    return NextResponse.json({ error: "expected /<slug>/<date>/<file> or /_public/<slug>/<file>" }, { status: 400 });
  }

  let filePath: string;
  if (segments[0] === "_public") {
    filePath = publicHub(...segments.slice(1));
    if (!isInside(publicHub(), filePath)) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
  } else {
    const [slug, date, ...rest] = segments;
    const dir = clientReportDir(slug, date);
    filePath = resolve(dir, ...rest);
    if (!isInside(dir, filePath)) {
      return NextResponse.json({ error: "invalid path" }, { status: 400 });
    }
  }

  try {
    const buf = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": type } });
  } catch {
    return NextResponse.json({ error: "not found", root: repoRoot() }, { status: 404 });
  }
}
