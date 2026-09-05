export interface WheelManifest {
  schema_version: number;
  package: string;
  filename: string;
  version: string;
  purpose?: string;
  source: {
    type: string;
    url: string;
    ref: string;
    commit?: string;
    spec?: string;
    subdirectory?: string;
  };
  upstream_pr?: string;
  fetched_at?: string;
}

export type FetchWheelManifestOutcome =
  | { ok: true; manifest: WheelManifest; wheelUrl: string }
  | { ok: false; reason: string };

export async function fetchWheelManifest(opts?: {
  manifestUrl?: string;
}): Promise<FetchWheelManifestOutcome> {
  const manifestUrl = opts?.manifestUrl ?? './wheels/manifest.json';
  let res: Response;
  try {
    res = await fetch(manifestUrl, { cache: 'no-store' });
  } catch (err) {
    return {
      ok: false,
      reason: `could not fetch wheel manifest: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      reason: `wheel manifest unavailable (HTTP ${res.status}).`,
    };
  }
  let manifest: WheelManifest;
  try {
    manifest = (await res.json()) as WheelManifest;
  } catch (err) {
    return {
      ok: false,
      reason: `wheel manifest is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  if (!manifest.filename) {
    return {
      ok: false,
      reason: 'wheel manifest is missing `filename` field.',
    };
  }
  // baseURI, not location.href: the JA page is served from /ja/repro/… but
  // carries a <base> pointing at the recipe directory, where the wheels are.
  const wheelUrl = new URL(
    `./wheels/${manifest.filename}`,
    document.baseURI,
  ).toString();
  return { ok: true, manifest, wheelUrl };
}

export function resolveFixCandidateSpec(
  manifest: WheelManifest,
  pipPackageName: string,
): string {
  if (manifest.source.spec) return manifest.source.spec;
  const base = `${pipPackageName} @ git+${manifest.source.url}@${manifest.source.ref}`;
  return manifest.source.subdirectory
    ? `${base}#subdirectory=${manifest.source.subdirectory}`
    : base;
}
