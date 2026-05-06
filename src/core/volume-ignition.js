export function analyzeVolumeIgnition(symbol, bars = [], options = {}) {
  const settings = {
    averageVolumeLookback: 20,
    resistanceLookback: 20,
    atrPeriod: 14,
    minRvol: 2,
    maxRecentMovePct: 10,
    maxParabolicMovePct: 20,
    maxDistanceToResistancePct: 5,
    maxBreakoutExtensionPct: 1.5,
    maxEma20ExtensionPct: 8,
    minAverageVolume: 1000000,
    accountSize: 10000,
    riskPct: 0.005,
    ...options
  };
  const clean = bars
    .map(normalizeBar)
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite));
  const minimumBars = Math.max(settings.averageVolumeLookback + 5, settings.atrPeriod * 2 + 2, 30);
  if (clean.length < minimumBars) {
    return {
      symbol: normalizeSymbol(symbol),
      signal: "WAIT",
      trendStage: "Insufficient data",
      continuationProbability: 0,
      riskLevel: "High",
      reason: `Need at least ${minimumBars} bars for the ignition scan.`,
      checks: [],
      barCount: clean.length
    };
  }

  const latest = clean[clean.length - 1];
  const previousBars = clean.slice(0, -1);
  const lastThree = clean.slice(-3);
  const closes = clean.map((bar) => bar.close);
  const avgVolume = average(previousBars.slice(-settings.averageVolumeLookback).map((bar) => bar.volume));
  const rvol = avgVolume ? latest.volume / avgVolume : 0;
  const volumeIncreasing = lastThree[0].volume < lastThree[1].volume && lastThree[1].volume < lastThree[2].volume;
  const referenceClose = clean[Math.max(0, clean.length - 4)].close;
  const recentMovePct = pct(latest.close - referenceClose, referenceClose);
  const resistanceWindow = previousBars.slice(-settings.resistanceLookback);
  const resistance = Math.max(...resistanceWindow.map((bar) => bar.high));
  const distanceToResistancePct = pct(resistance - latest.close, resistance);
  const nearResistance =
    distanceToResistancePct <= settings.maxDistanceToResistancePct &&
    distanceToResistancePct >= -settings.maxBreakoutExtensionPct;
  const higherLow = lastThree[0].low < lastThree[1].low && lastThree[1].low <= lastThree[2].low;
  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const aboveEma9 = latest.close > ema9;
  const ema20ExtensionPct = pct(latest.close - ema20, ema20);
  const notExtendedFromEma20 = ema20ExtensionPct >= -1 && ema20ExtensionPct <= settings.maxEma20ExtensionPct;
  const tr = trueRanges(clean);
  const currentAtr = average(tr.slice(-settings.atrPeriod));
  const previousAtr = average(tr.slice(-settings.atrPeriod * 2, -settings.atrPeriod));
  const atrIncreasing = currentAtr > previousAtr * 1.02;
  const atrPct = pct(currentAtr, latest.close);
  const liquidityOk = avgVolume >= settings.minAverageVolume;
  const alreadyExtended = recentMovePct > settings.maxParabolicMovePct || ema20ExtensionPct > settings.maxEma20ExtensionPct * 1.75;
  const controlledMove = recentMovePct <= settings.maxRecentMovePct;

  const checks = [
    check("3-candle volume expansion", volumeIncreasing, `${formatRatio(lastThree[2].volume / Math.max(lastThree[0].volume, 1))}x from first to last candle`),
    check("RVOL >= 2", rvol >= settings.minRvol, `${formatRatio(rvol)}x 20-bar average`),
    check("Move < 10% in 3 candles", controlledMove, `${formatPct(recentMovePct)} recent move`),
    check("Near resistance", nearResistance, `${formatPct(distanceToResistancePct)} from resistance`),
    check("Higher low", higherLow, higherLow ? "last three lows are rising" : "higher-low structure not confirmed"),
    check("Above 9 EMA", aboveEma9, `close ${formatMoney(latest.close)} vs EMA9 ${formatMoney(ema9)}`),
    check("Not overextended from 20 EMA", notExtendedFromEma20, `${formatPct(ema20ExtensionPct)} from EMA20`),
    check("ATR expanding", atrIncreasing, `${formatPct(atrPct)} ATR / price`),
    check("Liquidity OK", liquidityOk, `${formatInteger(avgVolume)} average volume`)
  ];

  let score = 0;
  if (volumeIncreasing) score += 12;
  if (rvol >= settings.minRvol) score += Math.min(24, 14 + (rvol - settings.minRvol) * 4);
  if (controlledMove) score += 10;
  if (nearResistance) score += 14;
  if (higherLow) score += 10;
  if (aboveEma9) score += 8;
  if (notExtendedFromEma20) score += 10;
  if (atrIncreasing) score += 8;
  if (liquidityOk) score += 4;
  if (alreadyExtended) score -= 22;
  if (!liquidityOk) score -= 18;

  const criticalPass =
    volumeIncreasing &&
    rvol >= settings.minRvol &&
    controlledMove &&
    nearResistance &&
    higherLow &&
    aboveEma9 &&
    notExtendedFromEma20 &&
    atrIncreasing &&
    liquidityOk &&
    !alreadyExtended;
  const probability = clamp(Math.round(score), 0, 96);
  const signal = criticalPass && probability >= 70 ? "BUY_WATCH" : probability >= 55 ? "WATCH" : "WAIT";
  const trendStage = stageFor({ signal, latest, resistance, rvol, higherLow, volumeIncreasing });
  const entry = latest.close >= resistance ? latest.close : resistance * 1.002;
  const stop = Math.min(...lastThree.map((bar) => bar.low)) * 0.995;
  const riskPerShare = Math.max(entry - stop, 0.01);
  const target = entry + riskPerShare * 2;
  const riskRewardRatio = (target - entry) / riskPerShare;
  const exampleRisk = settings.accountSize * settings.riskPct;
  const positionSize = Math.max(1, Math.floor(exampleRisk / riskPerShare));
  const riskLevel = riskLevelFor({ probability, atrPct, recentMovePct, alreadyExtended, liquidityOk });
  const entryZone = `${formatMoney(Math.min(latest.close, entry))} - ${formatMoney(entry * 1.01)}`;
  const reason = reasonFor({ signal, rvol, volumeIncreasing, distanceToResistancePct, higherLow, atrIncreasing });

  return {
    symbol: normalizeSymbol(symbol),
    price: round(latest.close),
    signal,
    reason,
    catalyst: signal === "BUY_WATCH" ? "Unusual volume ignition with bullish technical confirmation." : "No verified news catalyst; technical setup only.",
    technicalSetup: technicalSetupFor({ nearResistance, higherLow, aboveEma9, notExtendedFromEma20, atrIncreasing }),
    volumePatternSummary: `${volumeIncreasing ? "Increasing" : "Mixed"} last-3 volume, ${formatRatio(rvol)}x RVOL, ${formatInteger(latest.volume)} latest volume.`,
    rvol: round(rvol, 2),
    currentVolume: latest.volume,
    averageVolume: Math.round(avgVolume),
    resistance: round(resistance),
    distanceToResistancePct: round(distanceToResistancePct, 2),
    recentMovePct: round(recentMovePct, 2),
    ema9: round(ema9),
    ema20: round(ema20),
    ema20ExtensionPct: round(ema20ExtensionPct, 2),
    atr: round(currentAtr),
    atrPct: round(atrPct, 2),
    trendStage,
    entryZone,
    continuationProbability: probability,
    riskLevel,
    tradePlan: {
      entryPrice: round(entry),
      stopLoss: round(stop),
      targetPrice: round(target),
      riskRewardRatio: round(riskRewardRatio, 2),
      positionSizeExample: `${positionSize} shares for ${formatMoney(settings.accountSize)} account at ${(settings.riskPct * 100).toFixed(1)}% risk`,
      executionPlan: "Wait for price to hold the entry zone with volume still above average. Set stop immediately and scale profits near target.",
      finalTradeSummary: `${normalizeSymbol(symbol)} is ${signal === "BUY_WATCH" ? "a bullish watchlist candidate" : "not a confirmed buy"} based on volume ignition rules. Paper/risk approval is still required.`
    },
    checks,
    qualifies: signal === "BUY_WATCH",
    timestamp: latest.t || null
  };
}

function normalizeBar(bar) {
  return {
    t: bar.t,
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume || 0)
  };
}

function check(label, passed, detail) {
  return { label, passed: Boolean(passed), detail };
}

function ema(values, period) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  const multiplier = 2 / (period + 1);
  return clean.reduce((value, price, index) => (index === 0 ? price : price * multiplier + value * (1 - multiplier)), clean[0]);
}

function trueRanges(bars) {
  return bars.slice(1).map((bar, index) => {
    const previousClose = bars[index].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
}

function stageFor({ signal, latest, resistance, rvol, higherLow, volumeIncreasing }) {
  if (signal === "BUY_WATCH" && latest.close > resistance) return "Breakout";
  if (signal === "BUY_WATCH") return "Ignition";
  if (rvol >= 1.25 && higherLow && volumeIncreasing) return "Accumulation";
  return "Watch";
}

function riskLevelFor({ probability, atrPct, recentMovePct, alreadyExtended, liquidityOk }) {
  if (!liquidityOk || alreadyExtended || atrPct > 8 || recentMovePct > 15) return "High";
  if (probability >= 75 && atrPct <= 4) return "Medium";
  return "Medium-high";
}

function reasonFor({ signal, rvol, volumeIncreasing, distanceToResistancePct, higherLow, atrIncreasing }) {
  if (signal === "BUY_WATCH") {
    return `Volume ignition: RVOL ${formatRatio(rvol)}x, rising volume, higher low, and price within ${formatPct(distanceToResistancePct)} of resistance.`;
  }
  const missing = [];
  if (!volumeIncreasing) missing.push("3-candle volume expansion");
  if (rvol < 2) missing.push("RVOL >= 2");
  if (!higherLow) missing.push("higher low");
  if (!atrIncreasing) missing.push("ATR expansion");
  return `Watch only: ${missing.slice(0, 3).join(", ") || "setup needs more confirmation"}.`;
}

function technicalSetupFor({ nearResistance, higherLow, aboveEma9, notExtendedFromEma20, atrIncreasing }) {
  return [
    nearResistance ? "near resistance" : "not near resistance",
    higherLow ? "higher low forming" : "higher low not confirmed",
    aboveEma9 ? "above 9 EMA" : "below 9 EMA",
    notExtendedFromEma20 ? "not extended from 20 EMA" : "extended from 20 EMA",
    atrIncreasing ? "ATR expanding" : "ATR flat"
  ].join("; ");
}

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function pct(value, base) {
  return Number.isFinite(value) && Number.isFinite(base) && base !== 0 ? (value / base) * 100 : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(decimals));
}

function formatMoney(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "-";
}

function formatPct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : "-";
}

function formatRatio(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00";
}

function formatInteger(value) {
  return Number.isFinite(Number(value)) ? Math.round(value).toLocaleString("en-US") : "0";
}
