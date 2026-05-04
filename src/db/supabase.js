export class SupabaseRestClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.url && this.config.serviceRoleKey);
  }

  async insert(table, row) {
    return this.request(table, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: Array.isArray(row) ? row : [row]
    });
  }

  async select(table, query = "") {
    return this.request(`${table}${query}`, { method: "GET" });
  }

  async patch(table, query, row) {
    return this.request(`${table}${query}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: row
    });
  }

  async request(path, options = {}) {
    if (!this.isConfigured()) {
      throw new Error("Supabase service-role credentials are not configured.");
    }
    const response = await this.fetch(`${this.config.url}/rest/v1/${path}`, {
      method: options.method || "GET",
      headers: {
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase request failed ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }
}

