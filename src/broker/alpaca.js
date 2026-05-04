export class AlpacaClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.keyId && this.config.secretKey);
  }

  async getAccount() {
    return this.request("/v2/account");
  }

  async listPositions() {
    return this.request("/v2/positions");
  }

  async listOrders(status = "open") {
    return this.request(`/v2/orders?status=${encodeURIComponent(status)}`);
  }

  async submitBracketOrder(orderPlan, clientOrderId) {
    if (!this.config.baseUrl.includes("paper-api")) {
      throw new Error("Live Alpaca endpoint blocked: v1 only supports paper trading.");
    }
    const body = {
      symbol: orderPlan.symbol,
      qty: String(orderPlan.qty),
      side: "buy",
      type: "market",
      time_in_force: "day",
      order_class: "bracket",
      take_profit: { limit_price: roundPrice(orderPlan.takeProfit) },
      stop_loss: { stop_price: roundPrice(orderPlan.stopLoss) },
      client_order_id: clientOrderId
    };
    return this.request("/v2/orders", { method: "POST", body });
  }

  async request(path, options = {}) {
    if (!this.isConfigured()) {
      throw new Error("Alpaca credentials are not configured.");
    }
    const response = await this.fetch(`${this.config.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        "APCA-API-KEY-ID": this.config.keyId,
        "APCA-API-SECRET-KEY": this.config.secretKey,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Alpaca request failed ${response.status}: ${text}`);
    }
    return response.json();
  }
}

function roundPrice(value) {
  const decimals = value >= 1 ? 2 : 4;
  return Number(value).toFixed(decimals);
}

