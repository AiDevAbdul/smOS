import axios from "axios";

const API_VERSION = "v25.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export function createMetaClient() {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN environment variable is required");

  const http = axios.create({ baseURL: BASE_URL });

  async function request(method, path, params = {}, data = null) {
    try {
      const config = {
        method,
        url: path,
        params: { access_token: token, ...params },
      };
      if (data) config.data = data;
      const res = await http(config);
      return res.data;
    } catch (err) {
      const meta = err.response?.data?.error;
      if (meta) {
        throw new Error(`Meta API Error ${meta.code}: ${meta.message} (type: ${meta.type}, trace: ${meta.fbtrace_id})`);
      }
      throw err;
    }
  }

  return {
    get: (path, params) => request("GET", path, params),
    post: (path, data, params) => request("POST", path, params, data),
    delete: (path, params) => request("DELETE", path, params),

    // Helper: build ad account path
    act: (adAccountId) => `act_${adAccountId.replace("act_", "")}`,
  };
}
