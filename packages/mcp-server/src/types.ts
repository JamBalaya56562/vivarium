// Surface-only type façade for the recipes index (v1), the
// Layer 2/3 verdict snapshot (Contract v1), and the per-recipe
// round-trip state (schema_version 1). Canonical JSON Schemas
// live at:
//   https://aletheia-works.github.io/vivarium/api/recipes.schema.json
//   https://aletheia-works.github.io/vivarium/spec/verdict.schema.json
//   https://aletheia-works.github.io/vivarium/spec/roundtrip.schema.json

export type Layer = 1 | 2 | 3;

export interface RecipeEntry {
  slug: string;
  layer: Layer;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  verdict_url?: string;
  source_url: string;
  // Facet overlay (optional so older bundled snapshots without the
  // overlay merge keep deserialising).
  language?: string;
  symptom?: string;
  severity?: string;
  tags?: string[];
  // Round-trip state (optional, opt-in per recipe). Sourced from
  // src/layer*/<slug>/roundtrip.json by generate-recipes-index.ts.
  // Older bundled snapshots without this field stay readable.
  roundtrip?: RoundtripState;
}

export interface RecipesIndex {
  index: 'v1';
  contract: 'v1';
  recipes: RecipeEntry[];
}

export type Verdict = 'reproduced' | 'unreproduced';

export interface VerdictSnapshot {
  contract: 'v1';
  verdict: Verdict;
  exit_code: number;
  image_tag: string;
  image_digest: string;
  captured_at: string;
  stdout: string;
  // Source-side name kept here; the in-page contract surface renames
  // it to `evidence.stderr` at the lift boundary.
  stderr_tail: string;
}

// Per-recipe round-trip state (schema_version 1). Canonical schema:
// docs/site/public/spec/roundtrip.schema.json. SSOT for the
// upstream → reproduction → fix → verification → PR loop.

export type RoundtripStatus =
  | 'draft'
  | 'verifying'
  | 'verified'
  | 'upstream_open'
  | 'merged'
  | 'blocked';

export type VerdictSource = 'layer1-headless' | 'layer2-ghcr' | 'layer3-trace';

export interface RoundtripVerdict {
  verdict: Verdict;
  captured_at: string;
  source: VerdictSource;
}

export interface RoundtripFork {
  owner: string;
  repo: string;
  branch: string;
  image_tag?: string;
}

export interface RoundtripState {
  schema_version: 1;
  slug: string;
  upstream_issue: string;
  vivarium_pr?: string | null;
  fork?: RoundtripFork | null;
  upstream_pr?: string | null;
  verdicts?: {
    unfixed?: RoundtripVerdict;
    fixed?: RoundtripVerdict;
  };
  status: RoundtripStatus;
  updated_at: string;
  notes?: string[];
}

// Next-action keys consumed by the round-trip skill's state machine.
// Computed by `verify_and_report_fix` from the current RoundtripState
// so the skill (and any future MCP client) can decide the next call
// without re-implementing the state transitions. `manual_intervention`
// is the terminal action for `status: blocked` — callers must surface
// the roundtrip.json#/notes reason and pause automation.
export type RoundtripNextAction =
  | 'verify_unfixed'
  | 'verify_fixed'
  | 'open_fork_pr'
  | 'open_vivarium_pr'
  | 'manual_intervention'
  | 'complete';
