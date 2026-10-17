import { describe, expect, test } from 'bun:test';
import { BuildError } from '../src/errors.ts';
import {
  type BuilderIdentity,
  builderHash,
  buildKey,
  canonicalJson,
  type KeyInputs,
  keyDependencies,
} from '../src/key.ts';

const builder: BuilderIdentity = {
  schemaVersion: 1,
  containerScriptSha256: '1'.repeat(64),
  image: `docker.io/library/rust@sha256:${'2'.repeat(64)}`,
  mbx: { version: '1.24.1', sha256: '3'.repeat(64) },
  rustcVerbose: 'rustc 1.98.1 (48a229cea 2026-09-01)\nrelease: 1.98.1\n',
  cargo: 'cargo 1.98.1 (797e8a9bc 2026-08-05)',
  command: [
    'build',
    '--locked',
    '--offline',
    '--release',
    '--target',
    'x86_64-unknown-linux-musl',
    '--package',
    'biome_cli',
  ],
  environment: { CARGO_INCREMENTAL: '0' },
};

const source = {
  repository: 'https://github.com/biomejs/biome',
  commit: '2405c7620169bd0719166af09a8d89cc76fb37fb',
};
const extras = [
  {
    name: 'make',
    url: 'https://dl-cdn.alpinelinux.org/x.apk',
    sha256: 'a916626a876f64c6b6fb32a6bf0fa93351d09fae0aa7684135642390da647e60',
    repository: 'https://gitlab.alpinelinux.org/alpine/aports',
    commit: '9368161bd37f74fb11747ba79197f8480aaca7dc',
  },
];

const inputs: KeyInputs = {
  tool: 'biome',
  ...source,
  target: 'x86_64-unknown-linux-musl',
  rustc: 'rustc 1.98.1 (48a229cea 2026-09-01)',
  sourcePatches: [],
  dependencies: keyDependencies(
    source,
    '09a29db28021791e2b6f56ca4ef4b84e662d751d65ead621f6df6c6ea8b0d3c9',
    extras,
  ),
  builderHash: builderHash(builder),
};

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('canonicalJson', () => {
  test('sorts keys at every depth and drops undefined', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } }),
    ).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });

  test('refuses values JSON cannot carry exactly', () => {
    expect(code(() => canonicalJson({ a: Number.NaN }))).toBe('INVALID_INPUT');
    expect(code(() => canonicalJson({ a: () => 1 }))).toBe('INVALID_INPUT');
  });
});

describe('buildKey', () => {
  test('matches the key formicarium accepted for the U1 baseline build', () => {
    // Values from a real baseline build-info that formicarium accepted.
    const u1: KeyInputs = {
      ...inputs,
      builderHash:
        '138eb2513a2399b496bf23973f947cf4dd68b8f855ed386d26dd8652950a1d2c',
    };
    expect(buildKey(u1)).toBe(
      '3c4d9fd12dfccee7051f70885cb992a482d244df20eca3aab396d926b699ff60',
    );
  });

  test('does not depend on the order dependencies were listed in', () => {
    expect(
      buildKey({ ...inputs, dependencies: [...inputs.dependencies].reverse() }),
    ).toBe(buildKey(inputs));
  });

  test('changes when any ELF-deciding input changes', () => {
    const original = buildKey(inputs);
    const variants: KeyInputs[] = [
      { ...inputs, commit: 'f79f85d58ae499647c127f1e90a4931e3dbbb206' },
      { ...inputs, repository: 'https://github.com/jambalaya56562/biome' },
      {
        ...inputs,
        dependencies: keyDependencies(source, '4'.repeat(64), extras),
      },
      { ...inputs, target: 'aarch64-unknown-linux-musl' },
      { ...inputs, rustc: 'rustc 1.99.0 (x 2026-10-01)' },
      { ...inputs, sourcePatches: [{ name: 'fix', sha256: '5'.repeat(64) }] },
      {
        ...inputs,
        builderHash: builderHash({
          ...builder,
          environment: { CARGO_INCREMENTAL: '1' },
        }),
      },
      { ...inputs, builderHash: builderHash({ ...builder, mbx: null }) },
      {
        ...inputs,
        builderHash: builderHash({
          ...builder,
          cargo: 'cargo 1.98.2 (x 2026-09-01)',
        }),
      },
      {
        ...inputs,
        builderHash: builderHash({
          ...builder,
          command: [...builder.command, '--features', 'x'],
        }),
      },
      {
        ...inputs,
        builderHash: builderHash({
          ...builder,
          image: `docker.io/library/rust@sha256:${'9'.repeat(64)}`,
        }),
      },
    ];
    for (const variant of variants)
      expect(buildKey(variant)).not.toBe(original);
  });

  test('refuses inputs that would make the key ambiguous', () => {
    expect(code(() => buildKey({ ...inputs, commit: 'abc' }))).toBe(
      'INVALID_INPUT',
    );
    expect(code(() => buildKey({ ...inputs, rustc: '1.98.1' }))).toBe(
      'INVALID_INPUT',
    );
    expect(code(() => buildKey({ ...inputs, builderHash: '' }))).toBe(
      'INVALID_INPUT',
    );
    expect(
      code(() =>
        buildKey({
          ...inputs,
          sourcePatches: [{ name: 'x', sha256: 'short' }],
        }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        buildKey({
          ...inputs,
          dependencies: [...inputs.dependencies, ...inputs.dependencies],
        }),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('builderHash', () => {
  test('refuses an unpinned image, a command without --locked and missing toolchain output', () => {
    expect(code(() => builderHash({ ...builder, image: 'rust:1.98.1' }))).toBe(
      'INVALID_INPUT',
    );
    expect(
      code(() => builderHash({ ...builder, command: ['build', '--release'] })),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => builderHash({ ...builder, rustcVerbose: 'rustc 1.98.1' })),
    ).toBe('INVALID_INPUT');
    expect(code(() => builderHash({ ...builder, cargo: '1.98.1' }))).toBe(
      'INVALID_INPUT',
    );
  });

  test('has no runner-side field, so editing runner code cannot move keys', () => {
    expect(Object.keys(builder).sort()).toEqual(
      [
        'cargo',
        'command',
        'containerScriptSha256',
        'environment',
        'image',
        'mbx',
        'rustcVerbose',
        'schemaVersion',
      ].sort(),
    );
  });
});
