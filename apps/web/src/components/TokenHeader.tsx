import { useState } from "react";
import { shortAddress, type TokenInfo } from "@pumpfun/shared";
import { Badge, CopyButton, Skeleton } from "./ui";

/** `image` comes from the server's socials step (already on a working gateway). */
export function TokenHeader({ token, mint, image }: { token: TokenInfo | null; mint: string; image: string | null }) {
  const [broken, setBroken] = useState(false);

  if (!token) {
    return (
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      {image && !broken ? (
        <img src={image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-14 rounded-xl object-cover" />
      ) : (
        <div className="grid size-14 place-items-center rounded-xl bg-surface-2 font-mono text-muted">{(token.symbol ?? "?").slice(0, 2)}</div>
      )}
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">
          {token.name ?? "Unknown token"} {token.symbol && <span className="text-muted">${token.symbol}</span>}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono">{shortAddress(mint)}</span>
          <CopyButton value={mint} />
          <CopyButton value={typeof window === "undefined" ? mint : window.location.href} label="Share" />
          <a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer" className="hover:text-text">
            pump.fun ↗
          </a>
          <a href={`https://solscan.io/token/${mint}`} target="_blank" rel="noreferrer" className="hover:text-text">
            Solscan ↗
          </a>
          {token.complete && <Badge tone="safe">Migrated</Badge>}
          {token.isMayhemMode && (
            <Badge tone="warn" title="pump.fun's AI agent trades this coin during its first 24 hours, so early volume is not purely organic.">
              Mayhem mode
            </Badge>
          )}
          {token.quoteMint && <Badge>Quote {shortAddress(token.quoteMint)}</Badge>}
          {token.creatorCurrent && token.creatorCurrent !== token.deployer && (
            <Badge tone="warn" title="The fee-receiving creator wallet is not the wallet that signed the launch (launched through a third-party tool, or creator rights moved later). Both wallets are traced.">
              Creator ≠ deployer
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
