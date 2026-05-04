import { defaultRiskSettings, readConfig } from "../config.js";
import { evaluateLatestSignal } from "../core/strategy.js";
import { evaluateRisk } from "../core/risk.js";
import { AlpacaClient } from "../broker/alpaca.js";
import { SupabaseRestClient } from "../db/supabase.js";
import { OpenAIAnalysisClient } from "../llm/openai.js";
import { MarketDataRouter } from "../market/providers.js";

export class JarvisService {
  constructor(config = readConfig()) {
    this.config = config;
    this.alpaca = new AlpacaClient(config.alpaca);
    this.db = new SupabaseRestClient(config.supabase);
    this.llm = new OpenAIAnalysisClient(config.openai);
    this.marketData = new MarketDataRouter(config.marketData);
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

  getMarketProviders() {
    return {
      defaultProvider: this.config.marketData.provider,
      defaultSymbol: this.config.marketData.defaultSymbol,
      providers: this.marketData.status()
    };
  }

  async getMarketSnapshot({
    symbol = this.config.marketData.defaultSymbol,
    timeframe = this.config.marketData.defaultTimeframe,
    limit = 80,
    provider = this.config.marketData.provider
  } = {}) {
    const snapshot = await this.marketData.getSnapshot({ symbol, timeframe, limit, provider });
    const signal = snapshot.bars.length
      ? evaluateLatestSignal(snapshot.bars, this.config.strategy, null)
      : { signal: "NONE", reason: "no_market_data_bars" };
    await this.saveMarketSnapshot(snapshot);
    return {
      ...snapshot,
      signal: { ...signal, symbol: snapshot.symbol }
    };
  }

  async screenStocks({
    symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"],
    lookbackDays = 20,
    volumeMultiplier = 2,
    provider = "yahoo"
  } = {}) {
    const result = await this.marketData.screenVolumeSpikes({
      symbols: parseSymbols(symbols),
      lookbackDays,
      volumeMultiplier,
      provider
    });
    await this.audit("stock_screener_run", {
      provider: result.provider,
      scanned: result.scanned,
      matches: result.matches.map((match) => ({
        symbol: match.symbol,
        volumeRatio: match.volumeRatio,
        currentVolume: match.currentVolume
      }))
    });
    return {
      ...result,
      mode: "research_only",
      note: "Volume spike screener is read-only research. It does not place orders."
    };
  }

  async analyzeMarketSnapshot({ symbol = "SPY", bars = [], timeframe = "1", provider = "auto", recentStats = {}, portfolio = null }) {
    const fetchedSnapshot = bars.length
      ? null
      : await this.getMarketSnapshot({ symbol, timeframe, provider, limit: 80 });
    const sourceBars = bars.length ? bars : fetchedSnapshot.bars;
    const signal = evaluateLatestSignal(sourceBars, this.config.strategy, null);
    const resolvedSymbol = fetchedSnapshot?.symbol || symbol;
    const result = {
      symbol: resolvedSymbol,
      signal: { ...signal, symbol: resolvedSymbol },
      marketData: fetchedSnapshot
        ? {
            provider: fetchedSnapshot.provider,
            providerName: fetchedSnapshot.providerName,
            dataDelayMinutes: fetchedSnapshot.dataDelayMinutes,
            barCount: fetchedSnapshot.barCount,
            errors: fetchedSnapshot.errors
          }
        : { provider: "request_body", barCount: sourceBars.length },
      analystNote: buildAnalystNote(resolvedSymbol, signal)
    };
    if (!this.llm.isConfigured()) {
      return {
        ...result,
        llmAnalysis: {
          configured: false,
          mode: "advisory_only",
          note: "OPENAI_API_KEY is not configured; deterministic analysis only."
        }
      };
    }
    try {
      const llmAnalysis = await this.llm.analyzeMarketSnapshot({
        symbol: resolvedSymbol,
        signal: result.signal,
        bars: sourceBars,
        recentStats,
        portfolio
      });
      await this.saveLlmAnalysis({ symbol, llmAnalysis, prompt: "market_snapshot" });
      return { ...result, llmAnalysis };
    } catch (error) {
      await this.audit("llm_analysis_failed", {
        symbol,
        error: error.message
      });
      return {
        ...result,
        llmAnalysis: {
          configured: true,
          mode: "advisory_only",
          error: error.message,
          note: "LLM analysis failed; deterministic strategy and risk manager remain active."
        }
      };
    }
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

  async saveLlmAnalysis({ symbol, prompt, llmAnalysis }) {
    if (!this.db.isConfigured()) return { skipped: true };
    return this.db.insert("llm_analyses", {
      symbol,
      prompt,
      analysis: JSON.stringify(llmAnalysis.analysis || llmAnalysis),
      model: llmAnalysis.model || this.config.openai.model,
      created_at: new Date().toISOString()
    });
  }

  async saveMarketSnapshot(snapshot) {
    if (!this.db.isConfigured() || !snapshot.bars.length) return { skipped: true };
    return this.db.insert("market_snapshots", {
      symbol: snapshot.symbol,
      timeframe: snapshot.timeframe,
      bars: {
        provider: snapshot.provider,
        dataDelayMinutes: snapshot.dataDelayMinutes,
        fetchedAt: snapshot.fetchedAt,
        bars: snapshot.bars
      },
      created_at: new Date().toISOString()
    });
  }
}

function parseSymbols(symbols) {
  if (Array.isArray(symbols)) return symbols;
  return String(symbols || "")
    .split(/[\s,]+/)
    .map((symbol) => symbol.trim())
    .filter(Boolean);
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
