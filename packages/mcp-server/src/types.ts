export type Layer = 1 | 2 | 3;

export interface RecipeEntry {
  slug: string;
  layer: Layer;
  project: string;
  issue: number;
  title: string;
  page_url: string;
  page_url_ja?: string;
  verdict_url?: string;
  source_url: string;
  language?: string;
  symptom?: string;
  severity?: string;
  tags?: string[];
  path_a?: boolean;
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
  stderr_tail: string;
}

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

export type RoundtripNextAction =
  | 'verify_unfixed'
  | 'verify_fixed'
  | 'open_fork_pr'
  | 'open_vivarium_pr'
  | 'manual_intervention'
  | 'complete';
