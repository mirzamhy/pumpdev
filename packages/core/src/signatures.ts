import type { ChainSource, SignatureInfo } from "./chain";

/** Walks history backwards. `complete` is false when `maxPages` ran out before the oldest signature. */
export async function collectSignatures(
  chain: ChainSource,
  address: string,
  maxPages: number,
  pageSize: number,
): Promise<{ sigs: SignatureInfo[]; complete: boolean }> {
  const sigs: SignatureInfo[] = [];
  let before: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const batch = await chain.getSignatures(address, { before, limit: pageSize });
    sigs.push(...batch);
    if (batch.length < pageSize) return { sigs, complete: true };
    before = batch[batch.length - 1]!.signature;
  }
  return { sigs, complete: false };
}
