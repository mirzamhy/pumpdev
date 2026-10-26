import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TraceRequest } from "@pumpfun/shared";

export function SearchBox({ autoFocus = false, id = "ca" }: { autoFocus?: boolean; id?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(raw: string) {
    const parsed = TraceRequest.safeParse({ mint: raw });
    if (!parsed.success) {
      setError("That doesn't look like a Solana address.");
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
      <label htmlFor={id} className="sr-only">
        Token or wallet address
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            e.preventDefault();
            setValue(text);
            submit(text);
          }}
          placeholder="Paste a token or dev wallet address"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-sm placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-accent-strong px-5 py-3 text-sm font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Trace
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
