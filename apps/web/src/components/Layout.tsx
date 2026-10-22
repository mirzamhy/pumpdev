import { Link, Outlet } from "@tanstack/react-router";

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="font-mono font-semibold text-accent">
            pumpfun.dev
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/screener" className="text-muted hover:text-text [&.active]:text-text">
              Screener
            </Link>
            <Link to="/risky" className="text-muted hover:text-text [&.active]:text-text">
              Risky wallets
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted">
          Heuristic on-chain analysis. Not financial advice. Data from public Solana RPC.
        </div>
      </footer>
    </div>
  );
}
