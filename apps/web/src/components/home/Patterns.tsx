const CHECKS = [
  { title: "Funding links", text: "Which wallet paid for the dev, and whether that funder backed launches that died." },
  { title: "Launch history", text: "Every earlier token from the same dev and how it ended." },
  { title: "Timing", text: "How many minutes the dev usually waits before selling." },
  { title: "Metadata reuse", text: "X accounts, websites and images recycled from older tokens." },
  { title: "Holders and bundles", text: "Supply held by wallets that bought in the launch block or look like one owner." },
];

export function Patterns() {
  return (
    <section aria-labelledby="patterns-title" className="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center">
      <div>
        <h2 id="patterns-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Every launch leaves <span className="text-gradient">a pattern.</span>
        </h2>
        <p className="mt-4 max-w-md text-muted">
          Wallets don't act alone. Reused funders, deployer wallets, timing and recycled metadata form patterns you can check before you buy.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {CHECKS.map((c) => (
          <li key={c.title} className="rounded-2xl border border-line bg-surface/80 p-4">
            <h3 className="flex items-center gap-2 font-semibold">
              <span aria-hidden className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
              {c.title}
            </h3>
            <p className="mt-1 text-sm text-muted">{c.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
