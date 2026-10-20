import { SqliteStore } from "@pumpfun/db";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { JobManager } from "./jobs";

const config = loadConfig(process.env);
const store = new SqliteStore(config.dbPath);
const interrupted = store.markRunningJobsInterrupted(Date.now());
const chain = new RpcChainSource(new RpcPool(config.endpoints));
const jobs = new JobManager({
  store,
  chain,
  concurrency: config.jobConcurrency,
  timeoutMs: config.jobTimeoutMs,
  log: (message, err) => console.error(message, err),
});
const app = await buildApp({ store, jobs, config, logger: true });

if (interrupted > 0) app.log.warn(`${interrupted} trace job(s) were interrupted by the last shutdown`);

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
