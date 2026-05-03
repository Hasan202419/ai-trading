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
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "jarvis-mcp" }));
    return;
  }
  if (!["/", "/mcp"].includes(new URL(req.url, "http://localhost").pathname)) {
    jsonRpcError(res, 404, -32001, "MCP endpoint not found.");
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
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async () => toolResult(await service.getPortfolioStatus(), "Portfolio status loaded.")
  );

  server.registerTool(
    "analyze_market_snapshot",
    {
      title: "Analyze Market Snapshot",
      description: "Use this when the user provides OHLCV bars and wants an advisory-only VWAP/ATR/volume analysis.",
      inputSchema: {
        symbol: z.string().default("SPY"),
        bars: z.array(z.record(z.any()))
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: widgetUri }, "openai/outputTemplate": widgetUri }
    },
    async (input) => toolResult(await service.analyzeMarketSnapshot(input), "Market snapshot analyzed. No order was placed.")
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
      annotations: { readOnlyHint: true },
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
      annotations: { destructiveHint: false, openWorldHint: true },
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
      annotations: { readOnlyHint: true },
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
