import { bondingCurvePda } from "../pda";
import { PUMP_PROGRAM_ID } from "../pump/constants";
import { addr, encodeBondingCurve, encodeCreateEvent, encodeTradeEvent } from "./encode";
import { FakeChain } from "./fakeChain";
import { makeTx, pumpEventIx, systemTransfer, tokenBal } from "./tx";

export interface Scenario {
  chain: FakeChain;
  mint: string;
  deployer: string;
  funder: string;
  insider: string;
  now: number;
  createdAt: number;
}

/**
 * One token, deployed by a wallet funded 10 minutes before launch.
 * The dev bought 1000, sold 600, moved 100 to an insider, holds 300.
 */
export async function createScenario(): Promise<Scenario> {
  const chain = new FakeChain();
  const mint = addr(20);
  const deployer = addr(10);
  const funder = addr(11);
  const insider = addr(30);
  const now = 1_800_000_000;
  const createdAt = now - 7200;
  const curve = await bondingCurvePda(mint);

  chain.accounts.set(curve, { address: curve, owner: PUMP_PROGRAM_ID, data: encodeBondingCurve({ complete: false, creator: deployer }) });

  const createTx = makeTx({
    signature: "create-main",
    blockTime: createdAt,
    accountKeys: [deployer],
    inner: [
      pumpEventIx(encodeCreateEvent({ name: "Test Coin", symbol: "TEST", uri: "https://example.com/meta.json", mint, bondingCurve: curve, user: deployer, creator: deployer, timestamp: createdAt })),
      pumpEventIx(encodeTradeEvent({ mint, solAmount: 1_000_000_000n, tokenAmount: 1000n, isBuy: true, user: deployer, timestamp: createdAt })),
    ],
  });
  chain.setHistory(curve, [{ signature: "create-main", tx: createTx }]);

  const fundTx = makeTx({ signature: "fund-dev", blockTime: createdAt - 600, instructions: [systemTransfer(funder, deployer, 2_000_000_000)] });
  const sellTx = makeTx({
    signature: "sell-1",
    blockTime: createdAt + 600,
    accountKeys: [deployer, curve],
    preBalances: [1_000_000_000, 0],
    postBalances: [1_500_000_000, 0],
    preTokenBalances: [tokenBal(1, mint, deployer, 1000)],
    postTokenBalances: [tokenBal(1, mint, deployer, 400)],
  });
  const moveTx = makeTx({
    signature: "move-1",
    blockTime: createdAt + 900,
    accountKeys: [deployer, insider],
    preBalances: [1_500_000_000, 0],
    postBalances: [1_490_000_000, 2_000_000],
    preTokenBalances: [tokenBal(2, mint, deployer, 400)],
    postTokenBalances: [tokenBal(2, mint, deployer, 300), tokenBal(3, mint, insider, 100)],
  });
  chain.setHistory(deployer, [
    { signature: "fund-dev", tx: fundTx },
    { signature: "create-main", tx: createTx },
    { signature: "sell-1", tx: sellTx },
    { signature: "move-1", tx: moveTx },
  ]);

  const funderTx = makeTx({ signature: "funder-own", blockTime: createdAt - 86_400, instructions: [systemTransfer(funder, addr(40), 1_000_000)] });
  chain.setHistory(funder, [{ signature: "funder-own", tx: funderTx }]);

  chain.holdings.set(deployer, [{ mint, amount: "300" }]);
  return { chain, mint, deployer, funder, insider, now, createdAt };
}
