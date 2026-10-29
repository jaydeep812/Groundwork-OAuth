import type {
  ClaimKind,
  DifficultyRating,
  Estimate,
  EvidenceRef,
  GuideStatus,
  RecommendedPath,
  SetupStepCategory,
} from "@/lib/schema/guide";
import { sourceTypeLabel, type SourceType } from "@/lib/search/classify";

type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue" | "violet" | "slate";

// Lab-paper dossier: quiet tinted chips with a hairline border. Semantic colors
// carry meaning (green = verified/grounded, amber = open, rust = alert); the
// rest stay near-ink on paper so the interface reads calm and legible.
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-[color:var(--paper-raised)] text-[color:var(--slate)] border-[color:var(--rule)]",
  green: "bg-[color:var(--verified-soft)] text-[color:var(--verified)] border-[#cfe3d6]",
  amber: "bg-[color:var(--open-soft)] text-[color:var(--open)] border-[#e8dab4]",
  red: "bg-[color:var(--alert-soft)] text-[color:var(--alert)] border-[#e8cdc5]",
  blue: "bg-[color:var(--verified-soft)] text-[color:var(--verified)] border-[#cfe3d6]",
  violet: "bg-[color:var(--paper-raised)] text-[color:var(--ink)] border-[color:var(--rule-strong)]",
  slate: "bg-[color:var(--paper-raised)] text-[color:var(--faint)] border-[color:var(--rule)]",
};

export function Badge({
  tone = "neutral",
  title,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

export function DifficultyBadge({ rating }: { rating: DifficultyRating }) {
  const tone: BadgeTone =
    rating === "easy" ? "green" : rating === "moderate" ? "amber" : rating === "hard" ? "red" : "slate";
  return <Badge tone={tone}>Difficulty: {rating}</Badge>;
}

export function PathBadge({ path }: { path: RecommendedPath }) {
  const label =
    path === "managed-auth"
      ? "Composio Managed Auth"
      : path === "custom-oauth"
        ? "Custom OAuth app"
        : "Other route";
  return <Badge tone="violet">{label}</Badge>;
}

export function StatusBadge({ status }: { status: GuideStatus }) {
  const tone: BadgeTone = status === "curated" ? "blue" : status === "generated" ? "green" : "amber";
  const label = status === "curated" ? "Curated" : status === "generated" ? "Generated" : "Needs review";
  return <Badge tone={tone}>{label}</Badge>;
}

export function ClaimKindBadge({ kind }: { kind: ClaimKind }) {
  const tone: BadgeTone =
    kind === "verified"
      ? "green"
      : kind === "observed"
        ? "blue"
        : kind === "estimate"
          ? "amber"
          : kind === "inference"
            ? "violet"
            : "slate";
  return <Badge tone={tone}>{kind}</Badge>;
}

export function formatEstimate(est: Estimate): string {
  if (est.value === null || est.unit === null) return "Unknown";
  return `${est.value} ${est.unit}`;
}

/**
 * Evidence-source badge. Tone encodes trust tier:
 *   green  — authoritative (provider's own domain)
 *   violet — Composio docs
 *   amber  — third-party integration platforms (nango, clerk, openalgo, …)
 *   slate  — community (forums/blogs)
 *   red    — unknown provenance
 */
export function SourceBadge({ sourceType }: { sourceType: EvidenceRef["sourceType"] }) {
  // Treat legacy "third-party" rows (if any) as third-party-integration.
  const t: SourceType = sourceType === "third-party" ? "third-party-integration" : sourceType;
  const tone: BadgeTone =
    t === "official-docs" || t === "developer-portal"
      ? "green"
      : t === "composio-docs"
        ? "violet"
        : t === "third-party-integration"
          ? "amber"
          : t === "community"
            ? "slate"
            : "red";
  return <Badge tone={tone}>{sourceTypeLabel(t)}</Badge>;
}

const CATEGORY_LABEL: Record<SetupStepCategory, string> = {
  "register-provider-app": "Register the provider app",
  "configure-integration": "Configure the integration",
  "authorize-user": "Authorize a user",
  "verify-data-access": "Verify data access",
  "provider-approval": "Provider approval",
};

export function categoryLabel(c: SetupStepCategory): string {
  return CATEGORY_LABEL[c];
}

export const ORDERED_STEP_CATEGORIES: readonly SetupStepCategory[] = [
  "register-provider-app",
  "configure-integration",
  "authorize-user",
  "verify-data-access",
  "provider-approval",
] as const;
