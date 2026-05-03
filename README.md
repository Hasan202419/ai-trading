# JARVIS Algo Trader MVP

JARVIS v1 is a paper-trading-first algo trader scaffold. It converts the provided Pine/VWAP strategy into deterministic code, keeps risk checks in code, stores analytics in Supabase, runs continuously on Render, and exposes ChatGPT Apps tools for analysis and manual paper-trade approval.

## Safety model

- Default mode is `paper`; live trading is intentionally out of scope.
- ChatGPT tools can analyze and propose, but cannot place orders by themselves.
- Orders require deterministic strategy approval, deterministic risk approval, and manual approval by default.
- Supabase `service_role` must only be used by backend services, never by browser code.

## Local start

```bash
npm install
cp .env.example .env
npm test
npm start
```

Run the worker separately:

```bash
npm run worker
```

Run the ChatGPT Apps MCP server separately:

```bash
npm run mcp
```

## Main pieces

- `src/core/strategy.js` implements VWAP cross-up, session window, TP/SL, time exit, ATR, volume, trend, and no-trade filters.
- `src/core/risk.js` implements 0.5% per-trade risk, 2% daily max loss, 3 consecutive-loss kill switch, and paper-only enforcement.
- `src/broker/alpaca.js` is the paper broker adapter.
- `src/db/supabase.js` is the service-role backend adapter.
- `src/mcp/server.js` exposes ChatGPT Apps tools and the widget resource.
- `supabase/schema.sql` creates RLS-protected tables.
- `render.yaml` defines the Render web API, worker, and cron job.

## Deploy path

1. Create a private GitHub repo and push this project.
2. Create a Supabase project and run `supabase/schema.sql`.
3. Create Alpaca paper API keys.
4. Deploy through Render Blueprint using `render.yaml`.
5. Connect the MCP endpoint from ChatGPT developer mode after Render provides HTTPS URLs.
