import type { TavilyResult } from "@/lib/search/tavily";
import type { Finding } from "@/lib/schema/guide";
import { randomId } from "@/lib/util/text";

/**
 * Shared context passed to every investigator agent. Agents read it but do
 * NOT mutate it; everything they produce comes back as Findings.
 */
export type AgentContext = {
  providerName: string;
  providerDomains: string[];
  useCase: string;
  /** Full normalized Tavily evidence set. Agents may consult but should prefer
   * their own targeted fetches when they need authoritative detail. */
  tavily: TavilyResult[];
};

/** Convenience helper: construct a Finding with a generated id + timestamp. */
export function makeFinding(partial: Omit<Finding, "id" | "at">): Finding {
  return { id: randomId("find"), at: new Date().toISOString(), ...partial };
}

/** Short excerpt helper used by multiple agents. */
export function excerpt(s: string, n = 400): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}
