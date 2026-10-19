import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  type GuestBuildInfo,
  makeCatalog,
} from '../../../tools/fixed-guest-builder/src/artifact.ts';
import {
  buildKey,
  canonicalJson,
} from '../../../tools/fixed-guest-builder/src/key.ts';
import { COI_SERVICEWORKER_FILE } from '../coi-serviceworker-pin';
import {
  type ArchiveLimits,
  checkSite,
  type FormicariumPin,
  parsePin,
  readNpmTarball,
  readUploadSettings,
  SITE_DIR,
  STAGE_DEADLINE_MS,
  StageError,
  type StageOptions,
  stageAssets,
  TRANSFER_LIMITS,
  tarballUrl,
  verifyArchiveAgainstPin,
} from '../stage-formicarium-assets';

const encoder = new TextEncoder();
const COI_COPY = readFileSync(
  path.join(import.meta.dir, 'fixtures', COI_SERVICEWORKER_FILE),
);
const VERSION = '0.3.0';
const SOURCE_COMMIT = 'c'.repeat(40);
const BASELINE = {
  repository: 'https://github.com/biomejs/biome',
  commit: '1'.repeat(40),
};
const FIX = {
  repository: 'https://github.com/jambalaya56562/biome',
  commit: 'a5bd0ce883a22980be20dfc87ba62006a43c3de8',
};

function sha(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function stageError(run: () => unknown): Promise<StageError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof StageError) return error;
    throw error;
  }
  throw new Error('expected a StageError');
}

interface Entry {
  name: string;
  body?: Uint8Array | string;
  type?: string;
  prefix?: string;
  pax?: Record<string, string>;
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function header(name: string, size: number, type: string, prefix = '') {
  const block = new Uint8Array(512);
  const put = (text: string, at: number) => block.set(encoder.encode(text), at);
  put(name, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(0, 12), 136);
  put('        ', 148);
  put(type, 156);
  put('ustar\0', 257);
  put('00', 263);
  put(prefix, 345);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return block;
}

function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
  out.set(bytes);
  return out;
}

function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let length = body.length + 1;
  while (`${length}${body}`.length !== length) length += 1;
  return `${length}${body}`;
}

function tar(entries: Entry[], trailing = new Uint8Array(1024)): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    const body =
      typeof entry.body === 'string'
        ? encoder.encode(entry.body)
        : (entry.body ?? new Uint8Array());
    if (entry.pax) {
      const data = encoder.encode(
        Object.entries(entry.pax)
          .map(([key, value]) => paxRecord(key, value))
          .join(''),
      );
      parts.push(header('PaxHeader', data.length, 'x'), padded(data));
    }
    parts.push(
      header(entry.name, body.length, entry.type ?? '0', entry.prefix),
      padded(body),
    );
  }
  parts.push(trailing);
  return Buffer.concat(parts);
}

function tgz(entries: Entry[], trailing?: Uint8Array): Uint8Array {
  return gzipSync(tar(entries, trailing));
}

function packageFiles(): Map<string, Uint8Array> {
  const loader = encoder.encode('export default function createBlink() {}\n');
  const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  const files: Record<string, Uint8Array | string> = {
    LICENSE: 'Apache License 2.0\n',
    'README.md': '# formicarium\n',
    'THIRD_PARTY_NOTICES.md': 'blink: ISC\n',
    'assets/blink.mjs': loader,
    'assets/blink.wasm': wasm,
    'assets/build-info.json': JSON.stringify({
      assetDigests: { loaderSha256: sha(loader), wasmSha256: sha(wasm) },
    }),
    'package.json': '{"name":"@aletheia-works/formicarium"}\n',
    'runtime/node/api.js': 'export {};\n',
    'runtime/public.js': 'export {};\n',
    'runtime/web/api.js': 'export {};\n',
    'runtime/web/package-worker.bundle.js': 'self.onmessage = () => {};\n',
  };
  return new Map(
    Object.entries(files).map(([name, body]) => [
      name,
      typeof body === 'string' ? encoder.encode(body) : body,
    ]),
  );
}

function packageTarball(files = packageFiles()): Uint8Array {
  return tgz(
    [...files].map(([name, body]) => ({ name: `package/${name}`, body })),
  );
}

function pinFor(tarball: Uint8Array, files = packageFiles()): FormicariumPin {
  return {
    schemaVersion: 1,
    package: '@aletheia-works/formicarium',
    packageVersion: VERSION,
    tarballSha256: sha(tarball),
    sourceCommit: SOURCE_COMMIT,
    files: [...files]
      .map(([name, body]) => ({ path: name, sha256: sha(body) }))
      .sort((a, b) => (a.path < b.path ? -1 : 1)),
  };
}

function guestSet(
  source: { repository: string; commit: string },
  elfText: string,
) {
  const elf = encoder.encode(elfText);
  const inputs = {
    tool: 'biome',
    repository: source.repository,
    commit: source.commit,
    target: 'x86_64-unknown-linux-musl' as const,
    rustc: 'rustc 1.98.1 (48a229cea 2026-09-01)',
    sourcePatches: [],
    dependencies: [],
    builderHash: 'b'.repeat(64),
  };
  const key = buildKey(inputs);
  const info: GuestBuildInfo = {
    schemaVersion: 1,
    tool: 'biome',
    versionOrName: source.commit,
    source,
    target: inputs.target,
    rustc: inputs.rustc,
    sourcePatches: [],
    dependencies: [],
    builderHash: inputs.builderHash,
    buildKey: key,
    elfSha256: sha(elf),
  };
  const buildInfo = encoder.encode(canonicalJson(info));
  const catalog = encoder.encode(
    JSON.stringify(
      makeCatalog(
        info,
        buildInfo,
        elf,
        `https://github.com/aletheia-works/vivarium/releases/download/guest-biome-${key}/biome`,
      ),
    ),
  );
  return {
    key,
    files: {
      biome: elf,
      'build-info.json': buildInfo,
      'catalog.json': catalog,
    },
    accepted: {
      commit: source.commit,
      versionOrName: source.commit,
      buildKey: key,
      elfSha256: sha(elf),
      buildInfoSha256: sha(buildInfo),
    },
  };
}

let root: string;
let layer1: string;
const baselineSet = guestSet(BASELINE, '\x7fELF-baseline');
const fixSet = guestSet(FIX, '\x7fELF-fix');

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'vivarium-stage-'));
  layer1 = path.join(root, 'layer1');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function writeRecipe(
  slug: string,
  options: {
    accepted?: boolean;
    coi?: Uint8Array | null;
    fixRepository?: string;
  } = {},
) {
  const dir = path.join(layer1, slug);
  await mkdir(dir, { recursive: true });
  const guest = (
    role: string,
    source: typeof BASELINE,
    set: typeof baselineSet,
  ) => ({
    role,
    tool: 'biome',
    repository: source.repository,
    commit: source.commit,
    fixture: 'biome-migrate-prettier-override',
    ...(options.accepted ? { accepted: set.accepted } : {}),
  });
  await writeFile(
    path.join(dir, 'recipe.json'),
    JSON.stringify({
      schema_version: 1,
      language: 'shell',
      expected_verdict: 'reproduced',
      expected_runtime: 'formicarium',
      guests: [
        guest('baseline', BASELINE, baselineSet),
        guest(
          'fix',
          { ...FIX, repository: options.fixRepository ?? FIX.repository },
          fixSet,
        ),
      ],
    }),
  );
  if (options.coi !== null)
    await writeFile(
      path.join(dir, COI_SERVICEWORKER_FILE),
      options.coi ?? COI_COPY,
    );
  return dir;
}

async function writeGuestDirs() {
  const dirs: Record<string, string> = {};
  for (const [role, set] of [
    ['baseline', baselineSet],
    ['fix', fixSet],
  ] as const) {
    const dir = path.join(root, 'guests', role);
    await mkdir(dir, { recursive: true });
    for (const [name, bytes] of Object.entries(set.files))
      await writeFile(path.join(dir, name), bytes);
    dirs[role] = dir;
  }
  return dirs;
}

async function localOptions(
  tarball = packageTarball(),
  pin: unknown = pinFor(tarball),
): Promise<StageOptions> {
  const tarballPath = path.join(root, 'formicarium.tgz');
  await writeFile(tarballPath, tarball);
  const dirs = await writeGuestDirs();
  return {
    mode: 'local',
    layer1Dir: layer1,
    local: {
      tarballPath,
      expected: {
        pin,
        guests: {
          demo: {
            baseline: {
              dir: dirs.baseline as string,
              accepted: baselineSet.accepted,
            },
            fix: { dir: dirs.fix as string, accepted: fixSet.accepted },
          },
        },
      },
    },
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function releaseUrl(set: typeof baselineSet, asset: string) {
  return `https://github.com/aletheia-works/vivarium/releases/download/guest-biome-${set.key}/${asset}`;
}

function objectUrl(asset: string, key: string) {
  return `https://release-assets.githubusercontent.com/${key}/${asset}`;
}

function registry(
  tarball: Uint8Array,
  override: Record<string, (call: Call) => Response | Promise<Response>> = {},
) {
  const calls: Call[] = [];
  const routes = new Map<string, () => Response>();
  routes.set(tarballUrl(VERSION), () => new Response(tarball));
  for (const set of [baselineSet, fixSet]) {
    for (const [asset, bytes] of Object.entries(set.files)) {
      const target = objectUrl(asset, set.key);
      routes.set(
        releaseUrl(set, asset),
        () =>
          new Response(null, { status: 302, headers: { location: target } }),
      );
      routes.set(target, () => new Response(bytes));
    }
  }
  const fetcher = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const custom = override[url];
    if (custom) return custom(call);
    const route = routes.get(url);
    if (!route) return new Response('not found', { status: 404 });
    return route();
  };
  return { fetcher, calls };
}

async function pinOptions(
  tarball = packageTarball(),
  override: Parameters<typeof registry>[1] = {},
) {
  const pinPath = path.join(root, 'formicarium.pin.json');
  await writeFile(pinPath, JSON.stringify(pinFor(tarball)));
  const { fetcher, calls } = registry(tarball, override);
  const options: StageOptions = {
    mode: 'pin',
    layer1Dir: layer1,
    pinPath,
    fetcher,
  };
  return { options, calls };
}

const SMALL: ArchiveLimits = {
  maxExpandedBytes: 4096,
  maxArchiveEntries: 4,
  maxPathBytes: 64,
};

describe('readNpmTarball (NFR4.1, S2)', () => {
  test('uses the C11 limits by default', () => {
    expect(TRANSFER_LIMITS).toMatchObject({
      fetchDeadlineMs: 120_000,
      maxDownloadBytes: 134_217_728,
      maxExpandedBytes: 268_435_456,
      maxElfBytes: 134_217_728,
      maxArchiveEntries: 4096,
      maxMetadataBytes: 1_048_576,
      maxCatalogBytes: 4_194_304,
      maxPathBytes: 4096,
    });
    expect(STAGE_DEADLINE_MS).toBe(360_000);
  });

  test('reads regular files from ustar names, the prefix field and pax paths', () => {
    const long = `dir/${'a'.repeat(150)}.js`;
    const files = readNpmTarball(
      tgz([
        { name: 'package/LICENSE', body: 'license' },
        { name: 'b.js', prefix: 'package/runtime', body: 'b' },
        {
          name: 'package/ignored-name',
          pax: { path: `package/${long}` },
          body: 'c',
        },
      ]),
    );
    expect(files.map((file) => file.path)).toEqual([
      'LICENSE',
      'runtime/b.js',
      long,
    ]);
    expect(new TextDecoder().decode(files[0]?.bytes)).toBe('license');
  });

  test('refuses escaping, absolute, linked, special and repeated entries', () => {
    const cases: [Entry[], string][] = [
      [[{ name: 'package/../evil' }], '.. segment'],
      [[{ name: 'package//etc/passwd' }], 'is absolute'],
      [[{ name: '/etc/passwd' }], 'outside package/'],
      [[{ name: 'other/x' }], 'outside package/'],
      [[{ name: 'package/link', type: '2' }], 'symlink'],
      [[{ name: 'package/hard', type: '1' }], 'hardlink'],
      [[{ name: 'package/dir/', type: '5' }], 'directory'],
      [[{ name: 'package/fifo', type: '6' }], 'FIFO'],
      [[{ name: 'package/g', type: 'g' }], 'global pax header'],
      [[{ name: 'package/x', pax: { linkpath: 'y' } }], 'names a link'],
      [
        [
          { name: 'package/same', body: '1' },
          { name: 'package/same', body: '2' },
        ],
        'appears twice',
      ],
    ];
    for (const [entries, message] of cases) {
      let error: unknown;
      try {
        readNpmTarball(tgz(entries));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(StageError);
      expect((error as StageError).message).toContain(message);
    }
  });

  test('allows the entry, byte and path limits and refuses one more', () => {
    const entries = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ name: `package/f${i}` }));
    expect(readNpmTarball(tgz(entries(4)), SMALL)).toHaveLength(4);
    expect(() => readNpmTarball(tgz(entries(5)), SMALL)).toThrow(
      'archive entry count',
    );
    const bytes = (size: number) => [
      { name: 'package/a', body: new Uint8Array(size - 100) },
      { name: 'package/b', body: new Uint8Array(100) },
    ];
    expect(readNpmTarball(tgz(bytes(4096)), SMALL)).toHaveLength(2);
    expect(() => readNpmTarball(tgz(bytes(4097)), SMALL)).toThrow(
      'expanded archive',
    );
    const at = (length: number) => [
      { name: 'package/x', pax: { path: `package/${'p'.repeat(length)}` } },
    ];
    expect(readNpmTarball(tgz(at(64)), SMALL)[0]?.path).toHaveLength(64);
    expect(() => readNpmTarball(tgz(at(65)), SMALL)).toThrow(
      'longer than 64 bytes',
    );
    const real = Array.from({ length: 4097 }, (_, i) => ({
      name: `package/${i}`,
    }));
    expect(() => readNpmTarball(tgz(real))).toThrow('archive entry count');
    expect(readNpmTarball(tgz(real.slice(0, 4096)))).toHaveLength(4096);
  });

  test('refuses a gzip bomb, a broken checksum, trailing data and non-gzip input', () => {
    const bomb = gzipSync(new Uint8Array(4096 + 4 * 1024 + 10_240 + 1));
    expect(() => readNpmTarball(bomb, SMALL)).toThrow('expands beyond');
    const raw = tar([{ name: 'package/a', body: 'a' }]);
    raw[0] = 'q'.charCodeAt(0);
    expect(() => readNpmTarball(gzipSync(raw))).toThrow('checksum');
    const trailing = new Uint8Array(1024);
    trailing[1000] = 1;
    expect(() =>
      readNpmTarball(tgz([{ name: 'package/a', body: 'a' }], trailing)),
    ).toThrow('after the tar end marker');
    expect(() => readNpmTarball(encoder.encode('not gzip'))).toThrow(
      'not gzip',
    );
  });
});

describe('pin and archive verification (BR2.1, NFR3.2)', () => {
  test('refuses a malformed pin', () => {
    const pin = pinFor(packageTarball());
    expect(() => parsePin({ ...pin, extra: 1 })).toThrow('exactly the fields');
    expect(() => parsePin({ ...pin, packageVersion: 'latest' })).toThrow(
      'semver',
    );
    expect(() => parsePin({ ...pin, files: [...pin.files].reverse() })).toThrow(
      'sorted',
    );
    expect(() =>
      parsePin({
        ...pin,
        files: pin.files.filter(
          (file) => file.path !== 'THIRD_PARTY_NOTICES.md',
        ),
      }),
    ).toThrow('THIRD_PARTY_NOTICES.md');
  });

  test('refuses a changed file, an unlisted entry, a missing file and a stale build-info', () => {
    const pin = parsePin(pinFor(packageTarball()));
    const changed = packageFiles();
    changed.set('runtime/web/api.js', encoder.encode('export const x = 1;\n'));
    expect(() =>
      verifyArchiveAgainstPin(readNpmTarball(packageTarball(changed)), pin),
    ).toThrow('runtime/web/api.js: SHA256');
    const extra = packageFiles();
    extra.set('runtime/extra.js', encoder.encode(''));
    expect(() =>
      verifyArchiveAgainstPin(readNpmTarball(packageTarball(extra)), pin),
    ).toThrow('does not list: runtime/extra.js');
    const missing = packageFiles();
    missing.delete('README.md');
    expect(() =>
      verifyArchiveAgainstPin(readNpmTarball(packageTarball(missing)), pin),
    ).toThrow('lacks: README.md');
    const stale = packageFiles();
    stale.set('assets/build-info.json', encoder.encode('{"assetDigests":{}}'));
    expect(() =>
      verifyArchiveAgainstPin(
        readNpmTarball(packageTarball(stale)),
        parsePin(pinFor(packageTarball(stale), stale)),
      ),
    ).toThrow('does not describe the shipped');
  });

  test('refuses empty notices', () => {
    const empty = packageFiles();
    empty.set('THIRD_PARTY_NOTICES.md', new Uint8Array());
    expect(() =>
      verifyArchiveAgainstPin(
        readNpmTarball(packageTarball(empty)),
        parsePin(pinFor(packageTarball(empty), empty)),
      ),
    ).toThrow('THIRD_PARTY_NOTICES.md is missing or empty');
  });
});

describe('stageAssets local mode (S5)', () => {
  test('stages the bundle, assets.json and both guests into the recipe dir only', async () => {
    const dir = await writeRecipe('demo');
    await mkdir(path.join(dir, '_formicarium', 'old'), { recursive: true });
    await writeFile(path.join(dir, '_formicarium', 'old', 'stale.js'), 'x');
    const options = await localOptions();
    const summaryPath = path.join(root, 'summary.md');
    const report = await stageAssets({ ...options, summaryPath });
    expect(report.staged.map((item) => item.slug)).toEqual(['demo']);
    expect(existsSync(path.join(dir, '_formicarium', 'old'))).toBe(false);
    const manifest = JSON.parse(
      await readFile(path.join(dir, '_formicarium', 'assets.json'), 'utf-8'),
    );
    expect(manifest.version).toBe(VERSION);
    expect(manifest.entries.worker).toBe(
      `${VERSION}/runtime/web/package-worker.bundle.js`,
    );
    const staged = manifest.files.map((file: { path: string }) => file.path);
    expect(staged).toContain(`${VERSION}/THIRD_PARTY_NOTICES.md`);
    expect(staged).not.toContain(`${VERSION}/runtime/node/api.js`);
    expect(staged).not.toContain(`${VERSION}/README.md`);
    for (const file of manifest.files)
      expect(sha(readFileSync(path.join(dir, '_formicarium', file.path)))).toBe(
        file.sha256,
      );
    expect(readFileSync(path.join(dir, 'guests', 'fix', 'biome'))).toEqual(
      Buffer.from(fixSet.files.biome),
    );
    expect(
      JSON.parse(
        readFileSync(path.join(dir, 'guests', 'fix', 'accepted.json'), 'utf-8'),
      ),
    ).toEqual(fixSet.accepted);
    expect(readFileSync(summaryPath, 'utf-8')).toContain(
      '| demo baseline ELF |',
    );
  });

  test('never writes into docs/doc_build', async () => {
    const options = await localOptions();
    const error = await stageError(() =>
      stageAssets({ ...options, layer1Dir: path.join(SITE_DIR, 'repro') }),
    );
    expect(error.code).toBe('INVALID_INPUT');
  });

  test('refuses a tarball that is not the pinned one and writes nothing', async () => {
    const dir = await writeRecipe('demo');
    const options = await localOptions(
      packageTarball(),
      pinFor(
        packageTarball(
          new Map([...packageFiles(), ['LICENSE', encoder.encode('other')]]),
        ),
      ),
    );
    const error = await stageError(() => stageAssets(options));
    expect(error.code).toBe('VERIFY_FAILED');
    expect(existsSync(path.join(dir, '_formicarium'))).toBe(false);
  });

  test('keeps a recipe without accepted guests pending', async () => {
    const dir = await writeRecipe('demo');
    const options = await localOptions();
    delete options.local?.expected.guests;
    const report = await stageAssets(options);
    expect(report.pending).toEqual([
      { slug: 'demo', reasons: ['accepted-missing'] },
    ]);
    expect(existsSync(path.join(dir, 'guests'))).toBe(false);
  });

  test('refuses an active recipe whose coi-serviceworker copy is missing or changed', async () => {
    await writeRecipe('demo', { coi: null });
    let error = await stageError(async () => stageAssets(await localOptions()));
    expect(error.message).toContain('coi-serviceworker.js: missing');
    const changed = new Uint8Array(COI_COPY);
    changed[0] ^= 1;
    await writeRecipe('demo', { coi: changed });
    error = await stageError(async () => stageAssets(await localOptions()));
    expect(error.message).toContain('is not coi-serviceworker 0.1.7');
  });
});

describe('stageAssets pin mode (S2)', () => {
  test('fetches without credentials or tokens and records the final URL', async () => {
    await writeRecipe('demo', { accepted: true });
    const { options, calls } = await pinOptions();
    const saved = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      NPM_TOKEN: process.env.NPM_TOKEN,
    };
    process.env.GITHUB_TOKEN = 'ghs_secret';
    process.env.NPM_TOKEN = 'npm_secret';
    let report: Awaited<ReturnType<typeof stageAssets>>;
    try {
      report = await stageAssets(options);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    expect(report.staged.map((item) => item.slug)).toEqual(['demo']);
    expect(
      existsSync(path.join(layer1, 'demo', 'guests', 'fix', 'accepted.json')),
    ).toBe(false);
    expect(calls.length).toBe(1 + 2 * 3 * 2);
    for (const call of calls) {
      expect(call.init.credentials).toBe('omit');
      expect(call.init.redirect).toBe('manual');
      expect(JSON.stringify(call.init)).not.toContain('secret');
      expect(new Headers(call.init.headers).has('authorization')).toBe(false);
    }
    const elfRow = report.rows.find((row) => row.item === 'demo fix ELF');
    expect(elfRow?.source).toBe(objectUrl('biome', fixSet.key));
  });

  test('without a pin every formicarium recipe is pending and nothing is fetched', async () => {
    await writeRecipe('demo', { accepted: true });
    const { fetcher, calls } = registry(packageTarball());
    const report = await stageAssets({
      mode: 'pin',
      layer1Dir: layer1,
      pinPath: path.join(root, 'absent.pin.json'),
      fetcher,
    });
    expect(report.pending).toEqual([
      { slug: 'demo', reasons: ['pin-missing'] },
    ]);
    expect(calls).toEqual([]);
  });

  test('follows five redirects and refuses a sixth, HTTP, userinfo and loops', async () => {
    await writeRecipe('demo', { accepted: true });
    const start = tarballUrl(VERSION);
    const hop = (n: number) => `https://registry.example/hop/${n}`;
    const chain = (hops: number, last: string) => {
      const routes: Record<string, () => Response> = {};
      routes[start] = () =>
        new Response(null, {
          status: 302,
          headers: { location: hops > 1 ? hop(1) : last },
        });
      for (let i = 1; i < hops; i += 1)
        routes[hop(i)] = () =>
          new Response(null, {
            status: 302,
            headers: { location: i + 1 < hops ? hop(i + 1) : last },
          });
      return routes;
    };
    const tarball = packageTarball();
    const final = 'https://registry.example/final.tgz';
    const ok = await pinOptions(tarball, {
      ...chain(5, final),
      [final]: () => new Response(tarball),
    });
    const report = await stageAssets(ok.options);
    expect(report.rows[0]?.source).toBe(final);
    for (const [override, message] of [
      [
        { ...chain(6, final), [final]: () => new Response(tarball) },
        'too many redirects',
      ],
      [chain(1, 'http://registry.example/x.tgz'), 'must use https'],
      [chain(1, 'https://user:pw@registry.example/x.tgz'), 'credentials'],
      [{ ...chain(2, start) }, 'redirect loop'],
    ] as const) {
      const failing = await pinOptions(tarball, override);
      const error = await stageError(() => stageAssets(failing.options));
      expect(error.code).toBe('ASSET_LOAD');
      expect(error.message).toContain(message);
    }
  });

  test('reports non-2xx, 429 and offline as asset load failures without retrying', async () => {
    await writeRecipe('demo', { accepted: true });
    const start = tarballUrl(VERSION);
    for (const [response, message] of [
      [() => new Response('gone', { status: 404 }), 'HTTP 404'],
      [() => new Response('slow down', { status: 429 }), 'HTTP 429'],
      [
        () => {
          throw new TypeError('Unable to connect');
        },
        'Unable to connect',
      ],
    ] as const) {
      const { options, calls } = await pinOptions(packageTarball(), {
        [start]: response,
      });
      const error = await stageError(() => stageAssets(options));
      expect(error.code).toBe('ASSET_LOAD');
      expect(error.message).toContain(message);
      expect(calls.filter((call) => call.url === start)).toHaveLength(1);
    }
  });

  test('times out on the per-fetch deadline and on the 6-minute cap', async () => {
    await writeRecipe('demo', { accepted: true });
    const requested: number[] = [];
    const aborted = () => {
      const controller = new AbortController();
      controller.abort(new DOMException('timed out', 'TimeoutError'));
      return controller.signal;
    };
    const hang = (call: Call) =>
      new Promise<Response>((_, reject) => {
        const signal = call.init.signal as AbortSignal;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    const perFetch = await pinOptions(packageTarball(), {
      [tarballUrl(VERSION)]: hang,
    });
    let error = await stageError(() =>
      stageAssets({
        ...perFetch.options,
        timeoutSignal: (ms) => {
          requested.push(ms);
          return ms === TRANSFER_LIMITS.fetchDeadlineMs
            ? aborted()
            : new AbortController().signal;
        },
      }),
    );
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('within 120000 ms');
    expect(requested).toEqual([
      STAGE_DEADLINE_MS,
      TRANSFER_LIMITS.fetchDeadlineMs,
    ]);
    const overall = await pinOptions(packageTarball());
    error = await stageError(() =>
      stageAssets({
        ...overall.options,
        timeoutSignal: (ms) =>
          ms === STAGE_DEADLINE_MS ? aborted() : new AbortController().signal,
      }),
    );
    expect(error.code).toBe('TIMEOUT');
    expect(error.message).toContain('360000 ms cap');
  });

  test('allows the metadata limit and refuses one byte more', async () => {
    await writeRecipe('demo', { accepted: true });
    const url = releaseUrl(baselineSet, 'build-info.json');
    const atLimit = await pinOptions(packageTarball(), {
      [url]: () =>
        new Response(new Uint8Array(TRANSFER_LIMITS.maxMetadataBytes)),
    });
    let error = await stageError(() => stageAssets(atLimit.options));
    expect(error.code).toBe('VERIFY_FAILED');
    const over = await pinOptions(packageTarball(), {
      [url]: () =>
        new Response(new Uint8Array(TRANSFER_LIMITS.maxMetadataBytes + 1)),
    });
    error = await stageError(() => stageAssets(over.options));
    expect(error.code).toBe('LIMIT_EXCEEDED');
  });

  test('refuses another tag, a changed repository with accepted kept and a changed ELF', async () => {
    await writeRecipe('demo', { accepted: true });
    const swapped = await pinOptions(packageTarball(), {
      [releaseUrl(baselineSet, 'build-info.json')]: () =>
        new Response(fixSet.files['build-info.json']),
    });
    let error = await stageError(() => stageAssets(swapped.options));
    expect(error.code).toBe('VERIFY_FAILED');
    expect(error.message).toContain(`tag guest-biome-${baselineSet.key}`);
    await writeRecipe('demo', {
      accepted: true,
      fixRepository: 'https://github.com/biomejs/biome',
    });
    const moved = await pinOptions();
    error = await stageError(() => stageAssets(moved.options));
    expect(error.message).toContain('build-info is for another source');
    await writeRecipe('demo', { accepted: true });
    const elf = await pinOptions(packageTarball(), {
      [objectUrl('biome', fixSet.key)]: () => new Response('\x7fELF-other'),
    });
    error = await stageError(() => stageAssets(elf.options));
    expect(error.code).toBe('VERIFY_FAILED');
  });
});

describe('checkSite (NFR6.4, S4, S9)', () => {
  test('verifies every coi-serviceworker copy and every staged bundle, ja copies included', async () => {
    await writeRecipe('demo');
    await stageAssets(await localOptions());
    const site = path.join(root, 'site');
    const en = path.join(site, 'repro', 'demo');
    const ja = path.join(site, 'ja', 'repro', 'demo');
    for (const target of [en, ja]) {
      await mkdir(target, { recursive: true });
      cpSync(
        path.join(layer1, 'demo', '_formicarium'),
        path.join(target, '_formicarium'),
        { recursive: true },
      );
      await writeFile(path.join(target, COI_SERVICEWORKER_FILE), COI_COPY);
    }
    const report = await checkSite(site);
    expect(report).toMatchObject({ coiCopies: 2, bundles: 2 });
    await writeFile(
      path.join(ja, '_formicarium', VERSION, 'runtime', 'web', 'api.js'),
      'x',
    );
    let error = await stageError(() => checkSite(site));
    expect(error.message).toContain('differs from');
    rmSync(path.join(ja, '_formicarium', VERSION, 'runtime', 'web', 'api.js'));
    error = await stageError(() => checkSite(site));
    expect(error.message).toContain('missing');
    await writeFile(path.join(ja, COI_SERVICEWORKER_FILE), 'x');
    error = await stageError(() => checkSite(site));
    expect(error.message).toContain('is not coi-serviceworker');
  });
});

describe('checkSite against the Pages upload of hidden files (Step 18a)', () => {
  const KEEP = { includeHiddenFiles: true };
  const DROP = { includeHiddenFiles: false };

  async function siteWith(files: string[]): Promise<string> {
    const site = path.join(root, 'site');
    for (const file of files) {
      await mkdir(path.dirname(path.join(site, file)), { recursive: true });
      await writeFile(path.join(site, file), '{}');
    }
    return site;
  }

  test('lists the hidden files and passes when the upload keeps them', async () => {
    const site = await siteWith([
      'repro/demo/fixture/.prettierrc',
      'repro/demo/.cache/a.json',
      'repro/demo/fixture/biome.json',
    ]);
    const report = await checkSite(site, undefined, KEEP);
    expect(report.hiddenFiles).toEqual([
      'repro/demo/.cache/a.json',
      'repro/demo/fixture/.prettierrc',
    ]);
  });

  test('fails and names the file when the upload would drop a hidden file', async () => {
    const site = await siteWith(['repro/demo/fixture/.prettierrc']);
    const error = await stageError(() => checkSite(site, undefined, DROP));
    expect(error.code).toBe('VERIFY_FAILED');
    expect(error.message).toContain('repro/demo/fixture/.prettierrc');
    expect(error.message).toContain('include-hidden-files: false');
  });

  test('fails on .git and .github even when hidden files are kept', async () => {
    for (const dir of ['.git', '.github']) {
      rmSync(path.join(root, 'site'), { recursive: true, force: true });
      const site = await siteWith([`repro/${dir}/x.json`]);
      const error = await stageError(() => checkSite(site, undefined, KEEP));
      expect(error.message).toContain(`repro/${dir}/x.json`);
    }
  });

  test('passes a site without hidden files whatever the setting', async () => {
    const site = await siteWith(['repro/demo/fixture/biome.json']);
    expect((await checkSite(site, undefined, DROP)).hiddenFiles).toEqual([]);
  });

  test('reads include-hidden-files from the single upload step of a workflow', async () => {
    const workflow = path.join(root, 'flow.yml');
    const flow = (value: string) =>
      `jobs:\n  build:\n    steps:\n      - uses: actions/upload-pages-artifact@abc\n        with:\n          path: docs/doc_build\n${value}`;
    await writeFile(workflow, flow(''));
    expect(readUploadSettings(workflow)).toEqual(DROP);
    await writeFile(workflow, flow('          include-hidden-files: true\n'));
    expect(readUploadSettings(workflow)).toEqual(KEEP);
    await writeFile(workflow, flow("          include-hidden-files: 'true'\n"));
    expect(readUploadSettings(workflow)).toEqual(KEEP);
    await writeFile(workflow, 'jobs:\n  build:\n    steps: []\n');
    expect(() => readUploadSettings(workflow)).toThrow(StageError);
  });

  test('a site with a fixture dotfile passes under the deploy-docs upload setting', async () => {
    const site = await siteWith([
      'repro/biome/migrate-override-bracket-spacing/fixture/.prettierrc',
    ]);
    const report = await checkSite(site, undefined, readUploadSettings());
    expect(report.hiddenFiles).toHaveLength(1);
  });
});
