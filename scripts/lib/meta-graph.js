/**
 * Thin Meta Graph API client for skill companion scripts.
 *
 * Skills can't call MCP tools directly (MCP is invoked by Claude), so executable
 * skill scripts hit Graph directly using META_ACCESS_TOKEN. Keep this surface
 * narrow: a request helper + a few common shortcuts. Anything tool-shaped
 * belongs in mcp/meta-server/tools/.
 */

import axios from "axios";

export const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export function createGraph(token = process.env.META_ACCESS_TOKEN) {
  if (!token) throw new Error("META_ACCESS_TOKEN is required");
  const http = axios.create({ baseURL: BASE_URL, timeout: 30000 });

  async function request(method, path, params = {}, data = null) {
    const config = { method, url: path, params: { access_token: token, ...params } };
    if (data) config.data = data;
    try {
      const res = await http(config);
      return res.data;
    } catch (err) {
      const meta = err.response?.data?.error;
      if (meta) {
        const e = new Error(`Meta API ${meta.code}: ${meta.message} (type=${meta.type}, trace=${meta.fbtrace_id})`);
        e.metaError = meta;
        throw e;
      }
      throw err;
    }
  }

  return {
    get: (path, params) => request("GET", path, params),
    post: (path, data, params) => request("POST", path, params, data),
    delete: (path, params) => request("DELETE", path, params),
    act: (id) => `act_${String(id).replace(/^act_/, "")}`,
    paginate: async function paginate(path, params, max = 500) {
      const results = [];
      let next = { path, params: { ...params, limit: params?.limit ?? 100 } };
      while (next && results.length < max) {
        const page = await request("GET", next.path, next.params);
        results.push(...(page.data || []));
        if (page.paging?.next) {
          const u = new URL(page.paging.next);
          next = { path: u.pathname.replace(/^\/v\d+\.\d+/, ""), params: Object.fromEntries(u.searchParams) };
          delete next.params.access_token;
        } else {
          next = null;
        }
      }
      return results.slice(0, max);
    },
  };
}

export function isTbd(value) {
  return value == null || value === "" || /^TBD/i.test(String(value));
}
