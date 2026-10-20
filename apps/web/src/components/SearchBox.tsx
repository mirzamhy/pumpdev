import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TraceRequest } from "@pumpfun/shared";

export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(raw: string) {
    const parsed = TraceRequest.safeParse({ mint: raw });
    if (!parsed.success) {
      setError("That doesn't look like a Solana token address.");
      return;
    }
    setError(null);
    void navigate({ to: "/token/$mint", params: { mint: parsed.data.mint } });
  }

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <label htmlFor="ca" className="sr-only">
        Token contract address
      </label>
      <div className="flex gap-2">
        <input
          id="ca"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            e.preventDefault();
            setValue(text);
            submit(text);
          }}
          placeholder="Paste a pump.fun token address"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "ca-error" : undefined}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Trace
        </button>
      </div>
      {error && (
        <p id="ca-error" role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
