// Valid inputs for the shipped validators, built fresh per run.
//
// Timestamps are derived from a caller-supplied reference instant so freshness rows
// stay exercisable forever instead of rotting into a permanent stale result.
const { shifted } = require("./surface");

function designContract(overrides = {}) {
  return {
    schema_id: "litfamily.design-contract/v1beta1",
    contract_id: "contract:benefit-application-ko",
    source_hash: "0".repeat(64),
    intent: {
      audiences: ["resident"],
      tasks: ["submit a benefit application"],
      qualities: ["legible under stress"],
      constraints: ["offline install"],
      non_goals: ["administrator tooling"],
    },
    direction: {
      name: "civic plainspoken",
      principles: [
        "one decision per screen",
        "quiet surfaces",
        "typography carries hierarchy",
      ],
      token_strategy: "reuse",
      voice: "direct, unhurried, never clever at the reader's expense",
    },
    inventory: {
      routes: [
        { id: "route:apply", path: "/apply", priority: "primary", auth_required: false },
        { id: "route:status", path: "/status", priority: "secondary", auth_required: true },
      ],
      regions: [
        { id: "region:apply-form", route_id: "route:apply", purpose: "collect the application" },
        { id: "region:status-summary", route_id: "route:status", purpose: "show decision state" },
      ],
      components: [
        { id: "component:field-group", region_id: "region:apply-form", role: "grouped text input" },
        { id: "component:decision-card", region_id: "region:status-summary", role: "result summary" },
      ],
      interactions: [
        {
          id: "interaction:submit-application",
          route_id: "route:apply",
          trigger: "activate the submit control",
          outcome: "application is queued and a receipt id is shown",
          criticality: "critical",
          input_modes: ["keyboard", "pointer", "touch"],
        },
        {
          id: "interaction:retry-status",
          route_id: "route:status",
          trigger: "activate refresh",
          outcome: "latest decision state is re-read",
          criticality: "supporting",
          input_modes: ["keyboard"],
        },
      ],
      states: [
        { id: "state:apply-loading", route_id: "route:apply", kind: "loading" },
        { id: "state:apply-error", route_id: "route:apply", kind: "error" },
        { id: "state:status-ready", route_id: "route:status", kind: "ready" },
      ],
      viewports: [
        { id: "viewport:compact", category: "compact", width_px: 320, height_px: 640 },
        { id: "viewport:expanded", category: "expanded", width_px: 1440, height_px: 900 },
      ],
      references: [
        { id: "reference:paper-form", kind: "user-provided", sha256: "1".repeat(64) },
      ],
      authenticated_surfaces: [
        { route_id: "route:status", safe_test_account: true },
      ],
    },
    accessibility: {
      target: "WCAG 2.2 AA",
      keyboard: true,
      screen_reader: true,
      reduced_motion: true,
      forced_colors: true,
      zoom_percent: 400,
    },
    localization: {
      locales: ["ko-KR", "en-US"],
      text_expansion_percent: 40,
      cjk_line_break_review: true,
      font_fallback_review: true,
      ime_review: true,
      rtl_review: false,
    },
    performance: {
      lcp_ms: 2500,
      cls: 0.1,
      inp_ms: 200,
      initial_js_kb: 180,
      initial_css_kb: 60,
    },
    evidence_policy: {
      independent_review_required: true,
      required_channels: ["tests", "keyboard", "accessibility-tree"],
      cleanup_required: true,
    },
    omissions: [
      { id: "omission:administrator-route", reason: "outside the approved scope", owner: "product-owner" },
    ],
    accepted_exceptions: [],
    lane: "brownfield",
    tokens: [
      { id: "token:action", category: "color", value: "accent-600", usage: "primary action" },
    ],
    component_behaviors: [
      {
        component_id: "component:field-group",
        state_ids: ["state:apply-loading", "state:apply-error"],
        interaction_ids: ["interaction:submit-application"],
        keyboard_behavior: "Enter submits the focused application",
      },
    ],
    responsive_transformations: [
      {
        route_id: "route:apply",
        viewport_id: "viewport:compact",
        behavior: "Field groups stack in source order",
      },
    ],
    motion: {
      policy: "functional",
      reduced_motion_behavior: "State changes without translation",
      transitions: [
        {
          id: "transition:submit",
          interaction_id: "interaction:submit-application",
          duration_ms: 160,
          easing: "ease-out",
        },
      ],
    },
    acceptance_criteria: [
      {
        id: "criterion:submit",
        observable: "Keyboard submission shows a receipt id",
        verification: "browser",
        required: true,
        inventory_ids: [
          "component:field-group",
          "interaction:submit-application",
          "state:apply-loading",
        ],
      },
    ],
    ...overrides,
  };
}

function capture(base, { captureDigest, sourceDigest }) {
  return {
    capture_id: "apply-320",
    source_sha256: sourceDigest,
    capture_sha256: captureDigest,
    created_at: shifted(base, -60),
    maximum_age_seconds: 3600,
    viewport: { width: 320, height: 640 },
    dpr: 2,
    os: "probe-host",
    runtime: "probe-renderer",
    runtime_version: "1",
    font_set: ["probe sans"],
    locale: "ko-KR",
    reduced_motion: true,
    animation_settling_policy: "settled",
    color_scheme: "light",
    auth_owner: "none",
    process_owner: "real-surface-probe",
  };
}

function evidenceManifest(base, { captureDigest, sourceDigest, inventoryDigest, tier } = {}) {
  const pinned = captureDigest || "3".repeat(64);
  return {
    schema_id: tier
      ? "litfamily.evidence-manifest/v1beta1"
      : "litfamily.evidence-manifest/v1alpha1",
    ...(tier ? { tier } : {}),
    design_contract_sha256: "1".repeat(64),
    source_revision: "a".repeat(40),
    captures: [capture(base, { captureDigest: pinned, sourceDigest: sourceDigest || "2".repeat(64) })],
    inventory: [
      {
        id: "apply",
        status: "captured",
        evidence_path: "captures/apply.png",
        evidence_sha256: inventoryDigest || pinned,
      },
    ],
    mechanical_results: [
      { check_id: "dimensions", status: "PASS", evidence_pointer: "capture:apply-320" },
    ],
    accessibility_results: [
      { criterion: "1.4.3", status: "PASS", evidence_pointer: "capture:apply-320" },
    ],
    tui_results: [
      { check_id: "not-applicable", status: "NOT_APPLICABLE", evidence_pointer: "inventory:apply" },
    ],
    reviewer_receipt_hashes: tier === "smoke" ? [] : ["4".repeat(64), "5".repeat(64)],
    open_findings: [],
    exception_references: [],
    cleanup: {
      state: "complete",
      process_terminated: true,
      auth_session_closed: true,
      transient_paths_removed: true,
    },
    final_verdict: "PASS",
  };
}

function reviewReceipt(base, { reviewId, contextId }) {
  return {
    schema_id: "litfamily.review-receipt/v1alpha1",
    review_id: reviewId,
    fresh_context_id: contextId,
    reviewer_capability_class: "hermes-delegate-task",
    input_hashes: ["1".repeat(64), "3".repeat(64)],
    reviewed_inventory: ["apply"],
    findings: [],
    confidence: "HIGH",
    independence_assertion: true,
    started_at: shifted(base, -300),
    ended_at: shifted(base, -240),
    timed_out: false,
    cancelled: false,
    verdict: "PASS",
  };
}

function tierRequest(base, { tier = "full", receipts } = {}) {
  const inventory = [
    "route:/primary", "screen:primary", "interaction:critical-submit",
    "viewport:320x640", "viewport:1440x900", "state:loading", "state:empty",
    "state:error", "theme:light", "permission:anonymous",
    "auth-surface:not-applicable", "tui-size:not-applicable",
  ];
  return {
    schema_id: "litfamily.visual-qa-completion/v1alpha1",
    tier,
    required_inventory: inventory,
    accounted_inventory: [...inventory],
    evidence_created_at: shifted(base, -60),
    evidence_maximum_age_seconds: 3600,
    contract_hash_matches: true,
    source_hash_matches: true,
    critical_mechanical_checks_complete: true,
    applicable_accessibility_checks_complete: true,
    inspections: [
      { view: "product", fresh_context_id: "probe-product" },
      { view: "evidence", fresh_context_id: "probe-evidence" },
    ],
    review_receipts: receipts || [
      reviewReceipt(base, { reviewId: "probe-review-a", contextId: "probe-fresh-a" }),
      reviewReceipt(base, { reviewId: "probe-review-b", contextId: "probe-fresh-b" }),
    ],
    findings: [],
    accepted_exceptions: [],
    reference_checks: [],
    iteration: {
      review_round: 2,
      concurrent_reviewers: 2,
      review_timeout_seconds: 600,
      mechanical_timeout_seconds: 30,
    },
  };
}

function capabilityRequest(overrides = {}, tier = "smoke") {
  return {
    tier,
    capabilities: {
      capture: true,
      auth: true,
      safe_test_account: true,
      independent_review: true,
      renderer_ownership: true,
      ...overrides,
    },
  };
}

module.exports = {
  capabilityRequest,
  designContract,
  evidenceManifest,
  reviewReceipt,
  tierRequest,
};
