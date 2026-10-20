/** Shapes match Solana JSON-RPC with `encoding: "jsonParsed"`. */

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  /** Present when the RPC node knows how to parse the program (System, SPL Token, ...). */
  parsed?: { type: string; info: Record<string, any> };
  /** Present for programs the node cannot parse (pump.fun). `data` is base58. */
  accounts?: string[];
  data?: string;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown | null;
    preBalances: number[];
    postBalances: number[];
    preTokenBalances: TokenBalance[];
    postTokenBalances: TokenBalance[];
    innerInstructions: { index: number; instructions: ParsedInstruction[] }[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
}

export interface AccountData {
  address: string;
  owner: string;
  data: Uint8Array;
}

export interface TokenHolding {
  mint: string;
  /** Raw amount summed across all token accounts of this mint. */
  amount: string;
}

export interface ChainSource {
  /** Newest first. */
  getSignatures(address: string, opts: { before?: string; limit: number }): Promise<SignatureInfo[]>;
  getTransaction(signature: string): Promise<ParsedTx | null>;
  getAccount(address: string): Promise<AccountData | null>;
  getAccounts(addresses: string[]): Promise<(AccountData | null)[]>;
  /** Balances across both SPL Token and Token-2022 programs. */
  getTokenHoldings(owner: string): Promise<TokenHolding[]>;
}
