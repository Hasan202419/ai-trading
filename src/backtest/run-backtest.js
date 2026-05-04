import { readFile } from "node:fs/promises";
import { readConfig } from "../config.js";
import { runStrategy } from "../core/strategy.js";

const [, , inputFile] = process.argv;
if (!inputFile) {
  console.error("Usage: npm run backtest -- path/to/bars.json");
  process.exit(1);
}

const bars = JSON.parse(await readFile(inputFile, "utf8"));
const result = runStrategy(bars, readConfig().strategy);
console.log(JSON.stringify({ events: result.events, eventCount: result.events.length }, null, 2));

