import test from "node:test";
import assert from "node:assert/strict";
import { defaultRiskSettings, defaultStrategySettings } from "../src/config.js";
import { evaluateRisk } from "../src/core/risk.js";
import { evaluateLatestSignal, runStrategy } from "../src/core/strategy.js";
import { OpenAIAnalysisClient } from "../src/llm/openai.js";
import { MarketDataRouter } from "../src/market/providers.js";

const baseSettings = {
  ...defaultStrategySettings(),
  atrPeriod: 2,
  trendLookback: 2,
  volumeLookback: 2,
  minAtrPct: 0,
  maxAtrPct: 1,
  minVolumeRatio: 0
};

test("VWAP cross-up produces a BUY signal with Pine-style TP/SL", () => {
  const bars = [
    bar("2026-05-01T13:33:00Z", 100, 101, 99, 99.5, 1000),
    bar("2026-05-01T13:34:00Z", 99.5, 101, 99, 100.8, 2500)
  ];
  const result = evaluateLatestSignal(bars, baseSettings);
  assert.equal(result.signal, "BUY");
  assert.equal(result.reason, "vwap_cross_up_confirmed");
  assert.equal(result.entry, 100.8);
  assert.equal(Number(result.sl.toFixed(2)), 99);
  assert.equal(Number(result.tp.toFixed(2)), 106.2);
});

test("strategy emits SELL when close reaches take profit", () => {
  const bars = [
    bar("2026-05-01T13:33:00Z", 100, 101, 99, 99.5, 1000),
    bar("2026-05-01T13:34:00Z", 99.5, 101, 99, 100.8, 2500),
    bar("2026-05-01T13:35:00Z", 100.8, 107, 100, 106.3, 2500)
  ];
  const result = runStrategy(bars, baseSettings);
  assert.deepEqual(result.events.map((event) => event.signal), ["BUY", "SELL"]);
});

test("daily max loss blocks risk approval", () => {
  const decision = evaluateRisk({
    signal: buySignal(),
    account: { equity: 100000 },
    dayStats: { realizedLoss: 2100, consecutiveLosses: 0 },
    settings: defaultRiskSettings(),
    manualApproval: true
  });
  assert.equal(decision.status, "REJECTED");
  assert.equal(decision.reason, "daily_max_loss_reached");
});

test("manual approval is required by default", () => {
  const decision = evaluateRisk({
    signal: buySignal(),
    account: { equity: 100000 },
    dayStats: { realizedLoss: 0, consecutiveLosses: 0 },
    settings: defaultRiskSettings(),
    manualApproval: false
  });
  assert.equal(decision.status, "NEEDS_MANUAL_APPROVAL");
  assert.equal(decision.orderPlan.qty, 200);
});

test("paper-only guard rejects live mode", () => {
  const decision = evaluateRisk({
    signal: buySignal(),
    account: { equity: 100000 },
    dayStats: { realizedLoss: 0, consecutiveLosses: 0 },
    settings: { ...defaultRiskSettings(), tradingMode: "live" },
    manualApproval: true
  });
  assert.equal(decision.status, "REJECTED");
  assert.equal(decision.reason, "live_trading_disabled_in_v1");
});

test("OpenAI analysis client parses advisory JSON from Responses API", async () => {
  const client = new OpenAIAnalysisClient(
    { apiKey: "sk-test-key", model: "test-model" },
    async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "test-model");
      return {
        ok: true,
        async json() {
          return {
            id: "resp_test",
            output_text: JSON.stringify({
              summary: "VWAP setup is advisory only.",
              market_mode: "normal",
              confidence: 0.72,
              trade_bias: "long",
              risks: ["paper-only"],
              checklist: ["risk manager approval required"],
              parameter_suggestions: [],
              risk_note: "Do not bypass deterministic checks."
            })
          };
        }
      };
    }
  );
  const result = await client.analyzeMarketSnapshot({
    symbol: "SPY",
    signal: buySignal(),
    bars: [bar("2026-05-01T13:34:00Z", 99.5, 101, 99, 100.8, 2500)]
  });
  assert.equal(result.configured, true);
  assert.equal(result.mode, "advisory_only");
  assert.equal(result.analysis.trade_bias, "long");
});

test("OpenAI analysis client ignores non-OpenAI token prefixes", () => {
  const client = new OpenAIAnalysisClient({ apiKey: "sbp_not_an_openai_key" });
  assert.equal(client.isConfigured(), false);
});

test("market data router maps Massive aggregate bars", async () => {
  const router = new MarketDataRouter(
    {
      yahoo: { enabled: false },
      providerPriority: ["massive"],
      massive: { apiKey: "massive-test", baseUrl: "https://api.massive.test", dataDelayMinutes: 15 },
      finnhub: {},
      finviz: {}
    },
    async (url) => {
      if (url.includes("/v2/snapshot/")) {
        return jsonResponse({
          ticker: {
            lastTrade: { p: 101.2, t: 1770000000000 },
            prevDay: { c: 100 },
            day: { o: 99, h: 102, l: 98, v: 12345 }
          }
        });
      }
      assert.ok(url.includes("/v2/aggs/ticker/SPY/range/1/minute/"));
      return jsonResponse({
        results: [
          { t: 1770000000000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 },
          { t: 1770000060000, o: 100.5, h: 102, l: 100, c: 101.8, v: 2500 }
        ]
      });
    }
  );
  const snapshot = await router.getSnapshot({ symbol: "spy", provider: "auto", timeframe: "1", limit: 2 });
  assert.equal(snapshot.provider, "massive");
  assert.equal(snapshot.dataDelayMinutes, 15);
  assert.equal(snapshot.bars.length, 2);
  assert.equal(snapshot.bars[1].close, 101.8);
  assert.equal(snapshot.quote.price, 101.2);
});

test("market data router maps Alpaca stock snapshots and bars", async () => {
  const router = new MarketDataRouter(
    {
      providerPriority: ["alpaca"],
      alpaca: {
        keyId: "alpaca-key",
        secretKey: "alpaca-secret",
        baseUrl: "https://data.alpaca.test",
        feed: "iex",
        dataDelayMinutes: 15
      },
      yahoo: { enabled: false },
      massive: {},
      finnhub: {},
      finviz: {}
    },
    async (url, options) => {
      assert.equal(options.headers["APCA-API-KEY-ID"], "alpaca-key");
      assert.equal(options.headers["APCA-API-SECRET-KEY"], "alpaca-secret");
      if (url.includes("/v2/stocks/SPY/snapshot")) {
        return jsonResponse({
          latestTrade: { p: 101.2, t: "2026-05-04T20:00:00Z" },
          dailyBar: { o: 99, h: 102, l: 98, c: 101.2, v: 12345, t: "2026-05-04T04:00:00Z" },
          prevDailyBar: { c: 100 }
        });
      }
      assert.ok(url.includes("/v2/stocks/bars?symbols=SPY"));
      assert.ok(url.includes("timeframe=1Min"));
      assert.ok(url.includes("feed=iex"));
      return jsonResponse({
        bars: {
          SPY: [
            { t: "2026-05-04T19:59:00Z", o: 100, h: 101, l: 99, c: 100.5, v: 1000, vw: 100.2, n: 12 },
            { t: "2026-05-04T20:00:00Z", o: 100.5, h: 102, l: 100, c: 101.8, v: 2500, vw: 101.2, n: 18 }
          ]
        }
      });
    }
  );
  const snapshot = await router.getSnapshot({ symbol: "spy", provider: "auto", timeframe: "1", limit: 2 });
  assert.equal(snapshot.provider, "alpaca");
  assert.equal(snapshot.providerName, "Alpaca Market Data");
  assert.equal(snapshot.bars.length, 2);
  assert.equal(snapshot.bars[1].transactions, 18);
  assert.equal(snapshot.quote.price, 101.2);
  assert.equal(snapshot.quote.volume, 12345);
});

test("market data router maps Finnhub candles when Massive is unavailable", async () => {
  const router = new MarketDataRouter(
    {
      yahoo: { enabled: false },
      providerPriority: ["massive", "finnhub"],
      massive: {},
      finnhub: { apiKey: "finnhub-test", baseUrl: "https://finnhub.test", dataDelayMinutes: 0 },
      finviz: {}
    },
    async (url) => {
      if (url.includes("/quote?")) {
        return jsonResponse({ c: 101.8, pc: 100, o: 99, h: 102, l: 98, t: 1770000060 });
      }
      assert.ok(url.includes("/stock/candle?symbol=QQQ"));
      return jsonResponse({
        s: "ok",
        t: [1770000000, 1770000060],
        o: [100, 100.5],
        h: [101, 102],
        l: [99, 100],
        c: [100.5, 101.8],
        v: [1000, 2500]
      });
    }
  );
  const snapshot = await router.getSnapshot({ symbol: "qqq", provider: "auto", timeframe: "1", limit: 2 });
  assert.equal(snapshot.provider, "finnhub");
  assert.equal(snapshot.errors[0].provider, "massive");
  assert.equal(snapshot.bars[0].open, 100);
  assert.equal(snapshot.quote.previousClose, 100);
});

test("market data router maps Yahoo Finance chart data", async () => {
  const router = new MarketDataRouter(
    {
      providerPriority: ["yahoo"],
      yahoo: { enabled: true, baseUrl: "https://query1.finance.test", dataDelayMinutes: 15 },
      massive: {},
      finnhub: {},
      finviz: {}
    },
    async (url) => {
      assert.ok(url.includes("/v8/finance/chart/NVDA"));
      return jsonResponse(yahooChartResponse([1000, 2500], [100.5, 101.8]));
    }
  );
  const snapshot = await router.getSnapshot({ symbol: "nvda", provider: "auto", timeframe: "1d", limit: 2 });
  assert.equal(snapshot.provider, "yahoo");
  assert.equal(snapshot.bars.length, 2);
  assert.equal(snapshot.bars[1].volume, 2500);
  assert.equal(snapshot.quote.price, 101.8);
});

test("Yahoo volume screener detects abnormal volume", async () => {
  const router = new MarketDataRouter(
    {
      providerPriority: ["yahoo"],
      yahoo: { enabled: true, baseUrl: "https://query1.finance.test", dataDelayMinutes: 15 },
      massive: {},
      finnhub: {},
      finviz: {}
    },
    async (url) => {
      assert.ok(url.includes("/v8/finance/chart/AMD"));
      return jsonResponse(yahooChartResponse([100, 100, 100, 350], [10, 11, 12, 13]));
    }
  );
  const result = await router.screenVolumeSpikes({ symbols: ["amd"], lookbackDays: 4, volumeMultiplier: 2 });
  assert.equal(result.scanned, 1);
  assert.equal(result.matches[0].symbol, "AMD");
  assert.equal(Number(result.matches[0].volumeRatio.toFixed(2)), 3.5);
});

function bar(t, open, high, low, close, volume) {
  return { t, open, high, low, close, volume };
}

function jsonResponse(value) {
  return {
    ok: true,
    async json() {
      return value;
    }
  };
}

function yahooChartResponse(volumes, closes) {
  return {
    chart: {
      result: [
        {
          timestamp: volumes.map((_, index) => 1770000000 + index * 86400),
          indicators: {
            quote: [
              {
                open: closes.map((close) => close - 1),
                high: closes.map((close) => close + 1),
                low: closes.map((close) => close - 2),
                close: closes,
                volume: volumes
              }
            ]
          }
        }
      ],
      error: null
    }
  };
}

function buySignal() {
  return {
    signal: "BUY",
    symbol: "SPY",
    entry: 100,
    sl: 98,
    tp: 106,
    riskPerShare: 2
  };
}
