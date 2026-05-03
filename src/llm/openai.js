const ANALYST_INSTRUCTIONS = [
  "You are JARVIS, an advisory-only market analyst for a paper-trading algo bot.",
  "You never place orders, never bypass deterministic strategy rules, and never bypass the risk manager.",
  "Use the provided OHLCV bars, deterministic signal, and optional portfolio context.",
  "Return compact JSON only. Do not include markdown.",
  "Required JSON keys: summary, market_mode, confidence, trade_bias, risks, checklist, parameter_suggestions, risk_note.",
  "market_mode must be one of: normal, high_volatility, low_liquidity, news_risk, blocked.",
  "trade_bias must be one of: long, flat, avoid.",
  "confidence must be a number from 0 to 1."
].join(" ");

export class OpenAIAnalysisClient {
  constructor(config = {}, fetchImpl = globalThis.fetch) {
    this.config = {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4-mini",
      ...config
    };
    this.fetch = fetchImpl;
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  async analyzeMarketSnapshot({ symbol = "SPY", signal, bars = [], portfolio = null, recentStats = {} }) {
    if (!this.isConfigured()) {
      return {
        configured: false,
        mode: "advisory_only",
        note: "OpenAI API key is not configured; deterministic analysis only."
      };
    }

    const payload = {
      symbol,
      deterministic_signal: sanitizeSignal(signal),
      recent_bars: bars.slice(-40).map(sanitizeBar),
      portfolio: sanitizePortfolio(portfolio),
      recent_stats: recentStats,
      safety_contract: {
        trading_mode: "paper",
        llm_can_place_orders: false,
        risk_manager_required: true
      }
    };

    const response = await this.fetch(`${this.config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.model,
        instructions: ANALYST_INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(payload)
              }
            ]
          }
        ],
        max_output_tokens: 900
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI analysis failed ${response.status}: ${text}`);
    }

    const data = await response.json();
    const outputText = extractResponseText(data);
    const analysis = parseAnalysis(outputText);

    return {
      configured: true,
      mode: "advisory_only",
      model: this.config.model,
      responseId: data.id,
      analysis,
      rawText: outputText
    };
  }
}

function sanitizeSignal(signal = {}) {
  return {
    symbol: signal.symbol,
    signal: signal.signal,
    reason: signal.reason,
    entry: signal.entry,
    sl: signal.sl,
    tp: signal.tp,
    riskPerShare: signal.riskPerShare,
    filters: signal.filters
  };
}

function sanitizeBar(bar = {}) {
  return {
    t: bar.t || bar.time || bar.timestamp,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume)
  };
}

function sanitizePortfolio(portfolio) {
  if (!portfolio) return null;
  return {
    mode: portfolio.mode,
    riskLocked: portfolio.riskLocked,
    account: portfolio.account
      ? {
          status: portfolio.account.status,
          equity: portfolio.account.equity,
          cash: portfolio.account.cash,
          buying_power: portfolio.account.buying_power,
          trading_blocked: portfolio.account.trading_blocked,
          account_blocked: portfolio.account.account_blocked
        }
      : null,
    positions: Array.isArray(portfolio.positions)
      ? portfolio.positions.map((position) => ({
          symbol: position.symbol,
          qty: position.qty,
          side: position.side,
          market_value: position.market_value,
          unrealized_pl: position.unrealized_pl,
          current_price: position.current_price
        }))
      : []
  };
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseAnalysis(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      summary: text || "No LLM analysis text returned.",
      market_mode: "normal",
      confidence: 0,
      trade_bias: "flat",
      risks: [],
      checklist: [],
      parameter_suggestions: [],
      risk_note: "Raw model output was not valid JSON; deterministic risk manager still controls all orders."
    };
  }
}
