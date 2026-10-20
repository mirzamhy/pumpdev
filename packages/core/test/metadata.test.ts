import { describe, expect, it } from "vitest";
import { METAPLEX_METADATA_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../src/pump/constants";
import { decodeMetaplexMetadata, decodeMintSupply, decodeToken2022Metadata, fetchTokenMetadata, metaplexMetadataPda } from "../src/pump/metadata";
import { FakeChain, addr, encodeMetaplexMetadata, encodeSplMint, encodeToken2022Mint } from "../src/testing";

const MINT = addr(20);
const meta = { name: "Befreit die Katze", symbol: "Katze", uri: "https://meta.example/k.json" };

describe("decodeToken2022Metadata", () => {
  it("reads the TokenMetadata extension", () => {
    expect(decodeToken2022Metadata(encodeToken2022Mint(meta, MINT))).toEqual(meta);
  });

  it("returns null for a mint without extensions", () => {
    expect(decodeToken2022Metadata(new Uint8Array(82))).toBeNull();
  });
});

describe("decodeMetaplexMetadata", () => {
  it("strips null padding and spaces", () => {
    expect(decodeMetaplexMetadata(encodeMetaplexMetadata({ name: "Fartcoin ", symbol: "Fartcoin ", uri: "https://ipfs.io/ipfs/Qm" }, MINT))).toEqual({
      name: "Fartcoin",
      symbol: "Fartcoin",
      uri: "https://ipfs.io/ipfs/Qm",
    });
  });

  it("returns null for truncated data", () => {
    expect(decodeMetaplexMetadata(new Uint8Array(40))).toBeNull();
  });
});

describe("fetchTokenMetadata", () => {
  it("uses the Token-2022 extension when the mint has one", async () => {
    const chain = new FakeChain();
    chain.accounts.set(MINT, { address: MINT, owner: TOKEN_2022_PROGRAM_ID, data: encodeToken2022Mint(meta, MINT) });
    expect(await fetchTokenMetadata(chain, MINT)).toEqual({ ...meta, tokenProgram: TOKEN_2022_PROGRAM_ID });
  });

  it("falls back to the Metaplex account for SPL Token mints", async () => {
    const chain = new FakeChain();
    chain.accounts.set(MINT, { address: MINT, owner: TOKEN_PROGRAM_ID, data: new Uint8Array(82) });
    const pda = await metaplexMetadataPda(MINT);
    chain.accounts.set(pda, { address: pda, owner: METAPLEX_METADATA_PROGRAM_ID, data: encodeMetaplexMetadata(meta, MINT) });
    expect(await fetchTokenMetadata(chain, MINT)).toEqual({ ...meta, tokenProgram: TOKEN_PROGRAM_ID });
  });

  it("returns null when nothing is found", async () => {
    expect(await fetchTokenMetadata(new FakeChain(), MINT)).toBeNull();
  });
});

describe("decodeMintSupply", () => {
  it("reads supply from SPL and Token-2022 mints", () => {
    expect(decodeMintSupply(encodeSplMint(1_000_000_000_000_000n))).toBe(1_000_000_000_000_000n);
    expect(decodeMintSupply(encodeToken2022Mint(meta, MINT, 42n))).toBe(42n);
  });

  it("still finds Token-2022 metadata when supply is set", () => {
    expect(decodeToken2022Metadata(encodeToken2022Mint(meta, MINT, 42n))).toEqual(meta);
  });
});
