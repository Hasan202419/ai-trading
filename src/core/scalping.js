import { calculateIndicators } from "./strategy.js";

export function analyzeScalpingSignal(rawBars, strategySettings = {}, options = {}) {
  const settings = {
    fastEma: 8,
    slowEma: 21,
    volumeLookback: 20,
    minVolumeRatio: 1.15,
    spikeVolumeRatio: 1.8,
    ...options
  };
  const bars = calculateIndicators(rawBars || [], {
    marketTimezone: "America/New_York",
    atrPeriod: 14,
    volumeLookback: settings.volumeLookback,
    trendLookback: settings.slowEma,
    ...strategySettings
  });

  if (bars.length < settings.slowEma + 1) {
    return emptyScalpingSignal("need_more_bars", bars.length);
  }

  const closes = bars.map((bar) => Number(bar.close));
  const fast = emaSeries(closes, settings.fastEma);
  const slow = emaSeries(closes, settings.slowEma);
  const current = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const fastNow = fast[fast.length - 1];
  const slowNow = slow[slow.length - 1];
  const fastPrevious = fast[fast.length - 2];
  const slowPrevious = slow[slow.length - 2];
  const currentVolume = Number(current.volume || 0);
  const averageVolume = average(
    bars
      .slice(Math.max(0, bars.length - settings.volumeLookback - 1), -1)
      .map((bar) => Number(bar.volume || 0))
  );
  const volumeRatio = averageVolume ? currentVolume / averageVolume : 0;
  const trendUp = fastNow > slowNow && fastNow >= fastPrevious && current.close >= fastNow;
  const trendDown = fastNow < slowNow && current.close < fastNow;
  const momentumUp = Number(current.close) > Number(previous.close);
  const vwapHold = Number(current.close) >= Number(current.vwap || current.close);
  const volumeConfirmed = volumeRatio >= settings.minVolumeRatio;
  const volumeSpike = volumeRatio >= settings.spikeVolumeRatio;
  const score =
    (trendUp ? 30 : 0) +
    (volumeConfirmed ? 24 : 0) +
    (vwapHold ? 18 : 0) +
    (momentumUp ? 16 : 0) +
    (volumeSpike ? 12 : 0);
  const recent = bars.slice(-12);
  const support = Math.min(...recent.map((bar) => Number(bar.low)).filter(Number.isFinite));
  const resistance = Math.max(...recent.map((bar) => Number(bar.high)).filter(Number.isFinite));
  const signal = trendUp && volumeConfirmed && vwapHold && momentumUp
    ? "BUY_WATCH"
    : trendUp && (volumeConfirmed || vwapHold)
      ? "WATCH"
      : trendDown
        ? "AVOID"
        : "WAIT";
  const reason = signal === "BUY_WATCH"
    ? "volume_trend_vwap_aligned"
    : signal === "WATCH"
      ? "trend_ok_waiting_for_confirmation"
      : signal === "AVOID"
        ? "trend_down"
        : "setup_not_ready";

  return {
    name: "Scalping Pro",
    mode: "advisory_only",
    signal,
    reason,
    confidence: Math.min(100, score),
    bias: trendUp ? "long" : trendDown ? "avoid_long" : "neutral",
    checklist: [
      check("Trend", trendUp, `EMA ${settings.fastEma} ${trendUp ? "above" : "not above"} EMA ${settings.slowEma}`),
      check("Volume", volumeConfirmed, `${round(volumeRatio)}x average volume`),
      check("VWAP", vwapHold, current.vwap ? `price ${vwapHold ? "above" : "below"} VWAP` : "VWAP unavailable"),
      check("Momentum", momentumUp, momentumUp ? "last bar closed higher" : "last bar did not close higher")
    ],
    trend: {
      direction: trendUp ? "up" : trendDown ? "down" : "flat",
      fastEma: round(fastNow),
      slowEma: round(slowNow),
      spreadPct: slowNow ? round(((fastNow - slowNow) / slowNow) * 100) : 0
    },
    volume: {
      current: currentVolume,
      average: Math.round(averageVolume),
      ratio: round(volumeRatio),
      spike: volumeSpike
    },
    levels: {
      entryReference: round(current.close),
      support: Number.isFinite(support) ? round(support) : null,
      resistance: Number.isFinite(resistance) ? round(resistance) : null,
      vwap: round(current.vwap),
      stopReference: round(current.low)
    },
    orderRule: "paper_only_manual_risk_approval"
  };
}

function emptyScalpingSignal(reason, barCount) {
  return {
    name: "Scalping Pro",
    mode: "advisory_only",
    signal: "WAIT",
    reason,
    confidence: 0,
    bias: "neutral",
    barCount,
    checklist: [
      check("Trend", false, "need more bars"),
      check("Volume", false, "need more bars"),
      check("VWAP", false, "need more bars"),
      check("Momentum", false, "need more bars")
    ],
    trend: { direction: "unknown", fastEma: null, slowEma: null, spreadPct: 0 },
    volume: { current: 0, average: 0, ratio: 0, spike: false },
    levels: { entryReference: null, support: null, resistance: null, vwap: null, stopReference: null },
    orderRule: "paper_only_manual_risk_approval"
  };
}

function check(label, passed, detail) {
  return { label, passed, detail };
}

function emaSeries(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [];
  let ema = values[0];
  for (const value of values) {
    ema = result.length ? value * multiplier + ema * (1 - multiplier) : value;
    result.push(ema);
  }
  return result;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
}
