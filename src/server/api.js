import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { readConfig } from "../config.js";
import { evaluateLatestSignal } from "../core/strategy.js";
import { evaluateRisk } from "../core/risk.js";
import { JarvisService } from "../services/jarvis-service.js";

const config = readConfig();
const service = new JarvisService(config);
const publicRoot = resolve(process.cwd(), "public");
const maxJsonBodyBytes = 1024 * 1024;

const routes = {
  "GET /health": async () => ({ ok: true, service: "jarvis-api", mode: config.tradingMode }),
  "GET /api/portfolio/status": async () => service.getPortfolioStatus(),
  "GET /api/market/providers": async () => service.getMarketProviders(),
  "GET /api/market/snapshot": async (_body, req) => {
    const params = new URL(req.url, "http://localhost").searchParams;
    return service.getMarketSnapshot({
      symbol: params.get("symbol") || undefined,
      timeframe: params.get("timeframe") || undefined,
      limit: params.get("limit") || undefined,
      provider: params.get("provider") || undefined
    });
  },
  "GET /api/screener/volume-spikes": async (_body, req) => {
    const params = new URL(req.url, "http://localhost").searchParams;
    return service.screenStocks({
      symbols: params.get("symbols") || undefined,
      lookbackDays: params.get("lookbackDays") || undefined,
      volumeMultiplier: params.get("volumeMultiplier") || undefined,
      provider: params.get("provider") || undefined,
      timeframe: params.get("timeframe") || undefined
    });
  },
  "GET /api/screener/volume-ignition": async (_body, req) => {
    const params = new URL(req.url, "http://localhost").searchParams;
    return service.screenVolumeIgnition({
      symbols: params.get("symbols") || undefined,
      provider: params.get("provider") || undefined,
      timeframe: params.get("timeframe") || undefined,
      lookbackBars: params.get("lookbackBars") || undefined,
      volumeMultiplier: params.get("volumeMultiplier") || undefined,
      minAverageVolume: params.get("minAverageVolume") || undefined,
      maxRecentMovePct: params.get("maxRecentMovePct") || undefined
    });
  },
  "GET /api/trade-journal": async () => service.getTradeJournal(20),
  "POST /api/strategy/evaluate": async (body) => {
    const signal = evaluateLatestSignal(body.bars || [], { ...config.strategy, ...(body.settings || {}) });
    return { signal };
  },
  "POST /api/llm/analyze": async (body) => service.analyzeMarketSnapshot(body),
  "POST /api/risk/evaluate": async (body) => ({
    decision: evaluateRisk({
      signal: body.signal,
      account: body.account,
      dayStats: body.dayStats,
      settings: { ...service.riskSettings, ...(body.settings || {}) },
      manualApproval: Boolean(body.manualApproval)
    })
  }),
  "POST /api/paper/approve": async (body) => service.approvePaperTrade(body)
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/") {
      await servePublicFile("jarvis-widget.html", res);
      return;
    }
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/submission") {
      await servePublicFile("submission.html", res);
      return;
    }
    if (req.method === "GET" && new URL(req.url, "http://localhost").pathname === "/chatgpt-app-submission.json") {
      await serveSubmissionJson(res);
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/public/")) {
      await servePublic(req, res);
      return;
    }
    const key = `${req.method} ${new URL(req.url, "http://localhost").pathname}`;
    const handler = routes[key];
    if (!handler) {
      json(res, 404, { error: "not_found" });
      return;
    }
    const body = await readJson(req);
    const result = await handler(body, req);
    json(res, 200, result);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`JARVIS API listening on ${config.port}`);
});

async function readJson(req) {
  if (req.method === "GET") return {};
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxJsonBodyBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, value) {
  res.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8" }));
  res.end(JSON.stringify(value));
}

async function servePublic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname.replace("/public/", "");
  await servePublicFile(pathname, res);
}

async function servePublicFile(pathname, res) {
  const file = resolve(publicRoot, String(pathname || "").replace(/^\/+/, ""));
  if (!isInsidePublicRoot(file)) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, securityHeaders({ "Content-Type": mimeFor(file) }));
    res.end(content);
  } catch {
    json(res, 404, { error: "not_found" });
  }
}

async function serveSubmissionJson(res) {
  const content = await readFile(join(process.cwd(), "chatgpt-app-submission.json"));
  res.writeHead(200, securityHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": "attachment; filename=\"chatgpt-app-submission.json\""
  }));
  res.end(content);
}

function isInsidePublicRoot(file) {
  return file === publicRoot || file.startsWith(`${publicRoot}${sep}`);
}

function mimeFor(file) {
  const extension = extname(file).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml; charset=utf-8"
  };
  return types[extension] || "application/octet-stream";
}

function securityHeaders(headers = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'self' https://chatgpt.com https://chat.openai.com https://platform.openai.com",
      "frame-src https://www.tradingview.com https://s.tradingview.com https://www.tradingview-widget.com",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' https://s3.tradingview.com",
      `connect-src 'self' ${config.appPublicUrl} ${config.mcpPublicUrl}`
    ].join("; "),
    ...headers
  };
}
