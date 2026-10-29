import type { GraphStateType } from "@/lib/graph/state";
import type { Finding } from "@/lib/schema/guide";
import { reclassifyResults } from "@/lib/search/tavily";
import type { AgentContext } from "@/lib/investigation/agents/_shared";
import { docsAgent } from "@/lib/investigation/agents/docs-agent";
import { portalAgent } from "@/lib/investigation/agents/portal-agent";
import { catalogAgent } from "@/lib/investigation/agents/catalog-agent";
import { authEndpointAgent } from "@/lib/investigation/agents/auth-endpoint-agent";
import { constraintsAgent } from "@/lib/investigation/agents/constraints-agent";

const AGENT_NAMES = [
  "docs-agent",
  "portal-agent",
  "catalog-agent",
  "auth-endpoint-agent",
  "constraints-agent",
];

/**
 * Deep-mode fan-out. Runs the five investigator agents in parallel against the
 * reclassified evidence and appends their Findings. Only runs on loop 0 — the
 * agents are expensive (direct HTTP probes) and the re-plan loops are about
 * targeted re-search, not re-running every agent.
 */
export async function investigateNode(state: GraphStateType): Promise<Partial<GraphStateType>> {
  if (state.error) return {};
  if (state.loopCount > 0) return {}; // agents run once

  const evidence = reclassifyResults(state.evidence, state.providerDomains, state.providerName);
  const ctx: AgentContext = {
    providerName: state.providerName,
    providerDomains: state.providerDomains,
    useCase: state.useCase,
    tavily: evidence,
  };

  const settled = await Promise.allSettled([
    docsAgent(ctx),
    portalAgent(ctx),
    catalogAgent(ctx),
    authEndpointAgent(ctx),
    constraintsAgent(ctx),
  ]);

  const findings: Finding[] = [];
  const warnings: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      findings.push(...r.value);
    } else {
      warnings.push(`${AGENT_NAMES[i]} crashed: ${r.reason?.message ?? String(r.reason)}`);
    }
  });

  if (findings.length === 0) {
    return {
      error: "All investigator agents failed to produce findings.",
      stage: "agents",
      warnings,
    };
  }

  return { findings, warnings };
}
