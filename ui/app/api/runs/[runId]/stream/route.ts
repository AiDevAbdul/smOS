// GET /api/runs/:runId/stream?since=<seq> — SSE tail of one run's event
// buffer. Reconnect-safe: pass `since` (the last seq you saw) to replay only
// what you missed, or omit it to replay the whole run from the start. The
// registry (not this handler) owns the child process, so a client can drop
// and reconnect without killing the run.
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getRun, subscribe } from "../../../../../lib/registry";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) {
    return new Response("run not found", { status: 404 });
  }

  const since = Number(req.nextUrl.searchParams.get("since") ?? "-1");
  const sinceSeq = Number.isFinite(since) ? since : -1;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: { seq: number; data: unknown }) => {
        controller.enqueue(
          encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event.data)}\n\n`)
        );
      };
      unsubscribe = subscribe(runId, sinceSeq, send);
      // If the run has already finished and every buffered event was
      // replayed synchronously above, tell the client so it can stop
      // spinning instead of waiting on a stream that will never close.
      if (run.status !== "running") {
        controller.enqueue(encoder.encode(`event: registry-status\ndata: ${run.status}\n\n`));
      }
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
