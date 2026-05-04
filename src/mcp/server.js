import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import http from "node:http";
import { readConfig } from "../config.js";
import { JarvisService } from "../services/jarvis-service.js";

const config = readConfig();
const service = new JarvisService(config);
const widgetUri = "ui://widget/jarvis-dashboard-v1.html";
const widgetHtml = readFileSync(new URL("../../public/jarvis-widget.html", import.meta.url), "utf8");

const httpServer = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "jarvis-mcp", mode: config.tradingMode, endpoint: "/mcp" }));
    return;
  }
  if (req.method === "GET" && pathname === "/status") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderStatusPage());
    return;
  }
  if (!["/", "/mcp"].includes(pathname)) {
    jsonRpcError(res, 404, -32001, "MCP endpoint not found.");
    return;
  }
  if (req.method === "GET" && pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderStatusPage());
    return;
  }
  if (req.method !== "POST") {
    jsonRpcError(res, 405, -32000, "Method not allowed.");
    return;
  }

  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, "Internal server error.");
    }
  }
});

httpServer.listen(config.mcpPort, () => {
  console.log(`JARVIS MCP listening on ${config.mcpPort}`);
});

function createMcpServer() {
  const server = new McpServer({ name: "jarvis-algo-trader", version: "0.1.0" });

  server.registerResource(
    "jarvis-dashboard",
    widgetUri,
    { title: "JARVIS Dashboard", mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: widgetUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              prefersBorder: true,
              domain: config.appPublicUrl,
              csp: {
                connectDomains: [config.appPublicUrl, config.mcpPublicUrl],
                resourceDomains: []
              }
            }
          }
        }
      ]
    })
  );

  server.registerTool(
    "get_portfolio_status",
    {
      title: "Get Portfolio Status",
      description: "Use this when the user asks for account, position, open order, P/L, or risk lock status.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async () => toolResult(await service.getPortfolioStatus(), "Portfolio status loaded.")
  );

  server.registerTool(
    "analyze_market_snapshot",
    {
      title: "Analyze Market Snapshot",
      description: "Use this when the user provides OHLCV bars or wants JARVIS to fetch market data and produce advisory-only VWAP/ATR/volume analysis.",
      inputSchema: {
        symbol: z.string().default("SPY"),
        timeframe: z.string().default("1"),
        provider: z.enum(["auto", "yahoo", "massive", "finnhub"]).default("auto"),
        bars: z.array(z.record(z.any())).default([])
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(await service.analyzeMarketSnapshot(input), "Market snapshot analyzed. No order was placed.")
  );

  server.registerTool(
    "get_market_providers",
    {
      title: "Get Market Providers",
      description: "Use this when the user asks which market-data APIs are configured for JARVIS.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async () => toolResult(service.getMarketProviders(), "Market-data provider status loaded.")
  );

  server.registerTool(
    "get_market_snapshot",
    {
      title: "Get Market Snapshot",
      description: "Fetch read-only delayed or real-time OHLCV data from configured providers and evaluate the deterministic VWAP signal.",
      inputSchema: {
        symbol: z.string().default("SPY"),
        timeframe: z.string().default("1"),
        limit: z.number().int().min(2).max(500).default(80),
        provider: z.enum(["auto", "yahoo", "massive", "finnhub"]).default("auto")
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(await service.getMarketSnapshot(input), "Market snapshot loaded. No order was placed.")
  );

  server.registerTool(
    "screen_volume_spikes",
    {
      title: "Screen Volume Spikes",
      description: "Run a read-only Yahoo/Finviz-style stock screener for abnormal daily volume. It never places orders.",
      inputSchema: {
        symbols: z.array(z.string()).default(["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"]),
        lookbackDays: z.number().int().min(5).max(120).default(20),
        volumeMultiplier: z.number().min(1).max(20).default(2),
        provider: z.enum(["yahoo"]).default("yahoo")
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(await service.screenStocks(input), "Volume screener finished. No order was placed.")
  );

  server.registerTool(
    "propose_strategy_adjustment",
    {
      title: "Propose Strategy Adjustment",
      description: "Use this when the user wants advisory-only parameter changes based on recent stats or market mode.",
      inputSchema: {
        recentStats: z.record(z.any()).default({}),
        marketMode: z.enum(["normal", "high_volatility", "low_liquidity", "news_risk"]).default("normal")
      },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(service.proposeStrategyAdjustment(input), "Strategy adjustment proposal prepared for human review.")
  );

  server.registerTool(
    "approve_paper_trade",
    {
      title: "Approve Paper Trade",
      description: "Use this only after the user explicitly approves a paper trade. It evaluates deterministic risk and returns an order plan; it does not enable live trading.",
      inputSchema: {
        approvedBy: z.string(),
        signal: z.record(z.any()),
        account: z.record(z.any()),
        dayStats: z.record(z.any()).default({})
      },
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(await service.approvePaperTrade(input), "Paper-trade approval was evaluated by the risk manager.")
  );

  server.registerTool(
    "get_trade_journal",
    {
      title: "Get Trade Journal",
      description: "Use this when the user asks for recent trades, exits, mistakes, or audit history.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(20) },
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async ({ limit }) => toolResult(await service.getTradeJournal(limit), "Trade journal loaded.")
  );

  return server;
}

function toolResult(data, text) {
  return {
    structuredContent: data,
    content: [{ type: "text", text }],
    _meta: { fetchedAt: new Date().toISOString(), raw: data }
  };
}

function jsonRpcError(res, status, code, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

function renderStatusPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JARVIS MCP Status</title>
    <style>
      :root {
        color: #e6edf2;
        background: #070b0f;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: grid;
        min-height: 100vh;
        margin: 0;
        place-items: center;
        background:
          linear-gradient(180deg, rgba(13, 22, 30, 0.96), #070b0f),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 72px);
      }
      main {
        width: min(760px, calc(100vw - 28px));
        border: 1px solid rgba(126, 155, 170, 0.24);
        border-radius: 8px;
        background: rgba(12, 20, 27, 0.96);
        padding: 24px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 34px;
        letter-spacing: 0;
      }
      p {
        color: #9fb0ba;
        line-height: 1.55;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }
      .card {
        border: 1px solid rgba(126, 155, 170, 0.2);
        border-radius: 8px;
        padding: 12px;
        background: rgba(7, 13, 18, 0.58);
      }
      span {
        color: #90a3ae;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }
      strong {
        display: block;
        color: #6ee7c7;
        margin-top: 8px;
      }
      code {
        color: #78e9cd;
      }
      @media (max-width: 640px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>JARVIS MCP is online</h1>
      <p>This service is the ChatGPT Apps/MCP bridge. Use <code>/mcp</code> as the MCP endpoint. Health checks stay available at <code>/health</code>.</p>
      <div class="grid">
        <div class="card"><span>Service</span><strong>jarvis-mcp</strong></div>
        <div class="card"><span>Mode</span><strong>${escapeHtml(config.tradingMode)}</strong></div>
        <div class="card"><span>Orders</span><strong>advisory only</strong></div>
      </div>
    </main>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[char];
  });
}
