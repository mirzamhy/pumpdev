// Prints a few pump.fun mints created in the last minutes (for smoke tests).
import { PUMP_PROGRAM_ID, allInstructions, pumpEvents } from "@pumpfun/core";
import { RpcChainSource, RpcPool } from "@pumpfun/solana";
import { loadConfig } from "../src/config";

const chain = new RpcChainSource(new RpcPool(loadConfig(process.env).endpoints));
const sigs = await chain.getSignatures(PUMP_PROGRAM_ID, { limit: 100 });
console.log(`scanning ${sigs.length} recent pump.fun transactions`);
let found = 0;
let scanned = 0;
for (const s of sigs) {
  if (s.err) continue;
  const tx = await chain.getTransaction(s.signature);
  if (!tx) continue;
  if (scanned++ === 0) {
    const pumpIx = allInstructions(tx).filter((ix) => ix.programId === PUMP_PROGRAM_ID);
    console.log("first tx pump instructions:", JSON.stringify(pumpIx.map((ix) => ({ keys: Object.keys(ix), data: ix.data?.slice(0, 24) }))));
    console.log("events:", pumpEvents(tx).map((e) => e.kind));
  }
  for (const e of pumpEvents(tx)) if (e.kind === "trade") console.log("TRADE", e.event.mint);
  const create = pumpEvents(tx).find((e) => e.kind === "create");
  if (create && create.kind === "create") {
    console.log("CREATE", create.event.mint, create.event.symbol, create.event.tokenProgram);
    if (++found >= 2) break;
  }
  if (scanned >= 8) break;
}
console.log(`scanned ${scanned}, found ${found}`);
