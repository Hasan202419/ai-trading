# JARVIS Algo Trader MVP

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Hasan202419/ai-trading)

JARVIS v1 is a paper-trading-first algo trader scaffold. It converts the provided Pine/VWAP strategy into deterministic code, keeps risk checks in code, stores analytics in Supabase, runs continuously on Render, and exposes ChatGPT Apps tools for analysis and manual paper-trade approval.

## Safety model

- Default mode is `paper`; live trading is intentionally out of scope.
- ChatGPT/OpenAI analysis can explain, summarize, and propose, but cannot place orders by itself.
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
- `src/llm/openai.js` is the advisory-only OpenAI Responses API adapter.
- `src/mcp/server.js` exposes ChatGPT Apps tools and the widget resource.
- `supabase/schema.sql` creates RLS-protected tables.
- `render.yaml` defines the Render web API, worker, and cron job.

## Deploy path

1. Confirm `render.yaml` is present at the repository root.
2. Click the Deploy to Render button above.
3. Review the Blueprint resources before approving creation.
4. Add the secret environment variables from your local `.env` when Render asks for them:

```text
ALPACA_API_KEY_ID
ALPACA_API_SECRET_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
```

5. Keep `TRADING_MODE=paper` and `REQUIRE_MANUAL_APPROVAL=true`.
6. Connect the MCP endpoint from ChatGPT developer mode after Render provides the `jarvis-mcp` HTTPS URL.

Do not commit `.env` or paste secret values into GitHub.
