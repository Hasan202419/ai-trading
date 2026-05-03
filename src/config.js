import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readConfig(env = process.env) {
  const loadedEnv = { ...loadDotEnv(), ...env };
  return {
    nodeEnv: loadedEnv.NODE_ENV || "development",
    port: Number(loadedEnv.PORT || 3000),
    mcpPort: Number(loadedEnv.MCP_PORT || loadedEnv.PORT || 3333),
    workerIntervalMs: Number(loadedEnv.WORKER_INTERVAL_MS || 60000),
    tradingMode: loadedEnv.TRADING_MODE || "paper",
    requireManualApproval: (loadedEnv.REQUIRE_MANUAL_APPROVAL || "true") === "true",
    appPublicUrl: loadedEnv.APP_PUBLIC_URL || "http://localhost:3000",
    mcpPublicUrl: loadedEnv.MCP_PUBLIC_URL || "http://localhost:3333",
    alpaca: {
      keyId: loadedEnv.ALPACA_API_KEY_ID || "",
      secretKey: loadedEnv.ALPACA_API_SECRET_KEY || "",
      baseUrl: loadedEnv.ALPACA_BASE_URL || "https://paper-api.alpaca.markets",
      dataBaseUrl: loadedEnv.ALPACA_DATA_BASE_URL || "https://data.alpaca.markets"
    },
    supabase: {
      url: loadedEnv.SUPABASE_URL || "",
      anonKey: loadedEnv.SUPABASE_ANON_KEY || "",
      serviceRoleKey: loadedEnv.SUPABASE_SERVICE_ROLE_KEY || ""
    },
    strategy: defaultStrategySettings()
  };
}

export function loadDotEnv(path = ".env") {
  const file = resolve(process.cwd(), path);
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        return [key, value];
      })
  );
}

export function defaultStrategySettings() {
  return {
    marketTimezone: "America/New_York",
    openHour: 9,
    openMinute: 30,
    closeHour: 16,
    closeMinute: 0,
    startDelayMinutes: 3,
    endBeforeCloseMinutes: 27,
    rewardRiskRatio: 3,
    minTick: 0.01,
    atrPeriod: 14,
    minAtrPct: 0.0008,
    maxAtrPct: 0.04,
    volumeLookback: 20,
    minVolumeRatio: 1.15,
    trendLookback: 50,
    allowShorts: false,
    noTradeDates: []
  };
}

export function defaultRiskSettings() {
  return {
    tradingMode: "paper",
    perTradeRiskPct: 0.005,
    dailyMaxLossPct: 0.02,
    maxConsecutiveLosses: 3,
    minRiskPerShare: 0.01,
    maxNotionalPct: 0.2,
    requireManualApproval: true
  };
}
