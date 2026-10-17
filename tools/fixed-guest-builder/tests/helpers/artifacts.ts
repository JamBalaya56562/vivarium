import { type GuestBuildInfo, makeCatalog } from '../../src/artifact.ts';
import { buildKey, canonicalJson, keyDependencies } from '../../src/key.ts';

export const SOURCE = {
  repository: 'https://github.com/biomejs/biome',
  commit: '2405c7620169bd0719166af09a8d89cc76fb37fb',
};
const encoder = new TextEncoder();

export function sampleSet(
  elfText = '\x7fELF-sample',
  extra: Record<string, unknown> = {},
) {
  const elf = encoder.encode(elfText);
  const partial = {
    tool: 'biome',
    repository: SOURCE.repository,
    commit: SOURCE.commit,
    target: 'x86_64-unknown-linux-musl' as const,
    rustc: 'rustc 1.98.1 (48a229cea 2026-09-01)',
    sourcePatches: [],
    dependencies: keyDependencies(
      SOURCE,
      '09a29db28021791e2b6f56ca4ef4b84e662d751d65ead621f6df6c6ea8b0d3c9',
      [],
    ),
    builderHash: 'b'.repeat(64),
  };
  const key = buildKey(partial);
  const buildInfo: GuestBuildInfo = {
    schemaVersion: 1,
    tool: partial.tool,
    versionOrName: SOURCE.commit,
    source: SOURCE,
    target: partial.target,
    rustc: partial.rustc,
    sourcePatches: partial.sourcePatches,
    dependencies: partial.dependencies,
    builderHash: partial.builderHash,
    buildKey: key,
    elfSha256: new Bun.CryptoHasher('sha256').update(elf).digest('hex'),
    ...extra,
  };
  const buildInfoBytes = encoder.encode(canonicalJson(buildInfo));
  const catalog = makeCatalog(
    buildInfo,
    buildInfoBytes,
    elf,
    `https://github.com/aletheia-works/vivarium/releases/download/guest-biome-${key}/biome`,
  );
  return {
    key,
    files: {
      elf,
      buildInfo: buildInfoBytes,
      catalog: encoder.encode(JSON.stringify(catalog)),
    },
    expected: { buildKey: key, tool: 'biome', ...SOURCE },
  };
}
