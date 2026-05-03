import { getZonedParts, isInSession, isSessionExit } from "./time.js";

export const SIGNAL = Object.freeze({
  NONE: "NONE",
  BUY: "BUY",
  SELL: "SELL",
  STOP: "STOP",
  TIME: "TIME",
  BLOCKED: "BLOCKED"
});

export function normalizeBar(bar) {
  return {
    t: bar.t || bar.timestamp || bar.time,
    open: Number(bar.open ?? bar.o),
    high: Number(bar.high ?? bar.h),
    low: Number(bar.low ?? bar.l),
    close: Number(bar.close ?? bar.c),
    volume: Number(bar.volume ?? bar.v ?? 0)
  };
}

export function calculateIndicators(rawBars, settings) {
  const bars = rawBars.map(normalizeBar);
  let sessionDate = "";
  let cumulativePv = 0;
  let cumulativeVolume = 0;
  const trueRanges = [];
  const volumes = [];
  const closes = [];

  return bars.map((bar, index) => {
    const zoned = getZonedParts(bar.t, settings.marketTimezone);
    if (zoned.dateKey !== sessionDate) {
      sessionDate = zoned.dateKey;
      cumulativePv = 0;
      cumulativeVolume = 0;
    }

    const typical = (bar.high + bar.low + bar.close) / 3;
    cumulativePv += typical * Math.max(bar.volume, 0);
    cumulativeVolume += Math.max(bar.volume, 0);
    const vwap = cumulativeVolume > 0 ? cumulativePv / cumulativeVolume : bar.close;

    const previous = bars[index - 1];
    const trueRange = previous
      ? Math.max(
          bar.high - bar.low,
          Math.abs(bar.high - previous.close),
          Math.abs(bar.low - previous.close)
        )
      : bar.high - bar.low;
    trueRanges.push(trueRange);
    volumes.push(bar.volume);
    closes.push(bar.close);

    const atr = average(last(trueRanges, settings.atrPeriod));
    const avgVolume = average(last(volumes.slice(0, -1), settings.volumeLookback));
    const trendMa = average(last(closes, settings.trendLookback));

    return {
      ...bar,
      vwap,
      atr,
      atrPct: atr && bar.close ? atr / bar.close : 0,
      avgVolume,
      volumeRatio: avgVolume ? bar.volume / avgVolume : 1,
      trendMa,
      marketDate: zoned.dateKey
    };
  });
}

export function evaluateLatestSignal(rawBars, settings, openTrade = null) {
  const enriched = calculateIndicators(rawBars, settings);
  if (enriched.length < 2) {
    return { signal: SIGNAL.NONE, reason: "need_at_least_two_bars" };
  }

  const previous = enriched[enriched.length - 2];
  const current = enriched[enriched.length - 1];
  return evaluateBar(previous, current, settings, openTrade);
}

export function runStrategy(rawBars, settings) {
  const enriched = calculateIndicators(rawBars, settings);
  const events = [];
  let openTrade = null;

  for (let index = 1; index < enriched.length; index += 1) {
    const previous = enriched[index - 1];
    const current = enriched[index];
    const event = evaluateBar(previous, current, settings, openTrade);

    if (event.signal === SIGNAL.BUY) {
      openTrade = {
        entry: event.entry,
        sl: event.sl,
        tp: event.tp,
        openedAt: current.t
      };
      events.push(event);
      continue;
    }

    if ([SIGNAL.SELL, SIGNAL.STOP, SIGNAL.TIME].includes(event.signal)) {
      openTrade = null;
      events.push(event);
    }
  }

  return { bars: enriched, events };
}

export function evaluateBar(previous, current, settings, openTrade = null) {
  if (openTrade) {
    if (current.close >= openTrade.tp) {
      return exitEvent(SIGNAL.SELL, "take_profit", current, openTrade);
    }
    if (current.close <= openTrade.sl) {
      return exitEvent(SIGNAL.STOP, "stop_loss", current, openTrade);
    }
    if (isSessionExit(current.t, settings)) {
      return exitEvent(SIGNAL.TIME, "session_time_exit", current, openTrade);
    }
    return { signal: SIGNAL.NONE, reason: "trade_open" };
  }

  const blockedReason = marketBlockReason(previous, current, settings);
  if (blockedReason) {
    return { signal: SIGNAL.BLOCKED, reason: blockedReason, bar: current };
  }

  const bullCross = previous.close <= previous.vwap && current.close > current.vwap;
  if (!bullCross) {
    return { signal: SIGNAL.NONE, reason: "no_vwap_cross" };
  }

  const previousLow = Number.isFinite(previous.low) ? previous.low : current.low;
  const rawRisk = current.close - previousLow;
  const risk = Math.max(rawRisk, settings.minTick * 2);
  return {
    signal: SIGNAL.BUY,
    reason: "vwap_cross_up_confirmed",
    bar: current,
    entry: current.close,
    sl: current.close - risk,
    tp: current.close + risk * settings.rewardRiskRatio,
    riskPerShare: risk,
    filters: filterSnapshot(current)
  };
}

function marketBlockReason(_previous, current, settings) {
  if (!isInSession(current.t, settings)) return "outside_session_window";
  if (settings.noTradeDates?.includes(current.marketDate)) return "no_trade_date";
  if (current.atrPct < settings.minAtrPct) return "atr_too_low";
  if (current.atrPct > settings.maxAtrPct) return "atr_too_high";
  if (current.volumeRatio < settings.minVolumeRatio) return "volume_not_confirmed";
  if (current.trendMa && current.close < current.trendMa) return "trend_filter_reject";
  return "";
}

function exitEvent(signal, reason, current, openTrade) {
  return {
    signal,
    reason,
    bar: current,
    entry: openTrade.entry,
    exit: current.close,
    sl: openTrade.sl,
    tp: openTrade.tp
  };
}

function filterSnapshot(current) {
  return {
    atrPct: current.atrPct,
    volumeRatio: current.volumeRatio,
    trendMa: current.trendMa,
    vwap: current.vwap
  };
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function last(values, count) {
  return values.slice(Math.max(0, values.length - count));
}
