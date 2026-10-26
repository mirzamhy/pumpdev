import { Link, Outlet } from "@tanstack/react-router";

export function Logo() {
  return (
    <span className="text-lg font-semibold tracking-tight">
      pumpfun<span className="text-accent">.dev</span>
    </span>
  );
}

const navLink = "text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent [&.active]:text-text";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line/60 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" aria-label="pumpfun.dev home" className="focus-visible:outline-2 focus-visible:outline-accent">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm sm:gap-6">
            <a href="/#how" className={`hidden sm:inline ${navLink}`}>
              How it works
            </a>
            <Link to="/screener" className={navLink}>
              Screener
            </Link>
            <Link to="/risky" className={navLink}>
              <span className="sm:hidden">Risky</span>
              <span className="hidden sm:inline">Risky wallets</span>
            </Link>
            <a
              href="/#trace"
              className="hidden rounded-full bg-accent-strong px-4 py-2 font-semibold text-white shadow-[0_0_24px_-6px_var(--color-accent-strong)] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-block"
            >
              Trace a token
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <Logo />
          <p>Heuristic on-chain analysis from public Solana RPC. Not financial advice. Independent research tool, not affiliated with pump.fun.</p>
        </div>
      </footer>
    </div>
  );
}
