import type { TokenInfo, TokenSocials } from "@pumpfun/shared";
import type { MetadataSource } from "../chain";
import { displayImageUrl, otherMintInImage, parseMetadata } from "../pump/socials";
import type { Store, TokenMetaRecord } from "../store";

const empty = (reason: TokenSocials["reason"]): TokenSocials => ({
  available: false,
  reason,
  twitter: null,
  telegram: null,
  website: null,
  image: null,
  description: null,
  reuse: [],
  imageFromMint: null,
  sameTweetCount: 0,
});

/**
 * Socials from the token's metadata JSON. The live feed usually stored it already; otherwise it is
 * fetched now (and a failed earlier fetch is retried once per trace).
 */
export async function analyzeSocials(token: TokenInfo, store: Store, metadata: MetadataSource | undefined, now: number): Promise<TokenSocials> {
  if (!token.uri) return empty("no_uri");
  let record = store.getTokenMeta(token.mint);
  if ((!record || !record.ok) && metadata) {
    const json = await metadata.fetch(token.uri);
    record = {
      mint: token.mint,
      createdAt: record?.createdAt ?? token.createdAt ?? now,
      fetchedAt: now,
      ok: json !== null,
      ...parseMetadata(json),
    } satisfies TokenMetaRecord;
    store.putTokenMeta(record);
  }
  if (!record?.ok) return empty("fetch_failed");

  const { reuse, sameTweetCount } = store.findSocialReuse(token.mint, record.createdAt, {
    twitterHandle: record.twitter?.kind === "account" ? record.twitter.handle : null,
    websiteKey: record.websiteKey,
    imageKey: record.imageKey,
    tweetId: record.twitter?.tweetId ?? null,
  });
  return {
    available: true,
    reason: null,
    twitter: record.twitter,
    telegram: record.telegram,
    website: record.website,
    image: displayImageUrl(record.image),
    description: record.description,
    reuse,
    imageFromMint: otherMintInImage(record.image, token.mint),
    sameTweetCount,
  };
}
