import { InvestigateForm } from "./investigate-form";

export const metadata = { title: "Investigate a provider — Groundwork" };

export default function InvestigatePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-[color:var(--ink)]">Investigate a provider</h1>
        <p className="text-[color:var(--slate)]">
          Enter a provider and get its OAuth setup guide, researched live — every claim linked to a
          source.
        </p>
      </div>
      <InvestigateForm />
    </div>
  );
}
