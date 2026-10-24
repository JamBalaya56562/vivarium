import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type { Fetcher } from '../../../tools/fixed-guest-builder/src/http.ts';
import {
  changeSummary,
  generatePin,
  type LsRemote,
  pinJson,
  SOURCE_REPOSITORY,
  tagCommit,
} from '../generate-formicarium-pin';
import {
  BUNDLE_ENTRIES,
  FORMICARIUM_PACKAGE,
  type FormicariumPin,
  NPM_REGISTRY,
  parsePin,
  StageError,
  tarballUrl,
} from '../stage-formicarium-assets';

const encoder = new TextEncoder();
const VERSION = '0.5.0';
const TAG_OBJECT = 'a'.repeat(40);
const TAG_COMMIT = 'b'.repeat(40);

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function header(name: string, size: number): Uint8Array {
  const block = new Uint8Array(512);
  const put = (text: string, at: number) => block.set(encoder.encode(text), at);
  const octal = (value: number, width: number) =>
    `${value.toString(8).padStart(width - 1, '0')}\0`;
  put(name, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(0, 12), 136);
  put('        ', 148);
  put('0', 156);
  put('ustar\0', 257);
  put('00', 263);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function tgz(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [path, text] of Object.entries(files)) {
    const body = encoder.encode(text);
    const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
    padded.set(body);
    parts.push(header(`package/${path}`, body.length), padded);
  }
  parts.push(new Uint8Array(1024));
  return gzipSync(Buffer.concat(parts));
}

const PACKAGE_FILES: Record<string, string> = {
  'runtime/web/api.js': 'export {};\n',
  'package.json': '{}\n',
  ...Object.fromEntries(
    Object.values(BUNDLE_ENTRIES).map((path) => [path, `${path}\n`]),
  ),
};

interface Registry {
  fetcher: Fetcher;
  requested: string[];
}

function registry(
  tarball: Uint8Array,
  doc: Record<string, unknown> = {},
): Registry {
  const requested: string[] = [];
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  const body = JSON.stringify({
    name: FORMICARIUM_PACKAGE,
    version: VERSION,
    dist: { tarball: tarballUrl(VERSION), integrity },
    ...doc,
  });
  const fetcher: Fetcher = async (url) => {
    requested.push(url);
    if (url === tarballUrl(VERSION)) return new Response(tarball);
    if (url.startsWith(`${NPM_REGISTRY}/${FORMICARIUM_PACKAGE}/`))
      return new Response(body);
    return new Response('not found', { status: 404 });
  };
  return { fetcher, requested };
}

const annotatedTag: LsRemote = (url, refs) => {
  expect(url).toBe(SOURCE_REPOSITORY);
  expect(refs).toEqual([`refs/tags/v${VERSION}`, `refs/tags/v${VERSION}^{}`]);
  return `${TAG_OBJECT}\trefs/tags/v${VERSION}\n${TAG_COMMIT}\trefs/tags/v${VERSION}^{}\n`;
};

async function stageError(run: () => unknown): Promise<StageError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof StageError) return error;
    throw error;
  }
  throw new Error('expected a StageError');
}

describe('generatePin', () => {
  test('pins the latest release with every file hashed and sorted by path', async () => {
    const tarball = tgz(PACKAGE_FILES);
    const { fetcher, requested } = registry(tarball);
    const pin = await generatePin({ fetcher, lsRemote: annotatedTag });
    expect(requested).toEqual([
      `${NPM_REGISTRY}/${FORMICARIUM_PACKAGE}/latest`,
      tarballUrl(VERSION),
    ]);
    const paths = Object.keys(PACKAGE_FILES).sort();
    expect(pin).toEqual({
      schemaVersion: 1,
      package: FORMICARIUM_PACKAGE,
      packageVersion: VERSION,
      tarballSha256: sha256(tarball),
      sourceCommit: TAG_COMMIT,
      files: paths.map((path) => ({
        path,
        sha256: sha256(PACKAGE_FILES[path] as string),
      })),
    });
    expect(parsePin(JSON.parse(pinJson(pin)))).toEqual(pin);
  });

  test('asks the registry for the version it is given', async () => {
    const { fetcher, requested } = registry(tgz(PACKAGE_FILES));
    await generatePin({ version: VERSION, fetcher, lsRemote: annotatedTag });
    expect(requested[0]).toBe(
      `${NPM_REGISTRY}/${FORMICARIUM_PACKAGE}/${VERSION}`,
    );
  });

  test('refuses a registry answer for another version', async () => {
    const { fetcher } = registry(tgz(PACKAGE_FILES));
    const error = await stageError(() =>
      generatePin({ version: '0.4.0', fetcher, lsRemote: annotatedTag }),
    );
    expect(error.code).toBe('INVALID_INPUT');
  });

  test('refuses a tarball the registry integrity does not describe', async () => {
    const { fetcher } = registry(tgz(PACKAGE_FILES), {
      dist: {
        tarball: tarballUrl(VERSION),
        integrity: `sha512-${'A'.repeat(86)}==`,
      },
    });
    const error = await stageError(() =>
      generatePin({ fetcher, lsRemote: annotatedTag }),
    );
    expect(error.code).toBe('VERIFY_FAILED');
  });

  test('refuses a tarball published anywhere the stager does not download from', async () => {
    const { fetcher } = registry(tgz(PACKAGE_FILES), {
      dist: { tarball: 'https://example.com/formicarium.tgz', integrity: '' },
    });
    const error = await stageError(() =>
      generatePin({ fetcher, lsRemote: annotatedTag }),
    );
    expect(error.code).toBe('VERIFY_FAILED');
  });
});

describe('tagCommit', () => {
  test('takes the commit an annotated tag points at', () => {
    expect(tagCommit(VERSION, annotatedTag)).toBe(TAG_COMMIT);
  });

  test('takes a lightweight tag as the commit itself', () => {
    expect(
      tagCommit(VERSION, () => `${TAG_COMMIT}\trefs/tags/v${VERSION}\n`),
    ).toBe(TAG_COMMIT);
  });

  test('fails when the release has no tag', async () => {
    const error = await stageError(() => tagCommit(VERSION, () => ''));
    expect(error.code).toBe('VERIFY_FAILED');
  });
});

describe('changeSummary', () => {
  const pin = (version: string, files: [string, string][]): FormicariumPin => ({
    schemaVersion: 1,
    package: FORMICARIUM_PACKAGE,
    packageVersion: version,
    tarballSha256: 'c'.repeat(64),
    sourceCommit: TAG_COMMIT,
    files: files.map(([path, sha]) => ({ path, sha256: sha.repeat(64) })),
  });

  test('names the files a release adds and removes and counts the ones it changes', () => {
    const summary = changeSummary(
      pin('0.4.0', [
        ['LICENSE', '1'],
        ['assets/blink.wasm', '2'],
        ['runtime/public.js', '3'],
      ]),
      pin(VERSION, [
        ['LICENSE', '1'],
        ['assets/paludarium/paludarium.wasm', '4'],
        ['runtime/public.js', '5'],
      ]),
    );
    expect(summary).toContain(`from 0.4.0 to ${VERSION}`);
    expect(summary).toContain(`${SOURCE_REPOSITORY}/releases/tag/v${VERSION}`);
    expect(summary).toContain(
      'Added:\n\n- `assets/paludarium/paludarium.wasm`',
    );
    expect(summary).toContain('Removed:\n\n- `assets/blink.wasm`');
    expect(summary).toContain('1 of the 2 kept files changed.');
  });
});
