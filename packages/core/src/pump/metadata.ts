import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { ChainSource } from "../chain";
import { Reader } from "./borsh";
import { METAPLEX_METADATA_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "./constants";

export interface TokenMetadata {
  name: string;
  symbol: string;
  uri: string;
}

const ACCOUNT_TYPE_OFFSET = 165;
const MINT_SUPPLY_OFFSET = 36; // after mint_authority: COption<Pubkey> (4 + 32)
const ACCOUNT_TYPE_MINT = 1;
const EXT_TOKEN_METADATA = 19;

/** Metaplex pads strings with NULs to a fixed width; some creators also add trailing spaces. */
const clean = (s: string) => s.replace(/\0/g, "").trim();

function readNameSymbolUri(r: Reader): TokenMetadata {
  return { name: clean(r.string()), symbol: clean(r.string()), uri: clean(r.string()) };
}

/** Total supply (raw units) from an SPL Token or Token-2022 mint account. */
export function decodeMintSupply(data: Uint8Array): bigint {
  if (data.length < MINT_SUPPLY_OFFSET + 8) throw new RangeError("mint: account too short");
  return new DataView(data.buffer, data.byteOffset, data.length).getBigUint64(MINT_SUPPLY_OFFSET, true);
}

/** Reads the TokenMetadata extension (type 19) from a Token-2022 mint account. */
export function decodeToken2022Metadata(data: Uint8Array): TokenMetadata | null {
  if (data.length <= ACCOUNT_TYPE_OFFSET || data[ACCOUNT_TYPE_OFFSET] !== ACCOUNT_TYPE_MINT) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.length);
  let offset = ACCOUNT_TYPE_OFFSET + 1;
  while (offset + 4 <= data.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const start = offset + 4;
    if (type === 0 && length === 0) return null;
    if (type === EXT_TOKEN_METADATA) {
      try {
        const r = new Reader(data.subarray(start, start + length));
        r.skip(32 + 32); // update_authority, mint
        return readNameSymbolUri(r);
      } catch {
        return null;
      }
    }
    offset = start + length;
  }
  return null;
}

/** Reads name/symbol/uri from a Metaplex metadata account (key, update_authority, mint, ...). */
export function decodeMetaplexMetadata(data: Uint8Array): TokenMetadata | null {
  try {
    const r = new Reader(data);
    r.skip(1 + 32 + 32);
    return readNameSymbolUri(r);
  } catch {
    return null;
  }
}

export async function metaplexMetadataPda(mint: string): Promise<string> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(METAPLEX_METADATA_PROGRAM_ID),
    seeds: ["metadata", enc.encode(address(METAPLEX_METADATA_PROGRAM_ID)), enc.encode(address(mint))],
  });
  return pda;
}

/**
 * Name, symbol and uri straight from chain, for when the creation tx is out of reach.
 * create_v2 mints (Token-2022) embed metadata in the mint; legacy mints use a Metaplex account.
 */
export async function fetchTokenMetadata(chain: ChainSource, mint: string): Promise<(TokenMetadata & { tokenProgram: string }) | null> {
  const mintAccount = await chain.getAccount(mint);
  if (!mintAccount) return null;
  if (mintAccount.owner === TOKEN_2022_PROGRAM_ID) {
    const meta = decodeToken2022Metadata(mintAccount.data);
    if (meta) return { ...meta, tokenProgram: mintAccount.owner };
  }
  const metaplex = await chain.getAccount(await metaplexMetadataPda(mint));
  const meta = metaplex?.owner === METAPLEX_METADATA_PROGRAM_ID ? decodeMetaplexMetadata(metaplex.data) : null;
  return meta ? { ...meta, tokenProgram: mintAccount.owner } : null;
}
