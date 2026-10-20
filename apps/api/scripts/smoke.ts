import { runTrace } from "@pumpfun/core";
import { SqliteStore } from "@pumpfun/db";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { loadConfig } from "../src/config";

const mint = process.argv[2];
if (!mint) {
  console.error("usage: pnpm --filter @pumpfun/api smoke <MINT>");
  process.exit(1);
}

const config = loadConfig(process.env);
const store = new SqliteStore(process.env.DB_PATH ?? "./smoke.db");
const chain = new RpcChainSource(new RpcPool(config.endpoints));
const started = Date.now();
const stamp = () => `[${((Date.now() - started) / 1000).toFixed(1)}s]`;

try {
  const result = await runTrace(mint, {
    chain,
    store,
    emit: (e) => console.log(stamp(), e.type, JSON.stringify(e.data).slice(0, 240)),
    onStepError: (step, err) => console.error(stamp(), `step ${step} failed:`, err),
  });
  store.saveResult(result);
  console.log(stamp(), "score", JSON.stringify(result.score, null, 2));
} finally {
  store.close();
}
