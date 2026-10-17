import {
  MAX_CATALOG_BYTES,
  MAX_ELF_BYTES,
  MAX_METADATA_BYTES,
  type VerifiedSet,
  verifyArtifactSet,
} from './artifact.ts';
import { fail } from './errors.ts';
import { defaultFetcher, type Fetcher, fetchLimited } from './http.ts';

export const RELEASE_REPOSITORY = 'aletheia-works/vivarium';
export const BUILD_INFO_ASSET = 'build-info.json';
export const CATALOG_ASSET = 'catalog.json';

export function releaseTag(tool: string, key: string): string {
  if (!/^[0-9a-f]{64}$/.test(key))
    fail('INVALID_INPUT', 'release tag needs the full 64-character key');
  return `guest-${tool}-${key}`;
}

export function assetUrl(
  repository: string,
  tag: string,
  asset: string,
): string {
  return `https://github.com/${repository}/releases/download/${tag}/${asset}`;
}

export interface ReuseOptions {
  repository?: string;
  tool: string;
  binary: string;
  key: string;
  source: { repository: string; commit: string };
  fetcher?: Fetcher;
  signal?: AbortSignal;
}

export interface ReuseResult extends VerifiedSet {
  compiled: false;
  tag: string;
}

// Looked up without a token, which sees only published Releases, so a draft
// or a pending approval never counts as reusable.
export async function findPublished(
  options: ReuseOptions,
): Promise<ReuseResult | null> {
  const repository = options.repository ?? RELEASE_REPOSITORY;
  const tag = releaseTag(options.tool, options.key);
  const fetcher = options.fetcher ?? defaultFetcher;
  let response: Response;
  try {
    response = await fetcher(
      `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
      {
        credentials: 'omit',
        redirect: 'error',
        headers: { accept: 'application/vnd.github+json' },
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch {
    fail('EXTERNAL', 'release lookup failed');
  }
  if (response.status === 404) return null;
  if (response.status !== 200)
    fail('EXTERNAL', `release lookup returned HTTP ${response.status}`);
  const release = (await response.json()) as {
    draft?: boolean;
    assets?: { name?: string }[];
  };
  if (release.draft === true) return null;
  const names = (release.assets ?? []).map((asset) => asset.name).sort();
  const wanted = [options.binary, BUILD_INFO_ASSET, CATALOG_ASSET].sort();
  if (names.length !== 3 || names.some((name, index) => name !== wanted[index]))
    fail(
      'UNUSABLE_KEY',
      'the published Release for this key does not hold exactly its three files',
    );
  const get = (asset: string, limitBytes: number) =>
    fetchLimited(assetUrl(repository, tag, asset), {
      limitBytes,
      ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  const [elf, buildInfo, catalog] = [
    await get(options.binary, MAX_ELF_BYTES),
    await get(BUILD_INFO_ASSET, MAX_METADATA_BYTES),
    await get(CATALOG_ASSET, MAX_CATALOG_BYTES),
  ];
  let verified: VerifiedSet;
  try {
    verified = verifyArtifactSet(
      { elf: elf.bytes, buildInfo: buildInfo.bytes, catalog: catalog.bytes },
      { buildKey: options.key, tool: options.tool, ...options.source },
    );
  } catch (error) {
    fail(
      'UNUSABLE_KEY',
      `the published set for this key fails verification: ${error instanceof Error ? error.message : ''}`,
    );
  }
  return { ...verified, compiled: false, tag };
}
