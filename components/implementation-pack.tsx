"use client";

import type { Finding, Implementation } from "@/lib/schema/guide";
import { Badge, ClaimKindBadge, formatEstimate } from "@/components/ui/badges";
import { CopyButton } from "@/components/ui/copy-button";
import { WhyWeKnow } from "@/components/why-we-know";

/**
 * The Implementation Pack: the concrete, copyable OAuth facts a developer needs
 * to wire up the integration. Renders directly below the hero. Every empty slot
 * shows an honest "not established from retrieved evidence" note rather than a
 * blank or a fabricated value.
 */

const PKCE_LABEL: Record<Implementation["pkce"], string> = {
  required: "Required",
  supported: "Supported",
  "not-supported": "Not supported",
  unknown: "Not established",
};

export function ImplementationPack({
  implementation,
  findings,
}: {
  implementation: Implementation;
  findings: Finding[];
}) {
  const i = implementation;
  const endpoints: { label: string; url: string | null }[] = [
    { label: "Developer portal", url: i.developerPortalUrl },
    { label: "Authorize URL", url: i.authorizeUrl },
    { label: "Token URL", url: i.tokenUrl },
    { label: "Refresh URL", url: i.refreshUrl },
    { label: "Revoke URL", url: i.revokeUrl },
  ];

  return (
    <section className="space-y-4 rounded-lg border border-[color:var(--rule)] bg-[color:var(--paper-raised)] p-6">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--rule)] pb-3">
        <h2 className="text-[1.3rem] font-semibold tracking-tight text-[color:var(--ink)]">
          Implementation pack
        </h2>
        <WhyWeKnow findings={findings} findingIds={i.findingIds ?? []} />
      </div>
      <p className="text-[14px] leading-relaxed text-[color:var(--slate)]">
        Blank values weren&apos;t established — confirm in the provider&apos;s docs before use.
      </p>

      {/* Endpoints */}
      <div className="space-y-2">
        {endpoints.map((e) => (
          <EndpointRow key={e.label} label={e.label} url={e.url} />
        ))}
      </div>

      {/* Scopes */}
      <div className="space-y-2">
        <FieldLabel>OAuth scopes</FieldLabel>
        {i.scopes.length === 0 ? (
          <NotEstablished>No scopes established (the provider may not use scopes).</NotEstablished>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {i.scopes.map((s) => (
                <Badge key={s.name} tone={s.required ? "green" : "neutral"} title={s.description}>
                  {s.name}
                  {s.required ? " (required)" : ""}
                </Badge>
              ))}
              <CopyButton value={i.scopes.map((s) => s.name).join(" ")} label="Copy all scopes" />
            </div>
          </div>
        )}

        {/* The provider's FULL advertised scope catalog (RFC 8414
            scopes_supported). Distinct from the recommended scopes above:
            being supported does not mean an integration needs it — a quiet
            least-privilege nudge. Collapsed so it never crowds the pack. */}
        {i.supportedScopes.length > 0 && (
          <details className="group mt-1">
            <summary className="cursor-pointer list-none text-[13px] text-[color:var(--faint)] hover:text-[color:var(--slate)] [&::-webkit-details-marker]:hidden">
              <span className="underline underline-offset-2">
                All {i.supportedScopes.length} scopes the provider advertises
              </span>
              <span className="ml-1 group-open:rotate-180 inline-block">▾</span>
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-[12px] leading-relaxed text-[color:var(--slate)]">
                Everything the provider supports — request only what your use case needs.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {i.supportedScopes.map((s) => (
                  <code
                    key={s}
                    className="rounded bg-[color:var(--paper-raised)] px-1.5 py-0.5 font-mono text-[12px] text-neutral-700"
                  >
                    {s}
                  </code>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>

      {/* Redirect URI rule + PKCE */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel>Redirect URI format</FieldLabel>
          {i.redirectUriRule ? (
            <p className="text-sm text-neutral-700">{i.redirectUriRule}</p>
          ) : (
            <NotEstablished>Redirect URI format not established.</NotEstablished>
          )}
        </div>
        <div className="space-y-1">
          <FieldLabel>PKCE</FieldLabel>
          <div className="space-y-1">
            <Badge tone={i.pkce === "required" ? "green" : i.pkce === "unknown" ? "slate" : "blue"}>
              {PKCE_LABEL[i.pkce]}
            </Badge>
            {i.pkceDetail?.appliesTo && (
              <p className="text-xs text-[color:var(--faint)]">
                {i.pkceDetail.required === "yes" ? "Required when: " : ""}
                {i.pkceDetail.appliesTo}
                {i.pkceDetail.methods?.length ? ` · methods: ${i.pkceDetail.methods.join(", ")}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* App distribution / availability — registering an app often doesn't make
          it usable by others until it's shared/published. Only when established. */}
      {i.appReadiness?.distribution && (
        <div className="space-y-1">
          <FieldLabel>App distribution</FieldLabel>
          <p className="text-sm text-neutral-700">{i.appReadiness.distribution}</p>
        </div>
      )}

      {/* Token lifetime + test mode */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel>Access token lifetime</FieldLabel>
          {i.tokenLifetime ? (
            <p className="flex items-center gap-2 text-sm text-neutral-700">
              {formatEstimate(i.tokenLifetime)}
              <ClaimKindBadge kind={i.tokenLifetime.kind} />
            </p>
          ) : (
            <NotEstablished>Token lifetime not established.</NotEstablished>
          )}
        </div>
        {i.testMode && (
          <div className="space-y-1">
            <FieldLabel>Test / sandbox mode</FieldLabel>
            <p className="text-sm text-neutral-700">{i.testMode}</p>
          </div>
        )}
      </div>

      {/* Token lifecycle: refresh issuance + rotation / single-use — the nuance
          a developer must get right. Only rendered when established. */}
      {i.tokenLifecycle && <TokenLifecycleRow lifecycle={i.tokenLifecycle} refreshUrl={i.refreshUrl} />}

      {/* Rate limits */}
      {i.rateLimits.length > 0 && (
        <div className="space-y-2">
          <FieldLabel>Rate limits</FieldLabel>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs tracking-wide text-[color:var(--faint)]">
                <th className="py-1 pr-4 font-medium">Limit</th>
                <th className="py-1 pr-4 font-medium">Window</th>
                <th className="py-1 pr-4 font-medium">Applies to</th>
                <th className="py-1 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {i.rateLimits.map((r, idx) => (
                <tr key={idx} className="border-t border-neutral-200 align-top">
                  <td className="py-1 pr-4 font-medium text-neutral-800">{r.limit}</td>
                  <td className="py-1 pr-4 text-neutral-700">{r.window || "—"}</td>
                  <td className="py-1 pr-4 text-neutral-700">{r.scope || "—"}</td>
                  <td className="py-1 text-neutral-600">{r.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EndpointRow({ label, url }: { label: string; url: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-36 shrink-0 text-sm font-medium text-neutral-700">{label}</span>
      {url ? (
        <>
          <code className="min-w-0 flex-1 truncate rounded bg-neutral-200 px-2 py-1 font-mono text-xs text-neutral-800">
            {url}
          </code>
          <CopyButton value={url} />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-600 underline"
          >
            open
          </a>
        </>
      ) : (
        <NotEstablished>not established</NotEstablished>
      )}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-medium text-[color:var(--faint)]">{children}</p>;
}

function NotEstablished({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-0.5 text-xs text-[color:var(--faint)]">
      {children}
    </span>
  );
}

function TokenLifecycleRow({
  lifecycle,
  refreshUrl,
}: {
  lifecycle: NonNullable<Implementation["tokenLifecycle"]>;
  refreshUrl: string | null;
}) {
  const lc = lifecycle;
  const items: { label: string; value: string }[] = [];
  if (lc.refreshTokenIssued !== "unknown")
    items.push({ label: "Refresh tokens", value: lc.refreshTokenIssued === "yes" ? "Issued" : "Not issued" });
  if (lc.refreshTokenRotates === "yes" || lc.refreshTokenSingleUse === "yes")
    items.push({ label: "Refresh rotation", value: "Single-use — each refresh returns a new refresh token; store it and discard the old one" });
  if (lc.revocationSupported !== "unknown")
    items.push({ label: "Revocation", value: lc.revocationSupported === "yes" ? "Supported" : "Not documented" });
  if (lc.tokenType) items.push({ label: "Token type", value: lc.tokenType });
  if (lc.presentation) items.push({ label: "Presentation", value: lc.presentation });
  if (refreshUrl) items.push({ label: "Refresh endpoint", value: refreshUrl });
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <FieldLabel>Token lifecycle</FieldLabel>
      <dl className="divide-y divide-[color:var(--rule)] border-y border-[color:var(--rule)] text-sm">
        {items.map((it) => (
          <div key={it.label} className="grid grid-cols-[9rem_1fr] gap-x-4 py-1.5">
            <dt className="text-[color:var(--faint)]">{it.label}</dt>
            <dd className="text-neutral-700">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
