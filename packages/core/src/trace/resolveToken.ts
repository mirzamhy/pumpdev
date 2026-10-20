import { isAddress } from "@solana/kit";
import type { TokenInfo } from "@pumpfun/shared";
import type { ChainSource } from "../chain";
import type { TraceConfig } from "../config";
import { bondingCurvePda } from "../pda";
import { decodeBondingCurve, type BondingCurveState } from "../pump/bondingCurve";
import { PUMP_PROGRAM_ID } from "../pump/constants";
import type { CreateEvent } from "../pump/events";
import { fetchTokenMetadata } from "../pump/metadata";
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

interface CreationTx {
  event: CreateEvent;
  signature: string;
  blockTime: number | null;
  initialBuy: bigint;
}

async function readCreation(chain: ChainSource, mint: string, signature: string): Promise<CreationTx | null> {
  const tx = await chain.getTransaction(signature);
  if (!tx) return null;
  const events = pumpEvents(tx);
  const found = events.find((e) => e.kind === "create" && e.event.mint === mint);
  if (!found || found.kind !== "create") return null;
  const user = found.event.user;
  const buy = events.find((e) => e.kind === "trade" && e.event.mint === mint && e.event.user === user && e.event.isBuy);
  return { event: found.event, signature, blockTime: tx.blockTime, initialBuy: buy && buy.kind === "trade" ? buy.event.tokenAmount : 0n };
}

async function findCreation(chain: ChainSource, mint: string, curveAddress: string, cfg: TraceConfig): Promise<CreationTx | null> {
  const { sigs, complete } = await collectSignatures(chain, curveAddress, cfg.curveMaxPages, cfg.pageSize);
  if (!complete) return null;
  // The curve only sees bonding-curve trades (not post-migration AMM swaps), so its history stays
  // bounded even for huge tokens. The creation tx is the oldest one; check 3 in case the first failed.
  for (let i = sigs.length - 1; i >= 0 && i >= sigs.length - 3; i--) {
    const sig = sigs[i]!;
    if (sig.err) continue;
    const creation = await readCreation(chain, mint, sig.signature);
    if (creation) return creation;
  }
  return null;
}

/** `knownCreateSignature` comes from an earlier trace; busy tokens outgrow the history walk within hours. */
export async function resolveToken(
  mint: string,
  chain: ChainSource,
  cfg: TraceConfig,
  knownCreateSignature: string | null = null,
): Promise<ResolvedToken> {
  if (!isAddress(mint)) throw new NotPumpTokenError("That is not a valid Solana address.");
  const curveAddress = await bondingCurvePda(mint);
  const account = await chain.getAccount(curveAddress);
  if (!account || account.owner !== PUMP_PROGRAM_ID) {
    throw new NotPumpTokenError("This is not a pump.fun token (no bonding curve found).");
  }
  const curve = decodeBondingCurve(account.data);

  const creation =
    (knownCreateSignature ? await readCreation(chain, mint, knownCreateSignature) : null) ??
    (await findCreation(chain, mint, curveAddress, cfg));
  const create = creation?.event ?? null;
  const createSignature = creation?.signature ?? null;
  const createBlockTime = creation?.blockTime ?? null;
  const initialBuy = creation?.initialBuy ?? null;

  const deployer = create?.user ?? curve.creator;
  if (!deployer) throw new NotPumpTokenError("Could not determine who deployed this token.");

  // Without the creation tx, still show what the token is called; a failed lookup only costs the name.
  const meta = create ? null : await fetchTokenMetadata(chain, mint).catch(() => null);

  const info: TokenInfo = {
    mint,
    name: create?.name ?? meta?.name ?? null,
    symbol: create?.symbol ?? meta?.symbol ?? null,
    uri: create?.uri ?? meta?.uri ?? null,
    tokenProgram: create?.tokenProgram ?? meta?.tokenProgram ?? null,
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
