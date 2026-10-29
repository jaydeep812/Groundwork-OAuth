import type { GraphStateType } from "@/lib/graph/state";
import { normalizeInput } from "@/lib/research/helpers";

/** Normalize the raw provider input into name + https URL. */
export function normalizeNode(state: GraphStateType): Partial<GraphStateType> {
  const norm = normalizeInput(state.providerNameOrUrl);
  if (!norm) {
    return { error: "A provider name or website is required.", stage: "validate" };
  }
  return {
    providerName: norm.providerName,
    providerUrl: norm.providerUrl,
    providerUrlFromInput: norm.providerUrlFromInput,
  };
}
