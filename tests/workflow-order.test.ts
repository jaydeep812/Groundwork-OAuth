import { describe, it, expect } from "vitest";
import { SetupStep } from "@/lib/schema/guide";
import {
  phaseOf,
  orderSetupSteps,
  validateWorkflow,
} from "@/lib/guide/workflow-order";

/**
 * Workflow-consistency regression suite.
 *
 * Root cause this guards: the Setup checklist used to order steps by category,
 * and the category enum places `configure-integration` before `authorize-user`.
 * The model files "Exchange the authorization code" under `configure-integration`,
 * so the exchange step rendered BEFORE authorization (the Zoho Desk bug), while
 * the deterministic Technical walkthrough showed the correct order.
 */

const step = (over: Partial<ReturnType<typeof SetupStep.parse>> & { id: string; title: string }) =>
  SetupStep.parse({ instructions: "do it", executionMode: "manual", ...over });

// The exact Zoho Desk shape: exchange is MIS-TAGGED as configure-integration.
const zohoSteps = [
  step({ id: "s1", title: "Register App in Zoho API Console", category: "register-provider-app" }),
  step({ id: "s2", title: "Perform Authorization Request", category: "authorize-user" }),
  step({ id: "s3", title: "Exchange Authorization Code for Tokens", category: "configure-integration" }),
];

describe("phaseOf — title cues override a mis-assigned category", () => {
  it("recognizes a code-exchange step tagged configure-integration as the exchange phase", () => {
    expect(phaseOf({ title: "Exchange Authorization Code for Tokens", category: "configure-integration" })).toBe("exchange");
  });
  it("keeps a genuine config step (redirect URI) in the configure phase", () => {
    expect(phaseOf({ title: "Configure the redirect URI and scopes", category: "configure-integration" })).toBe("configure");
  });
  it("classifies register/authorize/verify by title", () => {
    expect(phaseOf({ title: "Register an OAuth application", category: "configure-integration" })).toBe("register");
    expect(phaseOf({ title: "Redirect the user to authorize", category: "configure-integration" })).toBe("authorize");
    expect(phaseOf({ title: "Make an authenticated API request", category: "configure-integration" })).toBe("verify");
  });
});

describe("orderSetupSteps — canonical sequence, not category bucket order", () => {
  it("puts authorize before exchange even when exchange is tagged configure-integration", () => {
    const ordered = orderSetupSteps(zohoSteps).map((s) => s.id);
    // register → authorize → exchange
    expect(ordered).toEqual(["s1", "s2", "s3"]);
    expect(ordered.indexOf("s2")).toBeLessThan(ordered.indexOf("s3"));
  });

  it("is stable within a phase (preserves the model's intra-phase order)", () => {
    const steps = [
      step({ id: "a", title: "Register app", category: "register-provider-app" }),
      step({ id: "b", title: "Set the redirect URI", category: "configure-integration" }),
      step({ id: "c", title: "Choose scopes", category: "configure-integration" }),
    ];
    expect(orderSetupSteps(steps).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("orders conditional/alternative steps after primaries of the same phase", () => {
    const steps = [
      step({ id: "alt", title: "Configure PKCE", category: "configure-integration", required: false, appliesWhen: "public clients" }),
      step({ id: "main", title: "Set the redirect URI", category: "configure-integration" }),
    ];
    expect(orderSetupSteps(steps).map((s) => s.id)).toEqual(["main", "alt"]);
  });
});

describe("validateWorkflow — meaningful dependency checks", () => {
  it("passes a correctly ordered workflow", () => {
    expect(validateWorkflow({ setupSteps: orderSetupSteps(zohoSteps) })).toEqual([]);
  });

  it("flags exchange appearing before authorize (the Zoho Desk bug, pre-sort)", () => {
    const broken = [
      step({ id: "s1", title: "Register App", category: "register-provider-app" }),
      step({ id: "s3", title: "Exchange Authorization Code for Tokens", category: "authorize-user" }),
      step({ id: "s2", title: "Perform Authorization Request", category: "authorize-user" }),
    ];
    const issues = validateWorkflow({ setupSteps: broken });
    expect(issues.some((i) => i.code === "exchange-before-authorize")).toBe(true);
  });

  it("flags a registration prerequisite appearing after a dependent step", () => {
    const broken = [
      step({ id: "a", title: "Redirect the user to authorize", category: "authorize-user" }),
      step({ id: "r", title: "Register an OAuth application", category: "register-provider-app" }),
    ];
    expect(validateWorkflow({ setupSteps: broken }).some((i) => i.code === "prereq-after-dependent")).toBe(true);
  });

  it("flags a refresh step when refresh tokens are not issued", () => {
    const steps = [
      step({ id: "r", title: "Register an OAuth application", category: "register-provider-app" }),
      step({ id: "rf", title: "Refresh expired tokens", category: "configure-integration" }),
    ];
    const issues = validateWorkflow({
      setupSteps: steps,
      implementation: { tokenLifecycle: { refreshTokenIssued: "no" }, refreshUrl: null },
    });
    expect(issues.some((i) => i.code === "refresh-without-support")).toBe(true);
  });

  it("does NOT flag a refresh step when refresh tokens ARE issued", () => {
    const steps = [
      step({ id: "r", title: "Register an OAuth application", category: "register-provider-app" }),
      step({ id: "rf", title: "Refresh expired tokens", category: "configure-integration" }),
    ];
    const issues = validateWorkflow({
      setupSteps: steps,
      implementation: { tokenLifecycle: { refreshTokenIssued: "yes" }, refreshUrl: "https://x.com/token" },
    });
    expect(issues.some((i) => i.code === "refresh-without-support")).toBe(false);
  });

  it("flags dangling evidence/finding references on a step", () => {
    const steps = [step({ id: "a", title: "Register an OAuth application", category: "register-provider-app", findingIds: ["ghost"] })];
    const issues = validateWorkflow({ setupSteps: steps, findings: [], evidence: [] });
    expect(issues.some((i) => i.code === "dangling-step-reference")).toBe(true);
  });

  it("flags a journey that exchanges before authorizing", () => {
    const issues = validateWorkflow({
      setupSteps: orderSetupSteps(zohoSteps),
      journey: [
        { key: "authorize", order: 4 },
        { key: "exchange", order: 3 },
      ],
    });
    expect(issues.some((i) => i.code === "journey-checklist-order-mismatch")).toBe(true);
  });
});
