import { createHash } from 'node:crypto';
import { fail } from './errors.ts';

export interface PatchIdentity {
  name: string;
  sha256: string;
}

export interface DependencyIdentity {
  tool: string;
  repository: string;
  commit: string;
  digest: string;
}

export interface ExtraPackage {
  name: string;
  url: string;
  sha256: string;
  repository: string;
  commit: string;
}

// Container-side only: runner-side code stays out so editing it cannot move
// keys or discard the mbx cache.
export interface BuilderIdentity {
  schemaVersion: 1;
  containerScriptSha256: string;
  image: string;
  mbx: { version: string; sha256: string } | null;
  notices: {
    scriptSha256: string;
    configSha256: string;
    cargoAbout: { version: string; sha256: string };
  };
  rustcVerbose: string;
  cargo: string;
  command: readonly string[];
  environment: Readonly<Record<string, string>>;
}

export interface KeyInputs {
  tool: string;
  repository: string;
  commit: string;
  target: string;
  rustc: string;
  sourcePatches: readonly PatchIdentity[];
  dependencies: readonly DependencyIdentity[];
  builderHash: string;
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const IMAGE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('INVALID_INPUT', 'key inputs must be finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(',')}}`;
  }
  fail('INVALID_INPUT', 'key inputs must be JSON values');
}

export function sha256Hex(text: string | Uint8Array): string {
  return createHash('sha256').update(text).digest('hex');
}

export function builderHash(builder: BuilderIdentity): string {
  if (builder.schemaVersion !== 1)
    fail('INVALID_INPUT', 'builder identity schemaVersion must be 1');
  if (!IMAGE.test(builder.image))
    fail('INVALID_INPUT', 'builder image must be pinned by digest');
  if (!SHA256.test(builder.containerScriptSha256))
    fail('INVALID_INPUT', 'builder needs the container script SHA256');
  if (builder.mbx !== null && !SHA256.test(builder.mbx.sha256))
    fail('INVALID_INPUT', 'mbx needs a SHA256');
  if (
    !SHA256.test(builder.notices?.scriptSha256 ?? '') ||
    !SHA256.test(builder.notices.configSha256) ||
    !SHA256.test(builder.notices.cargoAbout.sha256)
  )
    fail(
      'INVALID_INPUT',
      'builder needs the notices script, config and cargo-about SHA256',
    );
  if (!builder.rustcVerbose.includes('release: '))
    fail('INVALID_INPUT', 'builder needs the rustc -vV output');
  if (!builder.cargo.startsWith('cargo '))
    fail('INVALID_INPUT', 'builder needs the actual cargo version');
  if (!builder.command.includes('--locked'))
    fail('INVALID_INPUT', 'build command must use --locked');
  return sha256Hex(canonicalJson(builder));
}

function sortedDependencies(
  dependencies: readonly DependencyIdentity[],
): DependencyIdentity[] {
  return [...dependencies].sort((a, b) => {
    const x = `${a.tool}/${a.repository}/${a.commit}`;
    const y = `${b.tool}/${b.repository}/${b.commit}`;
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// Must stay the formula formicarium recomputes from build-info; every other
// ELF-deciding input enters through builderHash or dependencies.
export function buildKey(inputs: KeyInputs): string {
  if (!COMMIT.test(inputs.commit))
    fail('INVALID_INPUT', 'key commit must be 40 hexadecimal characters');
  if (!inputs.rustc.startsWith('rustc '))
    fail('INVALID_INPUT', 'key needs the actual rustc version');
  if (!SHA256.test(inputs.builderHash))
    fail('INVALID_INPUT', 'key needs the builder hash');
  for (const patch of inputs.sourcePatches)
    if (!SHA256.test(patch.sha256))
      fail('INVALID_INPUT', `source patch needs a SHA256: ${patch.name}`);
  const seen = new Set<string>();
  for (const dependency of inputs.dependencies) {
    if (!SHA256.test(dependency.digest) || !COMMIT.test(dependency.commit))
      fail(
        'INVALID_INPUT',
        `dependency needs a digest and a full commit: ${dependency.tool}`,
      );
    const id = `${dependency.tool}/${dependency.repository}/${dependency.commit}`;
    if (seen.has(id)) fail('INVALID_INPUT', `duplicate dependency: ${id}`);
    seen.add(id);
  }
  return sha256Hex(
    canonicalJson({
      tool: inputs.tool,
      repository: inputs.repository,
      commit: inputs.commit,
      builderHash: inputs.builderHash,
      target: inputs.target,
      rustc: inputs.rustc,
      sourcePatches: inputs.sourcePatches,
      dependencies: sortedDependencies(inputs.dependencies),
    }),
  );
}

export function keyDependencies(
  source: { repository: string; commit: string },
  cargoLockSha256: string,
  extras: readonly ExtraPackage[],
): DependencyIdentity[] {
  return [
    {
      tool: 'cargo-lock',
      repository: source.repository,
      commit: source.commit,
      digest: cargoLockSha256,
    },
    ...extras.map((extra) => ({
      tool: extra.name,
      repository: extra.repository,
      commit: extra.commit,
      digest: extra.sha256,
    })),
  ];
}
