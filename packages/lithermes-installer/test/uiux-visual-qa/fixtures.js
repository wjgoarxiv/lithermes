// A Design Contract that satisfies every rule in
// skills/frontend-ui-ux/scripts/design_contract_validation.py. It carries no corpus,
// dataset, or record-count identity: the only hashes are the top-level source_hash and
// the per-reference sha256.
function validDesignContract() {
  return {
    schema_id: "litfamily.design-contract/v1alpha1",
    contract_id: "contract:public-service-form-ko",
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
      principles: ["one decision per screen", "quiet surfaces", "typography carries hierarchy"],
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
        { id: "state:status-offline", route_id: "route:status", kind: "offline" },
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
      {
        id: "omission:administrator-route",
        reason: "outside the approved scope",
        owner: "product-owner",
      },
    ],
    accepted_exceptions: [
      {
        id: "exception:reduced-animation",
        reason: "fixture-only reduced animation budget",
        owner: "design-owner",
        expires_at: "2026-08-24T00:00:00Z",
      },
    ],
  };
}

function validEvidenceManifest(overrides = {}) {
  return {
    schema_id: "litfamily.evidence-manifest/v1alpha1",
    design_contract_sha256: "1".repeat(64),
    source_revision: "a".repeat(40),
    captures: [
      {
        capture_id: "application-320",
        source_sha256: "2".repeat(64),
        capture_sha256: "3".repeat(64),
        created_at: "2026-07-24T00:00:00Z",
        maximum_age_seconds: 3600,
        viewport: { width: 320, height: 640 },
        dpr: 2,
        os: "fixture",
        runtime: "fixture-browser",
        runtime_version: "1",
        font_set: ["fixture sans"],
        locale: "ko-KR",
        reduced_motion: true,
        animation_settling_policy: "settled",
        color_scheme: "light",
        auth_owner: "none",
        process_owner: "qa-fixture",
      },
    ],
    inventory: [
      {
        id: "application",
        status: "captured",
        evidence_path: "captures/application.png",
        evidence_sha256: "3".repeat(64),
      },
    ],
    mechanical_results: [
      {
        check_id: "dimensions",
        status: "PASS",
        evidence_pointer: "capture:application-320",
      },
    ],
    accessibility_results: [
      {
        criterion: "1.4.3",
        status: "PASS",
        evidence_pointer: "capture:application-320",
      },
    ],
    tui_results: [
      {
        check_id: "not-applicable",
        status: "NOT_APPLICABLE",
        evidence_pointer: "inventory:application",
      },
    ],
    reviewer_receipt_hashes: ["4".repeat(64), "5".repeat(64)],
    open_findings: [],
    exception_references: [],
    cleanup: {
      state: "complete",
      process_terminated: true,
      auth_session_closed: true,
      transient_paths_removed: true,
    },
    final_verdict: "PASS",
    ...overrides,
  };
}

function reviewReceipt(id, contextId) {
  return {
    schema_id: "litfamily.review-receipt/v1alpha1",
    review_id: id,
    fresh_context_id: contextId,
    reviewer_capability_class: "hermes-delegate-task",
    input_hashes: ["1".repeat(64), "3".repeat(64)],
    reviewed_inventory: ["application"],
    findings: [],
    confidence: "HIGH",
    independence_assertion: true,
    started_at: "2026-07-24T00:00:00Z",
    ended_at: "2026-07-24T00:01:00Z",
    timed_out: false,
    cancelled: false,
    verdict: "PASS",
  };
}

function tierCompletionRequest(tier) {
  const smokeInventory = [
    "route:/primary",
    "screen:primary",
    "interaction:critical-submit",
    "viewport:320x640",
    "viewport:1440x900",
  ];
  const fullInventory = [
    ...smokeInventory,
    "state:loading",
    "state:empty",
    "state:error",
    "theme:light",
    "permission:anonymous",
    "auth-surface:not-applicable",
    "tui-size:not-applicable",
  ];
  const requiredInventory =
    tier === "smoke"
      ? smokeInventory
      : tier === "reference-fidelity"
        ? [...fullInventory, "reference-comparison:primary"]
        : fullInventory;
  return {
    schema_id: "litfamily.visual-qa-completion/v1alpha1",
    tier,
    required_inventory: requiredInventory,
    accounted_inventory: [...requiredInventory],
    evidence_created_at: "2026-07-24T00:00:00Z",
    evidence_maximum_age_seconds: 3600,
    contract_hash_matches: true,
    source_hash_matches: true,
    critical_mechanical_checks_complete: true,
    applicable_accessibility_checks_complete: tier !== "smoke",
    inspections: [
      { view: "product", fresh_context_id: `${tier}-product` },
      { view: "evidence", fresh_context_id: `${tier}-evidence` },
    ],
    review_receipts: tier === "smoke" ? [] : [
      reviewReceipt(`${tier}-review-a`, `${tier}-fresh-a`),
      reviewReceipt(`${tier}-review-b`, `${tier}-fresh-b`),
    ],
    findings: [],
    accepted_exceptions: [],
    reference_checks:
      tier === "reference-fidelity"
        ? [
            {
              comparison_id: "primary",
              target_dimensions: [1440, 900],
              reference_dimensions: [1440, 900],
              structure_matches: true,
              content_matches: true,
              similarity: 0.99,
            },
          ]
        : [],
    iteration: {
      review_round: 2,
      concurrent_reviewers: 2,
      review_timeout_seconds: 600,
      mechanical_timeout_seconds: 30,
    },
  };
}

module.exports = { reviewReceipt, tierCompletionRequest, validDesignContract, validEvidenceManifest };
