import { SqliteStore } from "@pumpfun/db";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { FeedService } from "./feed/feedService";
import { MetadataFetcher } from "./feed/metadataFetcher";
import { MetadataQueue } from "./feed/metadataQueue";
import { PumpPortalClient } from "./feed/pumpPortal";
import { JobManager } from "./jobs";

const config = loadConfig(process.env);
const store = new SqliteStore(config.dbPath);
const interrupted = store.markRunningJobsInterrupted(Date.now());
const chain = new RpcChainSource(new RpcPool(config.endpoints));
const metadata = new MetadataFetcher();
const jobs = new JobManager({
  store,
  chain,
  metadata,
  concurrency: config.jobConcurrency,
  timeoutMs: config.jobTimeoutMs,
  log: (message, err) => console.error(message, err),
});
const log = (message: string, err?: unknown) => (err ? console.error(message, err) : console.log(message));
const metadataQueue = config.metadataFetch === "all" ? new MetadataQueue({ fetcher: metadata, store, log }) : undefined;
const feed = config.feedEnabled ? new FeedService({ store, chain, jobs, config: config.feed, metadata: metadataQueue, log }) : null;
const portal = feed ? new PumpPortalClient({ url: config.pumpPortalUrl, onEvent: (e) => void feed.handle(e), log }) : null;
const app = await buildApp({ store, jobs, config, logger: true, feedStatus: portal ? () => portal.connected : undefined });

if (interrupted > 0) app.log.warn(`${interrupted} trace job(s) were interrupted by the last shutdown`);

const shutdown = async () => {
  portal?.stop();
  feed?.stop();
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: "0.0.0.0" });
feed?.start();
portal?.start();
