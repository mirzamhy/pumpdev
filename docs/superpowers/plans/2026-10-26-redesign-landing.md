# Redesign and Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Purple theme for the whole site and a new home page that explains pumpfun.dev with real data.

**Architecture:** Colour tokens in `index.css` drive every page. The home page is composed of one component per section under `components/home/`. The worked example comes from `/api/recent` + `/api/token/:mint` through a pure picker in `lib/example.ts`.

**Tech Stack:** React 19, Tailwind v4 `@theme` tokens, TanStack Router/Query, Vitest, Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-26-redesign-landing-design.md`.
- No "DEMO DATA" badges, no `0x` addresses, no data we cannot compute.
- Text contrast WCAG AA. Measured: accent `#8f74ff` on surface 5.63; white on `#6a48f5` 5.44; muted `#9d97ba` on surface 6.97.
- Decorative graphics `aria-hidden`; animation off under `prefers-reduced-motion`.
- Layout fits 375 px with no horizontal scroll.
- Commits carry no Claude attribution trailers.

---

### Task 1: Theme tokens, buttons, header and footer

**Files:** Modify `apps/web/src/index.css`, `components/Layout.tsx`, `components/SearchBox.tsx`, `pages/TokenPage.tsx`.

- [ ] Replace the `@theme` block: bg `#07060f`, surface `#0e0c1a`, surface-2 `#16132a`, line `#262043`, text `#ece9f7`, muted `#9d97ba`, accent `#8f74ff`, accent-strong `#6a48f5`, accent-soft `#b9a4ff`; safe/warn/danger unchanged. Add `.text-gradient` (white to accent-soft, `background-clip: text`) and a `prefers-reduced-motion` rule that stops `.spin-slow`.
- [ ] Buttons: `bg-accent ... text-bg` becomes `bg-accent-strong ... text-white` (SearchBox submit, TokenPage "New search").
- [ ] Layout header: logo `pumpfun` + `.dev` in accent; nav How it works (`/#how`, hidden below `sm`), Screener, Risky wallets; button "Trace a token" linking to `/#trace`. Footer: logo, disclaimer, "Independent research tool. Not affiliated with pump.fun."
- [ ] `pnpm --filter @pumpfun/web typecheck`, then commit `feat(web): purple theme, header and footer`.

### Task 2: Search box takes wallets too

**Files:** Modify `components/SearchBox.tsx`, `pages/TokenPage.tsx`.

- [ ] SearchBox: label "Token or wallet address", placeholder "Paste a token or dev wallet address", error "That doesn't look like a Solana address.", optional `id` prop (default `ca`) so the home page can focus it.
- [ ] TokenPage error view: when `view.error` contains "not a pump.fun token", show a primary link "Open as a wallet" to `/wallet/$address` with `address = mint`.
- [ ] Typecheck, commit `feat(web): open wallets pasted into the search box`.

### Task 3: Example picker (TDD)

**Files:** Create `apps/web/src/lib/example.ts`, `apps/web/src/lib/example.test.ts`.

```ts
// example.ts
import type { RecentTrace, TraceResult } from "@pumpfun/shared";

export interface ExampleSteps {
  mint: string;
  symbol: string | null;
  score: number;
  funder: string | null;
  deployer: string;
  linked: string[];
  launches: { mint: string; symbol: string | null; status: string }[];
}

/** Newest trace scored high; recent traces arrive newest first. */
export function pickExampleMint(recent: RecentTrace[]): string | null {
  return recent.find((r) => r.score >= 60)?.mint ?? null;
}

export function exampleSteps(r: TraceResult): ExampleSteps {
  const deployer = r.token.deployer;
  const funders = r.nodes.filter((n) => n.role === "funder").sort((a, b) => a.depth - b.depth);
  const linkedFromCrosslinks = r.crosslinks.map((c) => c.wallet).filter((w) => w !== deployer);
  const linked = [...new Set([...linkedFromCrosslinks, ...funders.slice(1).map((n) => n.address)])].slice(0, 3);
  return {
    mint: r.token.mint,
    symbol: r.token.symbol,
    score: r.score.score,
    funder: funders[0]?.address ?? null,
    deployer,
    linked,
    launches: r.devHistory.slice(0, 3).map((t) => ({ mint: t.mint, symbol: t.symbol, status: t.status })),
  };
}
```

- [ ] Tests: picker returns the first entry with score ≥ 60 and null when none; `exampleSteps` takes the depth-1 funder, prefers crosslinks for linked wallets, dedupes, caps at three, excludes the deployer, caps launches at three.
- [ ] `pnpm --filter @pumpfun/web test` passes; commit `feat(web): pick a real traced token as the home page example`.

### Task 4: Home page sections

**Files:** Create `components/NetworkSphere.tsx`, `components/home/HowItWorks.tsx`, `components/home/Patterns.tsx`, `components/home/Archetypes.tsx`, `components/home/LiveNow.tsx`; rewrite `pages/HomePage.tsx`.

- [ ] NetworkSphere: seeded pseudo-random points on a sphere projected to 2D, links between near points, a few accent/danger/warn nodes, glow via SVG radial gradient, wrapper `spin-slow` rotates slowly, `aria-hidden`.
- [ ] HowItWorks (`id="how"`): four steps (Funding source, Deployer, Linked wallets, Launches) with descriptions; when an `ExampleSteps` exists, each step shows its addresses as wallet links and launches with a status dot; caption names the example token and its score with a link to its token page.
- [ ] Patterns: heading "Every launch leaves a pattern." and five checks.
- [ ] Archetypes: Runner / Recycler / Rugger cards with signals, sparkline SVG per tone, note "Patterns are signals, not verdicts."
- [ ] LiveNow: `/api/feed?limit=5` every 10 s (quick score `~N` or full score) and the first five of `/api/recent`; link to the screener.
- [ ] HomePage: hero (`id="trace"`) with gradient headline, subtitle, SearchBox, sphere; then sections; closing call to action with a button that focuses the search box.
- [ ] Typecheck and build; commit `feat(web): new landing page`.

### Task 5: Tests and visual check

**Files:** Create `apps/web/e2e/home.spec.ts`; update fixtures if needed.

- [ ] e2e: search navigates to the token page; example steps show fixture addresses; with no high-score trace the steps show no addresses; 375 px has no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] Run e2e when the Playwright browser is available (needs the user's go-ahead to reinstall).
- [ ] Preview screenshots: home desktop + phone, screener, token page.
- [ ] Commit `test(web): landing page`.
