# Redesign: purple theme and landing page

Date: 2026-10-26. Source: the user's two mockups (landing page and developer cluster view). This spec covers only the theme and the home page. The developer cluster page, outflow tracing and community features are later, separate projects.

## Goals

- The whole site takes the mockup's look: near-black indigo background, purple accent, gradient headlines, glowing network graphics.
- The home page explains what pumpfun.dev does and lets a visitor trace something without an extra click.
- Everything shown is real data or clearly worded as an example. No "DEMO DATA" badges, no Ethereum-style `0x` addresses, nothing we cannot compute (CEX deposits, mixers, bridges).

## Theme

Colour tokens in `apps/web/src/index.css` change; component class names stay, so every page follows.

| Token | Value |
|---|---|
| bg | `#07060f` |
| surface | `#0e0c1a` |
| surface-2 | `#16132a` |
| line | `#262043` |
| text | `#ece9f7` |
| muted | `#9d97ba` |
| accent | `#7c5cff` |
| accent-soft (new) | `#b9a4ff` (gradient end, links on dark) |
| safe / warn / danger | unchanged (`#3ddc84`, `#f5c542`, `#ff6b6b`) |

Buttons use the accent background with white text (the old mint accent used dark text). Every place that renders `bg-accent ... text-bg` switches to `text-white`. Text contrast must reach WCAG AA on bg and surface.

## Header and footer

- Logo: `pumpfun` in text colour, `.dev` in accent.
- Nav: How it works (anchor to the home section), Screener, Risky wallets.
- Primary button "Trace a token": on the home page it focuses the hero search box; elsewhere it links to `/#trace`.
- Footer: logo, the existing disclaimer, "Independent research tool. Not affiliated with pump.fun."
- On phones the nav collapses to Screener and Risky wallets plus the button; How it works hides.

## Search box

Accepts a token mint or a wallet address. Both are base58 Solana addresses, so the box cannot tell them apart by format. Submitting always goes to `/token/$mint`; the token page already fails with "not a pump.fun token" for wallets. New: when the trace start returns that error for a valid address, the token page offers "Open as a wallet" linking to `/wallet/$address`. Placeholder: "Paste a token or dev wallet address".

## Home page sections

1. **Hero** (`id="trace"`). Headline "Know the dev before the next launch." with the second line in the accent gradient. Subtitle: what we map (funders, launch history, recurring behaviour). Search box. A decorative network sphere (inline SVG, generated nodes and links, slow rotation by CSS) beside the text on desktop and behind it at low opacity on phones. Animation stops under `prefers-reduced-motion`. `aria-hidden`.
2. **How it works** (`id="how"`). Four steps in a row (stacked on phones): Funding source, Deployer, Linked wallets, Launches, joined by glowing connectors. Filled from a real example: the newest traced result with score ≥ 60 among `/api/recent`, fetched with `/api/token/:mint`. Shows the funder address, deployer address, up to three linked wallets (crosslinks, else other funding chain nodes) and up to three of the deployer's launches with status. Each address links to its wallet page. If nothing qualifies, the steps show plain descriptions only, no fake values.
3. **Every launch leaves a pattern.** Short paragraph plus five checks: funding links, launch history, timing (how fast the dev sells), metadata reuse, holders and bundles.
4. **Runner, recycler or rugger?** Three cards, each with what it looks like and the signals behind it, and the note "Patterns are signals, not verdicts."
   - Runner: launches that migrate, dev holds, longer activity.
   - Recycler: reused socials or images, reused funders, many launches a day.
   - Rugger: dev sells within minutes, dead launches with the dev exiting, bundles holding supply.
   A small decorative sparkline per card in the card's tone (accent, warn, danger).
5. **Live now.** The five newest feed tokens with their quick or full score (`/api/feed?limit=5`, refreshed every 10 s) beside "Recently traced" (`/api/recent`, first five). Link to the screener.
6. **Closing call to action.** "Trace the wallet before you trust the launch." with a button that focuses the search box.

## Components

- `components/NetworkSphere.tsx`: decorative SVG; deterministic node layout (seeded), no data.
- `components/home/HowItWorks.tsx`, `components/home/Archetypes.tsx`, `components/home/LiveNow.tsx`: one section each.
- `pages/HomePage.tsx`: composes the sections.
- `components/Layout.tsx`: new header and footer.

## Testing

- Unit: the example picker (chooses the newest high score, falls back to none).
- e2e (`e2e/home.spec.ts`): hero search navigates; example steps render real fixture addresses; empty state shows no addresses; layout fits 375 px without horizontal scroll. Existing specs updated for changed text.
- Manual: screenshots of home, screener and token pages at desktop and phone widths.

Running e2e needs the Playwright browser, which was removed from this machine; reinstalling it needs the user's go-ahead.
