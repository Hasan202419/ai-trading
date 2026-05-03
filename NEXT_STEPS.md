# JARVIS Next Steps

## 1. Local Windows setup

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-local.ps1
```

Current status in this workspace:

- Node.js LTS is installed at `C:\Program Files\nodejs`.
- `npm install` has been run successfully.
- If a terminal still cannot find `npm`, open a new terminal or temporarily prepend Node.js to PATH:

```powershell
$env:Path='C:\Program Files\nodejs;' + $env:Path
```

Then run:

```powershell
npm install
npm test
```

## 2. Supabase

Create a Supabase project, open SQL Editor, and run:

```sql
-- contents of supabase/schema.sql
```

Then copy `.env.example` to `.env` and fill:

```text
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Do not put `SUPABASE_SERVICE_ROLE_KEY` in any browser/client code.

## 3. Alpaca paper trading

Create Alpaca paper API keys and fill:

```text
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
TRADING_MODE=paper
REQUIRE_MANUAL_APPROVAL=true
```

Keep `TRADING_MODE=paper` for v1.

## 4. Local services

After `npm install` succeeds:

```powershell
npm start
npm run worker
npm run mcp
```

Health checks:

```powershell
curl http://localhost:3000/health
curl http://localhost:3333/health
```

## 5. GitHub and Render

Push the project to GitHub, then create a Render Blueprint from `render.yaml`.

Render will create:

- `jarvis-api`
- `jarvis-worker`
- `jarvis-mcp`
- `jarvis-research-cron`

Set Render secret environment variables from `.env`. Do not commit `.env`.

## 6. ChatGPT Apps

After Render gives an HTTPS URL for `jarvis-mcp`, connect it in ChatGPT developer mode as the MCP endpoint.

The tools exposed by the app are:

- `get_portfolio_status`
- `analyze_market_snapshot`
- `propose_strategy_adjustment`
- `approve_paper_trade`
- `get_trade_journal`
