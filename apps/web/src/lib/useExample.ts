import { useQueries, useQuery } from "@tanstack/react-query";
import type { TraceResult } from "@pumpfun/shared";
import { fetchRecent, fetchToken } from "./api";
import { chooseExample, exampleCandidates, exampleSteps, type ExampleSteps } from "./example";

/** A recent high-score trace, shared by the home page sections that show a real example. */
export function useExample(): { result: TraceResult; steps: ExampleSteps } | null {
  const recent = useQuery({ queryKey: ["recent"], queryFn: fetchRecent });
  const mints = recent.data ? exampleCandidates(recent.data) : [];
  const tokens = useQueries({
    queries: mints.map((mint) => ({ queryKey: ["token", mint], queryFn: () => fetchToken(mint), staleTime: 5 * 60_000 })),
  });
  // Wait for every candidate so the choice does not flip while they load.
  if (tokens.some((t) => t.isPending)) return null;
  const result = chooseExample(tokens.map((t) => t.data));
  return result ? { result, steps: exampleSteps(result) } : null;
}
