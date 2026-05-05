// Type definitions for the Vivarium recipes index (locked at v1 by
// ADR-0019, private memo) and the per-recipe verdict snapshot (Contract
// v1, ADR-0014, with the optional revision-2 evidence surface from
// ADR-0018). Kept structural and surface-only — the canonical schemas
// live at:
//
//   https://aletheia-works.github.io/vivarium/api/recipes.schema.json
//   https://aletheia-works.github.io/vivarium/spec/verdict.schema.json
//
// Consumers who need runtime validation should fetch and validate against
// those JSON Schemas; this module's types are an ergonomic façade for
// the in-process tool implementations.

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
  // Facet overlay added by ADR-0024 §2; always emitted by the generator
  // but optional here so consumers reading older bundled snapshots (with
  // no overlay merge) keep working.
  language?: string;
  symptom?: string;
  severity?: string;
  tags?: string[];
}

export interface RecipesIndex {
  index: 'v1';
  contract: 'v1';
  recipes: RecipeEntry[];
}

export type Verdict = 'reproduced' | 'unreproduced';

// Layer 2 / 3 verdict snapshot shape per Contract v1.
// `stderr_tail` keeps its source-side name; the in-page contract surface
// renames it to `evidence.stderr` at the lift boundary (see ADR-0018).
export interface VerdictSnapshot {
  contract: 'v1';
  verdict: Verdict;
  exit_code: number;
  image_tag: string;
  image_digest: string;
  captured_at: string;
  stdout: string;
  stderr_tail: string;
}
