import { readConfig } from "../config.js";
import { JarvisService } from "../services/jarvis-service.js";

const config = readConfig();
const service = new JarvisService(config);

async function tick() {
  const status = await service.getPortfolioStatus();
  await service.audit("worker_heartbeat", {
    mode: config.tradingMode,
    riskLocked: status.riskLocked,
    positions: status.positions?.length || 0
  });
  console.log(`worker heartbeat ${new Date().toISOString()} mode=${config.tradingMode}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  tick().catch((error) => console.error(error));
  setInterval(() => tick().catch((error) => console.error(error)), config.workerIntervalMs);
}
