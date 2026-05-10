// Surface-only type façade for the recipes index (v1) and the
// Layer 2/3 verdict snapshot (Contract v1). Canonical JSON Schemas
// live at:
//   https://aletheia-works.github.io/vivarium/api/recipes.schema.json
//   https://aletheia-works.github.io/vivarium/spec/verdict.schema.json

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
