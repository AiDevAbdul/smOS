/**
 * Krea API client — AI image generation (Krea 2, Flux, Nano Banana Pro,
 * Seedream 4, GPT Image 2, etc.) for FB/IG creative.
 *
 * https://www.krea.ai/docs/developers/introduction
 *
 * Auth: Authorization: Bearer <KREA_API_KEY> (workspace prepaid balance —
 * failed/cancelled jobs are not billed). Generation is async: POST submits a
 * job, GET /jobs/{id} is polled until a terminal status.
 */

const BASE_URL = "https://api.krea.ai";
const DEFAULT_MODEL = "bfl/flux-1-dev";
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export class KreaError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "KreaError";
    this.status = status;
  }
}

function apiKey(explicit) {
  const key = explicit || process.env.KREA_API_KEY;
  if (!key) throw new KreaError("KREA_API_KEY is required (krea.ai/settings/api-tokens)");
  return key;
}

async function request(method, path, { apiKey: key, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey(key)}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new KreaError(`Krea API ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return json;
}

/** Submit a text-to-image generation job. Returns { job_id, ... }. */
export async function submitImageJob({ prompt, model = DEFAULT_MODEL, width = 1024, height = 1024, steps, apiKey: key } = {}) {
  if (!prompt) throw new KreaError("prompt is required");
  const body = { prompt, width, height };
  if (steps != null) body.steps = steps;
  return request("POST", `/generate/image/${model}`, { apiKey: key, body });
}

/** Fetch a job by id. */
export async function getJob(jobId, { apiKey: key } = {}) {
  return request("GET", `/jobs/${jobId}`, { apiKey: key });
}

function extractUrls(job) {
  const urls = job?.result?.urls;
  if (!Array.isArray(urls)) return [];
  return urls.map((u) => (typeof u === "string" ? u : u?.url)).filter(Boolean);
}

/** Poll a job until it reaches a terminal state. Throws on failed/cancelled/timeout. */
export async function waitForJob(jobId, { apiKey: key, intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await getJob(jobId, { apiKey: key });
    const status = job?.status;
    if (status === "completed") return { job, urls: extractUrls(job) };
    if (status === "failed" || status === "cancelled") {
      throw new KreaError(`Krea job ${jobId} ${status}: ${job?.result?.error || "no error detail"}`);
    }
    if (TERMINAL.has(status)) return { job, urls: extractUrls(job) };
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new KreaError(`Krea job ${jobId} did not finish within ${timeoutMs}ms`);
}

/** Submit + poll to completion. Returns { job_id, urls: [output image URLs] }. */
export async function generateImage(opts = {}) {
  const submitted = await submitImageJob(opts);
  const jobId = submitted?.job_id || submitted?.id;
  if (!jobId) throw new KreaError(`Krea submit returned no job id: ${JSON.stringify(submitted)}`);
  const { urls } = await waitForJob(jobId, opts);
  if (!urls.length) throw new KreaError(`Krea job ${jobId} completed with no output urls`);
  return { job_id: jobId, urls };
}
