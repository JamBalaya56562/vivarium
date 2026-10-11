import { appendFileSync } from 'node:fs';
import npm from '../package.json';
import jsr from '../jsr.json';

export function validateVersion(
  packageMetadata: { name: string; version: string },
  jsrMetadata: { name: string; version: string },
  tag?: string,
): string {
  const version = packageMetadata.version;
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version,
    )
  ) {
    throw new Error(`Invalid release version: ${version}`);
  }
  if (
    version
      .split('-')
      .slice(1)
      .join('-')
      .split('.')
      .some((part) => /^0\d+$/.test(part))
  ) {
    throw new Error(`Invalid numeric prerelease identifier: ${version}`);
  }
  if (
    packageMetadata.name !== jsrMetadata.name ||
    version !== jsrMetadata.version
  ) {
    throw new Error(
      'package.json and jsr.json must have identical names and versions',
    );
  }
  if (tag !== undefined && tag !== `v${version}`) {
    throw new Error(`Expected tag v${version}, received ${tag}`);
  }
  return version;
}

export async function isPublished(
  url: string,
  fetchMetadata: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchMetadata(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) return false;
  if (response.status !== 200)
    throw new Error(`Registry returned ${response.status}: ${url}`);
  const metadata = await response.json();
  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    !(
      typeof metadata.version === 'string' ||
      (metadata.manifest !== null &&
        typeof metadata.manifest === 'object' &&
        !Array.isArray(metadata.manifest))
    )
  ) {
    throw new Error(`Invalid registry metadata: ${url}`);
  }
  return true;
}

if (import.meta.main) {
  const version = validateVersion(npm, jsr, process.env.RELEASE_TAG);
  if (process.argv.includes('--registries')) {
    if (!process.env.GITHUB_OUTPUT || !process.env.RELEASE_TAG) {
      throw new Error('Registry checks require RELEASE_TAG and GITHUB_OUTPUT');
    }
    const npmExists = await isPublished(
      `https://registry.npmjs.org/${npm.name}/${version}`,
    );
    const jsrExists = await isPublished(
      `https://jsr.io/${jsr.name}/${version}_meta.json`,
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `npm_skip=${npmExists}\njsr_skip=${jsrExists}\n`,
    );
  }
}
