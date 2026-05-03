import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readConfig } from "../config.js";
import { evaluateLatestSignal } from "../core/strategy.js";
import { evaluateRisk } from "../core/risk.js";
import { JarvisService } from "../services/jarvis-service.js";

const config = readConfig();
const service = new JarvisService(config);

const routes = {
  "GET /health": async () => ({ ok: true, service: "jarvis-api", mode: config.tradingMode }),
  "GET /api/portfolio/status": async () => service.getPortfolioStatus(),
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
    const result = await handler(body);
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
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

async function servePublic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname.replace("/public/", "");
  const file = join(process.cwd(), "public", pathname);
  const content = await readFile(file);
  const mime = extname(file) === ".html" ? "text/html" : "text/plain";
  res.writeHead(200, { "Content-Type": mime });
  res.end(content);
}
