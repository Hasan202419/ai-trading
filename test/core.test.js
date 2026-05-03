import test from "node:test";
import assert from "node:assert/strict";
import { defaultRiskSettings, defaultStrategySettings } from "../src/config.js";
import { evaluateRisk } from "../src/core/risk.js";
import { evaluateLatestSignal, runStrategy } from "../src/core/strategy.js";
import { OpenAIAnalysisClient } from "../src/llm/openai.js";

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

function bar(t, open, high, low, close, volume) {
  return { t, open, high, low, close, volume };
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
