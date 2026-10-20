import { isAddress } from "@solana/kit";
import type { TokenInfo } from "@pumpfun/shared";
import type { ChainSource } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve, type BondingCurveState } from "../pump/bondingCurve";
import { PUMP_PROGRAM_ID } from "../pump/constants";
import type { CreateEvent } from "../pump/events";
import { collectSignatures } from "../signatures";
import { pumpEvents } from "../tx";

export class NotPumpTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotPumpTokenError";
  }
}

export interface ResolvedToken {
  info: TokenInfo;
  curve: BondingCurveState;
}

export async function resolveToken(mint: string, chain: ChainSource, cfg: TraceConfig): Promise<ResolvedToken> {
  if (!isAddress(mint)) throw new NotPumpTokenError("That is not a valid Solana address.");
  const curveAddress = await bondingCurvePda(mint);
  const account = await chain.getAccount(curveAddress);
  if (!account || account.owner !== PUMP_PROGRAM_ID) {
    throw new NotPumpTokenError("This is not a pump.fun token (no bonding curve found).");
  }
  const curve = decodeBondingCurve(account.data);

  let create: CreateEvent | null = null;
  let createSignature: string | null = null;
  let createBlockTime: number | null = null;
  let initialBuy: bigint | null = null;

  const { sigs, complete } = await collectSignatures(chain, mint, cfg.mintMaxPages, cfg.pageSize);
  if (complete) {
    // The creation tx is the oldest one. Check the 3 oldest in case the very first failed.
    for (let i = sigs.length - 1; i >= 0 && i >= sigs.length - 3; i--) {
      const sig = sigs[i]!;
      if (sig.err) continue;
      const tx = await chain.getTransaction(sig.signature);
      if (!tx) continue;
      const events = pumpEvents(tx);
      const found = events.find((e) => e.kind === "create" && e.event.mint === mint);
      if (!found || found.kind !== "create") continue;
      create = found.event;
      createSignature = sig.signature;
      createBlockTime = tx.blockTime;
      const user = found.event.user;
      const buy = events.find((e) => e.kind === "trade" && e.event.mint === mint && e.event.user === user && e.event.isBuy);
      initialBuy = buy && buy.kind === "trade" ? buy.event.tokenAmount : 0n;
      break;
    }
  }

  const deployer = create?.user ?? curve.creator;
  if (!deployer) throw new NotPumpTokenError("Could not determine who deployed this token.");

  const info: TokenInfo = {
    mint,
    name: create?.name ?? null,
    symbol: create?.symbol ?? null,
    uri: create?.uri ?? null,
    tokenProgram: create?.tokenProgram ?? null,
    quoteMint: curve.quoteMint,
    deployer,
    creatorCurrent: curve.creator,
    creatorOriginal: create?.creator ?? null,
    createdAt: create?.timestamp ?? createBlockTime,
    createSignature,
    complete: curve.complete,
    isMayhemMode: curve.isMayhemMode || (create?.isMayhemMode ?? false),
    devInitialBuy: initialBuy === null ? null : initialBuy.toString(),
    createTxFound: create !== null,
  };
  return { info, curve };
}
