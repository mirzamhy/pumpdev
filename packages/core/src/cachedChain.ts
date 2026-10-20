import type { ChainSource } from "./chain";
import type { Store } from "./store";

/** Finalized transactions never change, so they are cached forever. */
export function withTxCache(chain: ChainSource, store: Pick<Store, "getTx" | "putTx">): ChainSource {
  return {
    getSignatures: (a, o) => chain.getSignatures(a, o),
    getAccount: (a) => chain.getAccount(a),
    getAccounts: (a) => chain.getAccounts(a),
    getTokenHoldings: (o) => chain.getTokenHoldings(o),
    getMintHolders: (m, p) => chain.getMintHolders(m, p),
    getBlockTokenChanges: (s) => chain.getBlockTokenChanges(s),
    async getTransaction(signature) {
      const cached = store.getTx(signature);
      if (cached) return cached;
      const tx = await chain.getTransaction(signature);
      if (tx) store.putTx(signature, tx);
      return tx;
    },
  };
}
