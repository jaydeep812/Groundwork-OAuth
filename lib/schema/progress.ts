import { z } from "zod";
import { ProgressStatus } from "@/lib/schema/guide";

/**
 * Per-guide progress. Keyed by stable step id (never array index).
 * Stored locally in the browser (localStorage) in this milestone — NOT shared
 * across devices. The UI must state this honestly.
 */
export const GuideProgress = z.object({
  guideId: z.string().min(1),
  /** Map of stepId -> status. Steps absent from the map use their default. */
  steps: z.record(z.string(), ProgressStatus),
  updatedAt: z.string(),
});
export type GuideProgress = z.infer<typeof GuideProgress>;

export function emptyProgress(guideId: string): GuideProgress {
  return { guideId, steps: {}, updatedAt: new Date().toISOString() };
}
