# ChatGPT Apps Submission Steps

Use these values in the OpenAI Platform ChatGPT Apps submission flow.

## App Info

- Display name: `JARVIS Algo Trader`
- Subtitle: `Paper trading desk`
- Category: `FINANCE`
- Description: use the description imported from `chatgpt-app-submission.json`.
- Logo icon: upload `public/jarvis-logo.png`.

## MCP Server

- MCP server URL: `https://jarvis-mcp-pwxy.onrender.com/mcp`
- Status page: `https://jarvis-mcp-pwxy.onrender.com/status`
- Health check: `https://jarvis-mcp-pwxy.onrender.com/health`
- Domain verification URL: `https://jarvis-mcp-pwxy.onrender.com/.well-known/openai-apps-challenge`

## Import File

Upload this file when the platform asks for the Codex-generated submission file:

```text
chatgpt-app-submission.json
```

## Screenshots

Upload the generated dashboard screenshots on the Screenshots step:

```text
submission-assets/jarvis-dashboard-desktop.png
submission-assets/jarvis-dashboard-mobile.png
```

They are PNG files, both wider than 706px and 860px tall.

## Testing Notes

- The app is paper-trading only.
- ChatGPT does not place live orders.
- Tools can fetch portfolio state, market providers, Alpaca/Massive/Finnhub/Yahoo snapshots, intraday volume screener results, strategy suggestions, paper-trade risk approval, and trade journal rows.
- Use the positive and negative tests inside `chatgpt-app-submission.json` for the Testing step.

## Manual Checks Before Submit

- Confirm organization or individual verification is complete in the OpenAI Platform.
- Confirm the MCP URL uses HTTPS and ends with `/mcp`.
- Confirm Render services are live.
- Confirm no secret keys are pasted into the submission form.
