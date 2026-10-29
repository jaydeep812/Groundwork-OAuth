import { NextResponse } from "next/server";
import { z } from "zod";
import { runGraph } from "@/lib/graph/run";

export const runtime = "nodejs";
// Deep investigation can run 90–180s. Keep comfortably under Vercel's 300s cap.
export const maxDuration = 240;

const InputShape = z.object({
  providerNameOrUrl: z.string().trim().min(1).max(200),
  useCase: z.string().trim().max(1000).optional().default(""),
});

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL || !process.env.TAVILY_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server is missing required API keys. Set GEMINI_API_KEY, GEMINI_MODEL, and TAVILY_API_KEY in .env.local.",
        stage: "config",
      },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body.", stage: "validate" },
      { status: 400 },
    );
  }
  const parsed = InputShape.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues.map((i) => i.message).join(" "),
        stage: "validate",
      },
      { status: 400 },
    );
  }
  const result = await runGraph(parsed.data);
  if (!result.ok) {
    const status = result.stage === "validate" ? 400 : 502;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({
    ok: true,
    slug: result.guide.slug,
    warnings: result.warnings,
  });
}
