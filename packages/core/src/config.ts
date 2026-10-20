export interface TraceConfig {
  /** Signatures per getSignaturesForAddress page (RPC max 1000). */
  pageSize: number;
  /** Pages to walk back on the bonding curve account to find the creation tx. */
  curveMaxPages: number;
  /** Pages to walk back on a wallet before calling it high-activity. */
  walletMaxPages: number;
  /** Oldest transactions inspected when looking for a wallet's first SOL funding. */
  oldestTxScan: number;
  maxHops: number;
  /** Most recent dev transactions inspected for history and sell/transfer activity. */
  devTxScan: number;
}

export const DEFAULT_CONFIG: TraceConfig = {
  pageSize: 1000,
  curveMaxPages: 40,
  walletMaxPages: 5,
  oldestTxScan: 10,
  maxHops: 5,
  devTxScan: 60,
};
