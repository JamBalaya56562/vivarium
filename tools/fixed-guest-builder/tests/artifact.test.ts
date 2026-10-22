import { describe, expect, test } from 'bun:test';
import {
  parseUniqueJson,
  validateBuildInfo,
  verifyArtifactSet,
  verifyGuestSet,
} from '../src/artifact.ts';
import { BuildError } from '../src/errors.ts';
import { sampleSet } from './helpers/artifacts.ts';

const encoder = new TextEncoder();

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

describe('parseUniqueJson', () => {
  test('accepts a document exactly at the limit and refuses one byte more', () => {
    const text = `{"a":"${'x'.repeat(92)}"}`;
    expect(text.length).toBe(100);
    expect(parseUniqueJson(encoder.encode(text), 100, 'doc')).toEqual({
      a: 'x'.repeat(92),
    });
    expect(
      code(() => parseUniqueJson(encoder.encode(`${text} `), 100, 'doc')),
    ).toBe('LIMIT_EXCEEDED');
  });

  test('refuses repeated keys, including ones that differ only in escaping', () => {
    expect(
      code(() => parseUniqueJson(encoder.encode('{"a":1,"a":2}'), 100, 'doc')),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseUniqueJson(encoder.encode('{"a":1,"\\u0061":2}'), 100, 'doc'),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() =>
        parseUniqueJson(encoder.encode('{"o":{"k":1,"k":1}}'), 100, 'doc'),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      parseUniqueJson(encoder.encode('[{"k":1},{"k":2}]'), 100, 'doc'),
    ).toEqual([{ k: 1 }, { k: 2 }]);
  });

  test('refuses invalid UTF-8, trailing input and malformed JSON', () => {
    expect(
      code(() =>
        parseUniqueJson(new Uint8Array([0x7b, 0xff, 0x7d]), 100, 'doc'),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => parseUniqueJson(encoder.encode('{"a":1} x'), 100, 'doc')),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => parseUniqueJson(encoder.encode('{"a":}'), 100, 'doc')),
    ).toBe('INVALID_INPUT');
    expect(
      code(() => parseUniqueJson(encoder.encode('[1,]'), 100, 'doc')),
    ).toBe('INVALID_INPUT');
  });
});

describe('validateBuildInfo', () => {
  test('accepts the C03 identity with extra fields kept', () => {
    const { files } = sampleSet('\x7fELF', { reference: { runner: 'x' } });
    const info = validateBuildInfo(
      JSON.parse(new TextDecoder().decode(files.buildInfo)),
    );
    expect(info.reference).toEqual({ runner: 'x' });
  });

  test('refuses a buildKey that does not follow from its inputs', () => {
    const { files } = sampleSet();
    const info = JSON.parse(new TextDecoder().decode(files.buildInfo));
    expect(
      code(() => validateBuildInfo({ ...info, builderHash: 'c'.repeat(64) })),
    ).toBe('VERIFY_FAILED');
  });

  test('refuses missing identity fields and a wrong target', () => {
    const { files } = sampleSet();
    const info = JSON.parse(new TextDecoder().decode(files.buildInfo));
    for (const broken of [
      {
        ...info,
        source: { repository: 'http://x', commit: info.source.commit },
      },
      { ...info, source: { ...info.source, commit: 'abc' } },
      { ...info, target: 'aarch64-unknown-linux-musl' },
      { ...info, rustc: null },
      {
        ...info,
        sourcePatches: [
          { name: 'a', sha256: '1'.repeat(64) },
          { name: 'a', sha256: '1'.repeat(64) },
        ],
      },
      { ...info, elfSha256: 'short' },
      { ...info, schemaVersion: 2 },
    ]) {
      expect(code(() => validateBuildInfo(broken))).toBeDefined();
    }
  });
});

describe('verifyArtifactSet', () => {
  test('refuses a build-info that is not canonical JSON, as C03 digests require', () => {
    const { files, expected } = sampleSet();
    const pretty = encoder.encode(
      JSON.stringify(
        JSON.parse(new TextDecoder().decode(files.buildInfo)),
        null,
        2,
      ),
    );
    expect(
      code(() => verifyArtifactSet({ ...files, buildInfo: pretty }, expected)),
    ).toBe('VERIFY_FAILED');
  });

  test('accepts a consistent set', () => {
    const { files, expected } = sampleSet();
    const result = verifyArtifactSet(files, expected);
    expect(result.elfSha256).toBe(result.buildInfo.elfSha256);
  });

  test('refuses an ELF that differs from build-info', () => {
    const { files, expected } = sampleSet();
    expect(
      code(() =>
        verifyArtifactSet(
          { ...files, elf: encoder.encode('\x7fELF-other') },
          expected,
        ),
      ),
    ).toBe('VERIFY_FAILED');
  });

  test('refuses a set for another key or another source', () => {
    const { files, expected } = sampleSet();
    expect(
      code(() =>
        verifyArtifactSet(files, { ...expected, buildKey: 'd'.repeat(64) }),
      ),
    ).toBe('VERIFY_FAILED');
    expect(
      code(() =>
        verifyArtifactSet(files, {
          ...expected,
          repository: 'https://github.com/jambalaya56562/biome',
        }),
      ),
    ).toBe('VERIFY_FAILED');
  });

  test('refuses a catalog whose entry does not match the files', () => {
    const { files, expected } = sampleSet();
    const other = sampleSet('\x7fELF-two');
    expect(
      code(() =>
        verifyArtifactSet({ ...files, catalog: other.files.catalog }, expected),
      ),
    ).toBe('VERIFY_FAILED');
  });
});

describe('license files', () => {
  test('verifyGuestSet accepts a set whose license files match build-info', () => {
    const { files, expected } = sampleSet();
    const verified = verifyGuestSet(files, expected);
    expect(verified.licenseSha256).toBe(
      verified.buildInfo.licenseFiles?.[0]?.sha256 as string,
    );
    expect(verified.noticesSha256).toBe(
      verified.buildInfo.licenseFiles?.[1]?.sha256 as string,
    );
  });

  test('verifyGuestSet refuses changed license files and a build-info without them', () => {
    const { files, expected } = sampleSet();
    for (const changed of [
      { ...files, license: encoder.encode('other') },
      { ...files, notices: encoder.encode('other') },
    ])
      expect(code(() => verifyGuestSet(changed, expected))).toBe(
        'VERIFY_FAILED',
      );
    const legacy = sampleSet('\x7fELF-sample', { licenseFiles: undefined });
    expect(
      verifyArtifactSet(legacy.files, legacy.expected).buildInfo,
    ).not.toHaveProperty('licenseFiles');
    expect(code(() => verifyGuestSet(legacy.files, legacy.expected))).toBe(
      'VERIFY_FAILED',
    );
    const big = { ...files, notices: new Uint8Array(4_194_305) };
    expect(code(() => verifyGuestSet(big, expected))).toBe('LIMIT_EXCEEDED');
  });

  test('validateBuildInfo refuses malformed licenseFiles', () => {
    const info = JSON.parse(
      new TextDecoder().decode(sampleSet().files.buildInfo),
    );
    const [license, notices] = info.licenseFiles;
    for (const licenseFiles of [
      'LICENSE',
      [license],
      [notices, license],
      [{ ...license, sha256: 'short' }, notices],
      [{ ...license, bytes: 0 }, notices],
      [license, { ...notices, bytes: 4_194_305 }],
      [license, 'x'],
    ])
      expect(code(() => validateBuildInfo({ ...info, licenseFiles }))).toBe(
        'INVALID_INPUT',
      );
  });
});
