import { Link } from "@tanstack/react-router";
import { SearchBox } from "../components/SearchBox";

export function NotFoundPage() {
  return (
    <section className="mx-auto max-w-xl py-16 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
        This page <span className="text-gradient">rugged.</span>
      </h1>
      <p className="mt-3 text-muted">Nothing lives at this address. Paste a token or wallet to trace it, or head back to the live screener.</p>
      <div className="mt-8 text-left">
        <SearchBox />
      </div>
      <div className="mt-6 flex justify-center gap-3 text-sm">
        <Link to="/" className="rounded-lg border border-line px-4 py-2 hover:border-accent hover:text-text">
          Home
        </Link>
        <Link to="/screener" className="rounded-lg bg-accent-strong px-4 py-2 font-semibold text-white hover:brightness-110">
          Live screener
        </Link>
      </div>
    </section>
  );
}
