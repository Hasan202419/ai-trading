const DEFAULT_LIMIT = 80;
const DEFAULT_TIMEFRAME = "1";

export class MarketDataRouter {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetch = fetchImpl;
    this.providers = {
      yahoo: new YahooFinanceClient(config.yahoo, fetchImpl),
      massive: new MassiveClient(config.massive, fetchImpl),
      finnhub: new FinnhubClient(config.finnhub, fetchImpl),
      finviz: new FinvizClient(config.finviz, fetchImpl)
    };
  }

  status() {
    return [
      this.providers.yahoo.status(),
      this.providers.massive.status(),
      this.providers.finnhub.status(),
      this.providers.finviz.status()
    ];
  }

  async getSnapshot({ symbol = "SPY", timeframe = DEFAULT_TIMEFRAME, limit = DEFAULT_LIMIT, provider = "auto" } = {}) {
    const normalized = normalizeSymbol(symbol);
    const candidates = this.candidates(provider);
    const errors = [];

    for (const client of candidates) {
      if (!client.isConfigured()) {
        errors.push({ provider: client.id, reason: "not_configured" });
        continue;
      }
      if (!client.supportsBars) {
        errors.push({ provider: client.id, reason: "bars_not_supported" });
        continue;
      }
      try {
        const requestedLimit = Number(limit) || DEFAULT_LIMIT;
        const [barsRaw, quote] = await Promise.all([
          client.getBars({ symbol: normalized, timeframe, limit }),
          client.getQuote({ symbol: normalized }).catch((error) => ({
            error: error.message
          }))
        ]);
        const bars = barsRaw.slice(-requestedLimit);
        if (!bars.length) {
          errors.push({ provider: client.id, reason: "no_bars_returned" });
          continue;
        }
        return {
          symbol: normalized,
          timeframe: String(timeframe),
          provider: client.id,
          providerName: client.name,
          dataDelayMinutes: client.dataDelayMinutes,
          delayed: client.dataDelayMinutes > 0,
          quote,
          bars,
          barCount: bars.length,
          fetchedAt: new Date().toISOString(),
          errors
        };
      } catch (error) {
        errors.push({ provider: client.id, reason: error.message });
      }
    }

    return {
      symbol: normalized,
      timeframe: String(timeframe),
      provider: "none",
      providerName: "No configured provider",
      dataDelayMinutes: 0,
      delayed: false,
      quote: null,
      bars: [],
      barCount: 0,
      fetchedAt: new Date().toISOString(),
      errors
    };
  }

  candidates(provider) {
    if (provider && provider !== "auto") {
      return [this.providers[provider]].filter(Boolean);
    }
    return (this.config.providerPriority || ["massive", "finnhub"])
      .map((id) => this.providers[id])
      .filter(Boolean);
  }

  async screenVolumeSpikes({
    symbols = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA"],
    lookbackDays = 20,
    volumeMultiplier = 2,
    provider = "yahoo"
  } = {}) {
    const client = this.providers[provider] || this.providers.yahoo;
    const uniqueSymbols = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))].slice(0, 100);
    const results = [];
    const errors = [];

    for (const symbol of uniqueSymbols) {
      try {
        const bars = await client.getBars({
          symbol,
          timeframe: "1d",
          limit: Math.max(Number(lookbackDays) || 20, 2)
        });
        const volumes = bars.map((bar) => Number(bar.volume)).filter(Number.isFinite);
        if (volumes.length < 2) {
          errors.push({ symbol, provider: client.id, reason: "not_enough_daily_bars" });
          continue;
        }
        const currentVolume = volumes[volumes.length - 1];
        const averageVolume = average(volumes.slice(0, -1));
        const volumeRatio = averageVolume ? currentVolume / averageVolume : 0;
        const lastBar = bars[bars.length - 1];
        results.push({
          symbol,
          provider: client.id,
          providerName: client.name,
          dataDelayMinutes: client.dataDelayMinutes,
          currentVolume,
          averageVolume,
          volumeRatio,
          isSpike: volumeRatio >= Number(volumeMultiplier),
          close: lastBar.close,
          timestamp: lastBar.t
        });
      } catch (error) {
        errors.push({ symbol, provider: client.id, reason: error.message });
      }
    }

    return {
      provider: client.id,
      providerName: client.name,
      lookbackDays: Number(lookbackDays),
      volumeMultiplier: Number(volumeMultiplier),
      scanned: uniqueSymbols.length,
      matches: results.filter((result) => result.isSpike).sort((a, b) => b.volumeRatio - a.volumeRatio),
      results: results.sort((a, b) => b.volumeRatio - a.volumeRatio),
      errors,
      fetchedAt: new Date().toISOString()
    };
  }
}

export class YahooFinanceClient {
  constructor(config = {}, fetchImpl = globalThis.fetch) {
    this.id = "yahoo";
    this.name = "Yahoo Finance";
    this.config = config;
    this.fetch = fetchImpl;
    this.supportsBars = true;
    this.dataDelayMinutes = Number(config.dataDelayMinutes || 15);
  }

  isConfigured() {
    return this.config.enabled !== false;
  }

  status() {
    return providerStatus(this, {
      role: "research_data",
      note: "No API key required. yfinance/Yahoo data should be treated as research/personal-use data, not execution-grade feed."
    });
  }

  async getQuote({ symbol }) {
    const bars = await this.getBars({ symbol, timeframe: "1d", limit: 2 });
    const latest = bars[bars.length - 1] || {};
    const previous = bars[bars.length - 2] || {};
    const change = numberOrNull(latest.close - previous.close);
    const changePercent = previous.close ? numberOrNull((change / previous.close) * 100) : null;
    return {
      symbol,
      price: numberOrNull(latest.close),
      previousClose: numberOrNull(previous.close),
      open: numberOrNull(latest.open),
      high: numberOrNull(latest.high),
      low: numberOrNull(latest.low),
      volume: numberOrNull(latest.volume),
      change,
      changePercent,
      timestamp: latest.t || null
    };
  }

  async getBars({ symbol, timeframe = DEFAULT_TIMEFRAME, limit = DEFAULT_LIMIT }) {
    const interval = yahooInterval(timeframe);
    const range = yahooRange(interval, limit);
    const data = await this.request(
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`
    );
    const result = data.chart?.result?.[0];
    const error = data.chart?.error;
    if (error) throw new Error(error.description || "Yahoo Finance chart error.");
    if (!result?.timestamp?.length) return [];
    const quote = result.indicators?.quote?.[0] || {};
    return result.timestamp
      .map((time, index) => ({
        t: new Date(Number(time) * 1000).toISOString(),
        open: numberOrNull(quote.open?.[index]),
        high: numberOrNull(quote.high?.[index]),
        low: numberOrNull(quote.low?.[index]),
        close: numberOrNull(quote.close?.[index]),
        volume: numberOrNull(quote.volume?.[index] || 0)
      }))
      .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
  }

  async request(path) {
    const response = await this.fetch(`${trimSlash(this.config.baseUrl)}${path}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Yahoo Finance request failed ${response.status}: ${text}`);
    }
    return response.json();
  }
}

export class MassiveClient {
  constructor(config = {}, fetchImpl = globalThis.fetch) {
    this.id = "massive";
    this.name = "Massive";
    this.config = config;
    this.fetch = fetchImpl;
    this.supportsBars = true;
    this.dataDelayMinutes = Number(config.dataDelayMinutes || 15);
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  status() {
    return providerStatus(this, {
      note: "Stocks Starter/Developer plans are commonly 15-minute delayed; Advanced can be real-time."
    });
  }

  async getQuote({ symbol }) {
    const data = await this.request(`/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`);
    const ticker = data.ticker || {};
    const lastTrade = ticker.lastTrade || {};
    const minute = ticker.min || {};
    const day = ticker.day || {};
    const previous = ticker.prevDay || {};
    return {
      symbol,
      price: numberOrNull(lastTrade.p ?? minute.c ?? day.c),
      previousClose: numberOrNull(previous.c),
      open: numberOrNull(day.o),
      high: numberOrNull(day.h),
      low: numberOrNull(day.l),
      volume: numberOrNull(day.v),
      change: numberOrNull(ticker.todaysChange),
      changePercent: numberOrNull(ticker.todaysChangePerc),
      timestamp: timestampFromMillis(lastTrade.t || ticker.updated || minute.t)
    };
  }

  async getBars({ symbol, timeframe = DEFAULT_TIMEFRAME, limit = DEFAULT_LIMIT }) {
    const minutes = normalizeTimeframe(timeframe);
    const { from, to } = dateRangeForBars(minutes, limit);
    const path =
      `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${minutes}/minute/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=${Math.min(Number(limit) || DEFAULT_LIMIT, 50000)}`;
    const data = await this.request(path);
    return (data.results || []).map((bar) => ({
      t: new Date(bar.t).toISOString(),
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v || 0),
      vwap: numberOrNull(bar.vw),
      transactions: numberOrNull(bar.n)
    }));
  }

  async request(path) {
    if (!this.isConfigured()) throw new Error("Massive API key is not configured.");
    const separator = path.includes("?") ? "&" : "?";
    const response = await this.fetch(`${trimSlash(this.config.baseUrl)}${path}${separator}apiKey=${encodeURIComponent(this.config.apiKey)}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Massive request failed ${response.status}: ${text}`);
    }
    return response.json();
  }
}

export class FinnhubClient {
  constructor(config = {}, fetchImpl = globalThis.fetch) {
    this.id = "finnhub";
    this.name = "Finnhub";
    this.config = config;
    this.fetch = fetchImpl;
    this.supportsBars = true;
    this.dataDelayMinutes = Number(config.dataDelayMinutes || 0);
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  status() {
    return providerStatus(this, {
      note: "Quote and stock-candle REST data. Exact exchange delay depends on your Finnhub plan."
    });
  }

  async getQuote({ symbol }) {
    const data = await this.request(`/quote?symbol=${encodeURIComponent(symbol)}`);
    return {
      symbol,
      price: numberOrNull(data.c),
      previousClose: numberOrNull(data.pc),
      open: numberOrNull(data.o),
      high: numberOrNull(data.h),
      low: numberOrNull(data.l),
      change: numberOrNull(data.d),
      changePercent: numberOrNull(data.dp),
      timestamp: data.t ? new Date(Number(data.t) * 1000).toISOString() : null
    };
  }

  async getBars({ symbol, timeframe = DEFAULT_TIMEFRAME, limit = DEFAULT_LIMIT }) {
    const minutes = normalizeTimeframe(timeframe);
    const { fromUnix, toUnix } = unixRangeForBars(minutes, limit);
    const data = await this.request(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${minutes}&from=${fromUnix}&to=${toUnix}`
    );
    if (data.s !== "ok") return [];
    return (data.t || []).map((time, index) => ({
      t: new Date(Number(time) * 1000).toISOString(),
      open: Number(data.o[index]),
      high: Number(data.h[index]),
      low: Number(data.l[index]),
      close: Number(data.c[index]),
      volume: Number(data.v[index] || 0)
    }));
  }

  async request(path) {
    if (!this.isConfigured()) throw new Error("Finnhub API key is not configured.");
    const separator = path.includes("?") ? "&" : "?";
    const response = await this.fetch(`${trimSlash(this.config.baseUrl)}${path}${separator}token=${encodeURIComponent(this.config.apiKey)}`);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Finnhub request failed ${response.status}: ${text}`);
    }
    return response.json();
  }
}

export class FinvizClient {
  constructor(config = {}, fetchImpl = globalThis.fetch) {
    this.id = "finviz";
    this.name = "Finviz";
    this.config = config;
    this.fetch = fetchImpl;
    this.supportsBars = false;
    this.dataDelayMinutes = Number(config.dataDelayMinutes || 15);
  }

  isConfigured() {
    return Boolean(this.config.apiKey && this.config.baseUrl);
  }

  status() {
    return providerStatus(this, {
      role: "research_only",
      note: "Not used for execution signals until a licensed, documented OHLCV endpoint is provided."
    });
  }
}

function providerStatus(client, extra = {}) {
  return {
    id: client.id,
    name: client.name,
    configured: client.isConfigured(),
    supportsBars: client.supportsBars,
    dataDelayMinutes: client.dataDelayMinutes,
    role: extra.role || (client.supportsBars ? "signal_data" : "research_only"),
    note: extra.note || ""
  };
}

function normalizeSymbol(symbol) {
  return String(symbol || "SPY").trim().toUpperCase().replace(/[^A-Z0-9.:-]/g, "");
}

function normalizeTimeframe(timeframe) {
  if (String(timeframe).toLowerCase() === "1d" || String(timeframe).toUpperCase() === "D") return 1440;
  const minutes = Number.parseInt(String(timeframe).replace(/[^0-9]/g, ""), 10);
  return [1, 2, 3, 5, 15, 30, 60].includes(minutes) ? minutes : 1;
}

function yahooInterval(timeframe) {
  const value = String(timeframe).toLowerCase();
  if (value === "1d" || value === "d" || value === "1440") return "1d";
  const minutes = normalizeTimeframe(timeframe);
  return `${minutes}m`;
}

function yahooRange(interval, limit) {
  const count = Math.max(Number(limit) || DEFAULT_LIMIT, 2);
  if (interval === "1d") return `${Math.max(count + 5, 30)}d`;
  if (["1m", "2m", "3m", "5m"].includes(interval)) return "5d";
  return "1mo";
}

function dateRangeForBars(minutes, limit) {
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - lookbackMs(minutes, limit));
  return {
    from: formatDate(fromDate),
    to: formatDate(toDate)
  };
}

function unixRangeForBars(minutes, limit) {
  const toUnix = Math.floor(Date.now() / 1000);
  const fromUnix = toUnix - Math.ceil(lookbackMs(minutes, limit) / 1000);
  return { fromUnix, toUnix };
}

function lookbackMs(minutes, limit) {
  const requested = Math.max(Number(limit) || DEFAULT_LIMIT, DEFAULT_LIMIT);
  return Math.max(requested * minutes * 90 * 1000, 3 * 24 * 60 * 60 * 1000);
}

function formatDate(value) {
  return value.toISOString().slice(0, 10);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function timestampFromMillis(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number).toISOString() : null;
}

function trimSlash(value = "") {
  return String(value).replace(/\/+$/, "");
}
