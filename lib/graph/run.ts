import { StateGraph, START, END } from "@langchain/langgraph";
import { GraphState, MAX_LOOPS, type GraphStateType } from "@/lib/graph/state";
import type { Guide as GuideType } from "@/lib/schema/guide";
import { getGuideBySlug } from "@/lib/db/guides";
import { normalizeNode } from "@/lib/graph/nodes/normalize";
import { planNode } from "@/lib/graph/nodes/plan";
import { searchNode } from "@/lib/graph/nodes/search";
import { investigateNode } from "@/lib/graph/nodes/investigate";
import { synthesizeNode } from "@/lib/graph/nodes/synthesize";
import { critiqueNode } from "@/lib/graph/nodes/critique";
import { persistNode } from "@/lib/graph/nodes/persist";

/**
 * The OAuth research graph:
 *   normalize → plan → search → investigate → synthesize → critique
 *   critique → (done ? ground+persist : plan)   [re-plan loop]
 *
 * The critic loops up to MAX_LOOPS, re-planning targeted queries for its
 * missing fields, then re-searching and re-synthesizing.
 *
 * Grounding is folded into persistNode (it must run right before the final
 * Guide assembly / validation).
 */

function afterSearch(state: GraphStateType): "investigate" | typeof END {
  return state.error ? END : "investigate";
}

function afterInvestigate(state: GraphStateType): "synthesize" | typeof END {
  return state.error ? END : "synthesize";
}

function afterSynthesize(state: GraphStateType): "critic" | typeof END {
  return state.error ? END : "critic";
}

function afterCritique(state: GraphStateType): "plan" | "persist" | typeof END {
  if (state.error) return END;
  const done = (state.critique?.complete ?? true) || state.loopCount >= MAX_LOOPS;
  return done ? "persist" : "plan";
}

const compiled = new StateGraph(GraphState)
  .addNode("normalize", normalizeNode)
  .addNode("plan", planNode)
  .addNode("search", searchNode)
  .addNode("investigate", investigateNode)
  .addNode("synthesize", synthesizeNode)
  .addNode("critic", critiqueNode)
  .addNode("persist", persistNode)
  .addEdge(START, "normalize")
  .addEdge("normalize", "plan")
  .addEdge("plan", "search")
  .addConditionalEdges("search", afterSearch, ["investigate", END])
  .addConditionalEdges("investigate", afterInvestigate, ["synthesize", END])
  .addConditionalEdges("synthesize", afterSynthesize, ["critic", END])
  .addConditionalEdges("critic", afterCritique, ["plan", "persist", END])
  .addEdge("persist", END)
  .compile();

export type RunGraphResult =
  | { ok: true; guide: GuideType; warnings: string[] }
  | { ok: false; error: string; stage: string; searchErrors?: string[] };

export async function runGraph(
  input: { providerNameOrUrl: string; useCase?: string },
): Promise<RunGraphResult> {
  const final = await compiled.invoke(
    {
      providerNameOrUrl: input.providerNameOrUrl,
      useCase: input.useCase ?? "",
    },
    // The critic can loop; give the graph room. Node-level timeouts still apply.
    { recursionLimit: 50 },
  );

  if (final.error || !final.slug) {
    return {
      ok: false,
      error: final.error ?? "Guide generation did not complete.",
      stage: final.stage ?? "unknown",
      searchErrors: final.searchErrors,
    };
  }

  const guide = getGuideBySlug(final.slug);
  if (!guide) {
    return { ok: false, error: "Guide was persisted but could not be read back.", stage: "persist" };
  }
  return { ok: true, guide, warnings: final.warnings };
}
