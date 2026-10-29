import Link from "next/link";

export default function GuideNotFound() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
      <h1 className="text-xl font-semibold text-neutral-900">Guide not found</h1>
      <p className="mt-2 text-sm text-neutral-600">
        We don&apos;t have a guide at this URL. It may have been removed, or the provider hasn&apos;t
        been researched yet.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link
          href="/"
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Browse the library
        </Link>
        <Link
          href="/investigate"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-indigo-500"
        >
          Investigate a provider
        </Link>
      </div>
    </div>
  );
}
