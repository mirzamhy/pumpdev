import { Link } from "@tanstack/react-router";
import { shortAddress, type Crosslink } from "@pumpfun/shared";
import { Address, Card, Skeleton } from "./ui";

const roleText: Record<Crosslink["role"], string> = {
  deployer: "the dev",
  creator: "the creator",
  funder: "a funder",
  insider: "an insider",
};

export function CrosslinksList({ links, loading }: { links: Crosslink[] | null; loading: boolean }) {
  return (
    <Card title="Seen in other traces">
      {links === null ? (
        loading ? <Skeleton className="h-16" /> : <p className="text-sm text-muted">Could not load.</p>
      ) : links.length === 0 ? (
        <p className="text-sm text-muted">None of these wallets appear in other traced tokens yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {links.map((l) => (
            <li key={`${l.wallet}-${l.otherMint}-${l.role}`} className="flex flex-wrap items-center gap-x-2">
              <Address value={l.wallet} />
              <span className="text-muted">was {roleText[l.role]} in</span>
              <Link to="/token/$mint" params={{ mint: l.otherMint }} className="text-accent hover:underline">
                {l.otherSymbol ? `$${l.otherSymbol}` : shortAddress(l.otherMint)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
