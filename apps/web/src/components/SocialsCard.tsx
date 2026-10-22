import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { shortAddress, type SocialReuse, type TokenSocials } from "@pumpfun/shared";
import { relTime } from "../lib/format";
import { Card, Skeleton } from "./ui";

/** Metadata is written by the token creator; only plain web links are ever rendered as links. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeHref(url);
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="break-all hover:text-accent">
      {children}
    </a>
  );
}

const reuseLabel: Record<SocialReuse["kind"], string> = {
  twitter: "Same X account as",
  website: "Same website as",
  image: "Same image as",
};

function twitterText(t: NonNullable<TokenSocials["twitter"]>): { title: string; note: string } {
  if (t.kind === "account") return { title: `@${t.handle}`, note: "Project account" };
  if (t.kind === "tweet") return { title: `Tweet by @${t.handle}`, note: "Links to a single post, not a project account" };
  if (t.kind === "community") return { title: "X community", note: "Community page" };
  return { title: "X link", note: "" };
}

export function SocialsCard({ socials, loading }: { socials: TokenSocials | null; loading: boolean }) {
  if (!socials) {
    return <Card title="Socials">{loading ? <Skeleton className="h-20" /> : <p className="text-sm text-muted">Socials were not checked for this trace.</p>}</Card>;
  }
  if (!socials.available) {
    return (
      <Card title="Socials">
        <p className="text-sm text-muted">
          {socials.reason === "no_uri" ? "This token has no metadata link." : "The token's metadata could not be loaded (its host is down or blocked)."}
        </p>
      </Card>
    );
  }
  const { twitter, telegram, website } = socials;
  const none = !twitter && !telegram && !website;
  return (
    <Card title="Socials">
      {socials.reuse.length > 0 && (
        <div className="mb-3 space-y-2 rounded-lg border border-warn/40 p-3 text-sm">
          {socials.reuse.map((r) => (
            <p key={r.kind}>
              <span className="text-warn">{reuseLabel[r.kind]}</span>{" "}
              {r.tokens.map((t, i) => (
                <span key={t.mint}>
                  {i > 0 && ", "}
                  <Link to="/token/$mint" params={{ mint: t.mint }} className="hover:text-accent">
                    {t.symbol ? `$${t.symbol}` : shortAddress(t.mint)}
                  </Link>{" "}
                  <span className="text-muted">({relTime(t.createdAt)})</span>
                </span>
              ))}
            </p>
          ))}
        </div>
      )}
      {none ? (
        <p className="text-sm text-muted">No socials listed. Plenty of launches have none, but it leaves nothing to check.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          {twitter && (
            <div>
              <dt className="text-xs text-muted">X</dt>
              <dd>
                <ExternalLink url={twitter.url}>{twitterText(twitter).title}</ExternalLink>
                {twitterText(twitter).note && <span className="ml-2 text-xs text-muted">{twitterText(twitter).note}</span>}
              </dd>
            </div>
          )}
          {telegram && (
            <div>
              <dt className="text-xs text-muted">Telegram</dt>
              <dd>
                <ExternalLink url={telegram}>{telegram.replace(/^https?:\/\//, "")}</ExternalLink>
              </dd>
            </div>
          )}
          {website && (
            <div>
              <dt className="text-xs text-muted">Website</dt>
              <dd>
                <ExternalLink url={website}>{website.replace(/^https?:\/\//, "")}</ExternalLink>
              </dd>
            </div>
          )}
        </dl>
      )}
      {socials.sameTweetCount > 0 && (
        <p className="mt-3 text-xs text-muted">
          {socials.sameTweetCount} other token{socials.sameTweetCount === 1 ? "" : "s"} link the same tweet.
        </p>
      )}
      {socials.description && <p className="mt-3 line-clamp-3 text-xs text-muted">{socials.description}</p>}
    </Card>
  );
}
