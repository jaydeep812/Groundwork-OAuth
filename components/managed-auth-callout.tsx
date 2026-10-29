import Link from "next/link";

/**
 * Managed-auth shortcut. Composio managed auth is supplementary metadata, not
 * the guide's content: when a verified composio.dev toolkit URL exists we show
 * a small, single-line optional shortcut with an external link. It never
 * determines the guide (always a custom OAuth readiness guide) and carries no
 * instructions of its own. Omitted entirely when unavailable/unverified.
 */
export function ManagedAuthCallout({
  providerName,
  toolkitUrl,
}: {
  providerName: string;
  toolkitUrl: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-[color:var(--rule)] bg-[color:var(--paper-raised)] px-4 py-2.5 text-[14px]">
      <span className="text-[color:var(--slate)]">
        Prefer not to manage OAuth yourself? {providerName} is available via Composio Managed Auth.
      </span>
      <Link
        href={toolkitUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-[color:var(--verified)] underline underline-offset-2 hover:opacity-80"
      >
        Open the {providerName} toolkit ↗
      </Link>
    </div>
  );
}
