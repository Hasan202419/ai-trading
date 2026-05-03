import { defaultRiskSettings, readConfig } from "../config.js";
import { evaluateLatestSignal } from "../core/strategy.js";
import { evaluateRisk } from "../core/risk.js";
import { AlpacaClient } from "../broker/alpaca.js";
import { SupabaseRestClient } from "../db/supabase.js";

export class JarvisService {
  constructor(config = readConfig()) {
    this.config = config;
    this.alpaca = new AlpacaClient(config.alpaca);
    this.db = new SupabaseRestClient(config.supabase);
    this.riskSettings = {
      ...defaultRiskSettings(),
      tradingMode: config.tradingMode,
      requireManualApproval: config.requireManualApproval
    };
  }

  async getPortfolioStatus() {
    const fallback = {
      mode: this.config.tradingMode,
      riskLocked: false,
      account: { equity: 100000 },
      positions: [],
      note: "Using fallback portfolio because Alpaca is not configured."
    };
    if (!this.alpaca.isConfigured()) return fallback;
    const [account, positions, openOrders] = await Promise.all([
      this.alpaca.getAccount(),
      this.alpaca.listPositions(),
      this.alpaca.listOrders("open")
    ]);
    return {
      mode: this.config.tradingMode,
      riskLocked: false,
      account,
      positions,
      openOrders
    };
  }

  analyzeMarketSnapshot({ symbol = "SPY", bars = [] }) {
    const signal = evaluateLatestSignal(bars, this.config.strategy, null);
    return {
      symbol,
      signal: { ...signal, symbol },
      analystNote: buildAnalystNote(symbol, signal)
    };
  }

  proposeStrategyAdjustment({ recentStats = {}, marketMode = "normal" }) {
    const suggestions = [];
    if ((recentStats.drawdownPct || 0) > 0.03) {
      suggestions.push("Reduce per-trade risk from 0.5% to 0.25% until drawdown recovers.");
    }
    if (marketMode === "high_volatility") {
      suggestions.push("Raise min ATR filter and require stronger volume confirmation.");
    }
    if (!suggestions.length) {
      suggestions.push("Keep current VWAP/ATR/volume filters; no automatic parameter change.");
    }
    return {
      mode: "advisory_only",
      suggestions,
      requiresHumanReview: true
    };
  }

  async approvePaperTrade({ signal, account, dayStats, approvedBy }) {
    const decision = evaluateRisk({
      signal,
      account,
      dayStats,
      settings: this.riskSettings,
      manualApproval: true
    });
    await this.audit("paper_trade_approval_requested", {
      approvedBy,
      decision,
      signal
    });
    return decision;
  }

  async getTradeJournal(limit = 20) {
    if (!this.db.isConfigured()) {
      return {
        trades: [],
        note: "Supabase is not configured yet; trade journal will appear after env vars and schema are applied."
      };
    }
    const trades = await this.db.select(
      "trade_journal",
      `?select=*&order=opened_at.desc&limit=${Number(limit)}`
    );
    return { trades };
  }

  async audit(eventType, payload) {
    if (!this.db.isConfigured()) return { skipped: true };
    return this.db.insert("audit_logs", {
      event_type: eventType,
      payload,
      created_at: new Date().toISOString()
    });
  }
}

function buildAnalystNote(symbol, signal) {
  if (signal.signal === "BUY") {
    return `${symbol}: VWAP cross-up confirmed after filters. This is advisory only; risk manager must approve before any paper order.`;
  }
  if (signal.signal === "BLOCKED") {
    return `${symbol}: trade blocked by deterministic filter: ${signal.reason}.`;
  }
  return `${symbol}: no actionable VWAP setup on the latest bar.`;
}
