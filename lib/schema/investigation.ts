import { z } from "zod";

/** Validated shape of the investigation intake form. */
export const InvestigationRequest = z.object({
  providerNameOrUrl: z.string().trim().min(1, "Enter a provider name or website.").max(200),
  useCase: z.string().trim().max(1000).optional().default(""),
  audience: z.enum(["internal-testing", "external-users", "unknown"]).default("unknown"),
  hasOAuthApp: z.boolean().nullable().default(null),
  currentStage: z.string().trim().max(200).nullable().default(null),
});
export type InvestigationRequest = z.infer<typeof InvestigationRequest>;
