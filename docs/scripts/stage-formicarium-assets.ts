#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import {
  MAX_CATALOG_BYTES,
  MAX_ELF_BYTES,
  MAX_METADATA_BYTES,
  verifyArtifactSet,
} from '../../tools/fixed-guest-builder/src/artifact.ts';
import { BuildError } from '../../tools/fixed-guest-builder/src/errors.ts';
import {
  type Fetcher,
  fetchLimited,
} from '../../tools/fixed-guest-builder/src/http.ts';
import {
  assetUrl,
  BUILD_INFO_ASSET,
  CATALOG_ASSET,
  RELEASE_REPOSITORY,
  releaseTag,
} from '../../tools/fixed-guest-builder/src/reuse.ts';
import {
  COI_SERVICEWORKER_FILE,
  coiServiceWorkerProblem,
} from './coi-serviceworker-pin';
import {
  type AcceptedGuest,
  FORMICARIUM_PIN_PATH,
  type FormicariumRecipe,
  type GuestRole,
  loadGuestAllowlist,
  type RecipeGuest,
  readFormicariumRecipe,
  recipeState,
  validateAccepted,
} from './generate-recipes-index';
import { DOCS_DIR, REPO_ROOT } from './site-paths';

export const FORMICARIUM_PACKAGE = '@aletheia-works/formicarium';
export const NPM_REGISTRY = 'https://registry.npmjs.org';
export const LAYER1_DIR = join(REPO_ROOT, 'src', 'layer1_wasm');
export const SITE_DIR = join(DOCS_DIR, 'doc_build');
export const GUEST_TOOLS_PATH = join(
  REPO_ROOT,
  'tools',
  'fixed-guest-builder',
  'tools.json',
);
export const STAGED_BUNDLE_DIR = '_formicarium';
export const STAGED_GUESTS_DIR = 'guests';
export const ASSETS_MANIFEST = 'assets.json';
export const LOCAL_ACCEPTED_ASSET = 'accepted.json';

export const TRANSFER_LIMITS = {
  fetchDeadlineMs: 120_000,
  maxDownloadBytes: 134_217_728,
  maxExpandedBytes: 268_435_456,
  maxElfBytes: MAX_ELF_BYTES,
  maxArchiveEntries: 4096,
  maxMetadataBytes: MAX_METADATA_BYTES,
  maxCatalogBytes: MAX_CATALOG_BYTES,
  maxPathBytes: 4096,
} as const;

// Operational cap on the whole run, stricter than the transfer limits above
// and not a C11 limit; raising it needs a reviewed measurement.
export const STAGE_DEADLINE_MS = 360_000;

export const PAGES_SITE_LIMIT_BYTES = 1_073_741_824;

export const BUNDLE_ENTRIES = {
  public: 'runtime/public.js',
  browser: 'runtime/web/api.js',
  worker: 'runtime/web/package-worker.bundle.js',
  loader: 'assets/blink.mjs',
  wasm: 'assets/blink.wasm',
  buildInfo: 'assets/build-info.json',
  license: 'LICENSE',
  notices: 'THIRD_PARTY_NOTICES.md',
} as const;

export type StageErrorCode =
  | 'INVALID_INPUT'
  | 'LIMIT_EXCEEDED'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'ASSET_LOAD'
  | 'VERIFY_FAILED';

export class StageError extends Error {
  readonly code: StageErrorCode;

  constructor(code: StageErrorCode, message: string) {
    super(message);
    this.name = 'StageError';
    this.code = code;
  }
}

function fail(code: StageErrorCode, message: string): never {
  throw new StageError(code, message);
}

const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkedAdd(total: number, add: number, limit: number, what: string) {
  const sum = total + add;
  if (!Number.isSafeInteger(sum) || sum > limit)
    fail('LIMIT_EXCEEDED', `${what} is larger than ${limit}`);
  return sum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ArchiveLimits {
  maxExpandedBytes: number;
  maxArchiveEntries: number;
  maxPathBytes: number;
}

export function checkArchivePath(
  path: string,
  maxPathBytes = TRANSFER_LIMITS.maxPathBytes,
): void {
  if (new TextEncoder().encode(path).length > maxPathBytes)
    fail('LIMIT_EXCEEDED', `path is longer than ${maxPathBytes} bytes`);
  if (path.length === 0) fail('INVALID_INPUT', 'empty path');
  if (path.includes('\0') || path.includes('\\'))
    fail('INVALID_INPUT', `${JSON.stringify(path)} has a NUL or a backslash`);
  if (path.startsWith('/'))
    fail('INVALID_INPUT', `${JSON.stringify(path)} is absolute`);
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..')
      fail(
        'INVALID_INPUT',
        `${JSON.stringify(path)} has an empty, . or .. segment`,
      );
  }
}

export interface PinnedFile {
  path: string;
  sha256: string;
}

export interface FormicariumPin {
  schemaVersion: 1;
  package: typeof FORMICARIUM_PACKAGE;
  packageVersion: string;
  tarballSha256: string;
  sourceCommit: string;
  files: PinnedFile[];
}

const PIN_FIELDS = [
  'schemaVersion',
  'package',
  'packageVersion',
  'tarballSha256',
  'sourceCommit',
  'files',
];

export function parsePin(value: unknown): FormicariumPin {
  if (!isRecord(value)) fail('INVALID_INPUT', 'pin must be an object');
  const keys = Object.keys(value).sort();
  if (keys.join() !== [...PIN_FIELDS].sort().join())
    fail(
      'INVALID_INPUT',
      `pin needs exactly the fields ${PIN_FIELDS.join(', ')}`,
    );
  if (value.schemaVersion !== 1)
    fail('INVALID_INPUT', 'pin schemaVersion must be 1');
  if (value.package !== FORMICARIUM_PACKAGE)
    fail('INVALID_INPUT', `pin package must be ${FORMICARIUM_PACKAGE}`);
  if (
    typeof value.packageVersion !== 'string' ||
    !VERSION.test(value.packageVersion)
  )
    fail('INVALID_INPUT', 'pin packageVersion must be a released semver');
  if (
    typeof value.tarballSha256 !== 'string' ||
    !SHA256.test(value.tarballSha256)
  )
    fail('INVALID_INPUT', 'pin tarballSha256 must be a SHA256');
  if (
    typeof value.sourceCommit !== 'string' ||
    !COMMIT.test(value.sourceCommit)
  )
    fail('INVALID_INPUT', 'pin sourceCommit must be a full commit');
  if (!Array.isArray(value.files) || value.files.length === 0)
    fail('INVALID_INPUT', 'pin files must be a non-empty array');
  if (value.files.length > TRANSFER_LIMITS.maxArchiveEntries)
    fail('LIMIT_EXCEEDED', 'pin lists more files than an archive may hold');
  const files: PinnedFile[] = [];
  let previous = '';
  for (const raw of value.files) {
    if (
      !isRecord(raw) ||
      Object.keys(raw).sort().join() !== 'path,sha256' ||
      typeof raw.path !== 'string' ||
      typeof raw.sha256 !== 'string' ||
      !SHA256.test(raw.sha256)
    )
      fail('INVALID_INPUT', 'pin files entries are {path, sha256}');
    checkArchivePath(raw.path);
    if (raw.path <= previous)
      fail('INVALID_INPUT', 'pin files must be sorted by path without repeats');
    previous = raw.path;
    files.push({ path: raw.path, sha256: raw.sha256 });
  }
  for (const required of Object.values(BUNDLE_ENTRIES)) {
    if (!files.some((file) => file.path === required))
      fail('INVALID_INPUT', `pin files do not list ${required}`);
  }
  return value as unknown as FormicariumPin;
}

export function tarballUrl(version: string): string {
  return `${NPM_REGISTRY}/${FORMICARIUM_PACKAGE}/-/formicarium-${version}.tgz`;
}

export interface ArchiveFile {
  path: string;
  bytes: Uint8Array;
}

const BLOCK = 512;
const TAR_END_SLACK = 10_240;
const decoder = new TextDecoder('utf-8', { fatal: true });

function field(block: Uint8Array, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  try {
    return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
  } catch {
    fail('INVALID_INPUT', 'tar header field is not UTF-8');
  }
}

function octal(block: Uint8Array, start: number, length: number): number {
  if ((block[start] ?? 0) & 0x80)
    fail('INVALID_INPUT', 'tar header uses a base-256 number');
  const text = field(block, start, length).trim();
  if (!/^[0-7]+$/.test(text))
    fail('INVALID_INPUT', 'tar header number is not octal');
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value))
    fail('INVALID_INPUT', 'tar number overflows');
  return value;
}

function isZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0);
}

function parsePax(data: Uint8Array): { path?: string; size?: number } {
  const out: { path?: string; size?: number } = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) fail('INVALID_INPUT', 'pax record has no length');
    const lengthText = String.fromCharCode(...data.subarray(at, space));
    if (!/^[1-9]\d{0,9}$/.test(lengthText))
      fail('INVALID_INPUT', 'pax record length is invalid');
    const end = at + Number(lengthText);
    if (end <= space + 1 || end > data.length || data[end - 1] !== 0x0a)
      fail('INVALID_INPUT', 'pax record is truncated');
    let record: string;
    try {
      record = decoder.decode(data.subarray(space + 1, end - 1));
    } catch {
      fail('INVALID_INPUT', 'pax record is not UTF-8');
    }
    const equals = record.indexOf('=');
    if (equals <= 0) fail('INVALID_INPUT', 'pax record has no key');
    const key = record.slice(0, equals);
    const value = record.slice(equals + 1);
    if (key === 'path') out.path = value;
    if (key === 'size') {
      if (!/^\d{1,15}$/.test(value))
        fail('INVALID_INPUT', 'pax size is not a number');
      out.size = Number(value);
    }
    if (key === 'linkpath') fail('INVALID_INPUT', 'pax header names a link');
    at = end;
  }
  return out;
}

const TYPE_NAMES: Record<string, string> = {
  '1': 'hardlink',
  '2': 'symlink',
  '3': 'character device',
  '4': 'block device',
  '5': 'directory',
  '6': 'FIFO',
  '7': 'contiguous file',
  g: 'global pax header',
  L: 'GNU long name',
  K: 'GNU long link',
};

// Read in memory and checked whole before anything touches the disk, so a
// link or an escaping path in any entry fails the run instead of being skipped.
export function readNpmTarball(
  gzipped: Uint8Array,
  limits: ArchiveLimits = TRANSFER_LIMITS,
): ArchiveFile[] {
  let tar: Uint8Array;
  try {
    tar = gunzipSync(gzipped, {
      maxOutputLength:
        limits.maxExpandedBytes +
        limits.maxArchiveEntries * 2 * BLOCK +
        TAR_END_SLACK,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE')
      fail(
        'LIMIT_EXCEEDED',
        `tarball expands beyond ${limits.maxExpandedBytes} bytes`,
      );
    fail('INVALID_INPUT', 'tarball is not gzip');
  }
  const files: ArchiveFile[] = [];
  const seen = new Set<string>();
  let entries = 0;
  let expanded = 0;
  let pax: { path?: string; size?: number } | null = null;
  let at = 0;
  for (;;) {
    if (at + BLOCK > tar.length)
      fail('INVALID_INPUT', 'tar ends without its end marker');
    const header = tar.subarray(at, at + BLOCK);
    if (isZero(header)) {
      if (pax !== null) fail('INVALID_INPUT', 'pax header has no entry');
      if (!isZero(tar.subarray(at)))
        fail('INVALID_INPUT', 'data after the tar end marker');
      break;
    }
    entries = checkedAdd(
      entries,
      1,
      limits.maxArchiveEntries,
      'archive entry count',
    );
    const stored = octal(header, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1)
      sum += i >= 148 && i < 156 ? 0x20 : (header[i] as number);
    if (sum !== stored) fail('INVALID_INPUT', 'tar header checksum mismatch');
    const magic = field(header, 257, 6);
    if (magic !== 'ustar' && magic !== 'ustar ')
      fail('INVALID_INPUT', 'tar entry is not ustar');
    const type = String.fromCharCode(header[156] as number);
    let size = octal(header, 124, 12);
    if (type === 'x') {
      if (pax !== null) fail('INVALID_INPUT', 'two pax headers in a row');
      expanded = checkedAdd(
        expanded,
        size,
        limits.maxExpandedBytes,
        'expanded archive',
      );
      if (at + BLOCK + size > tar.length)
        fail('INVALID_INPUT', 'pax header is truncated');
      pax = parsePax(tar.subarray(at + BLOCK, at + BLOCK + size));
      at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (type !== '0' && type !== '\0')
      fail(
        'INVALID_INPUT',
        `tar entry ${JSON.stringify(field(header, 0, 100))} is a ${TYPE_NAMES[type] ?? `type ${JSON.stringify(type)}`}, not a regular file`,
      );
    const prefix = field(header, 345, 155);
    const name = field(header, 0, 100);
    const rawPath = pax?.path ?? (prefix ? `${prefix}/${name}` : name);
    if (pax?.size !== undefined) size = pax.size;
    pax = null;
    if (!rawPath.startsWith('package/'))
      fail('INVALID_INPUT', `${JSON.stringify(rawPath)} is outside package/`);
    const path = rawPath.slice('package/'.length);
    checkArchivePath(path, limits.maxPathBytes);
    if (seen.has(path))
      fail('INVALID_INPUT', `${JSON.stringify(path)} appears twice`);
    seen.add(path);
    expanded = checkedAdd(
      expanded,
      size,
      limits.maxExpandedBytes,
      'expanded archive',
    );
    const start = at + BLOCK;
    if (start + size > tar.length)
      fail('INVALID_INPUT', `${path} is truncated`);
    files.push({ path, bytes: tar.slice(start, start + size) });
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

export function verifyArchiveAgainstPin(
  files: readonly ArchiveFile[],
  pin: FormicariumPin,
): Map<string, Uint8Array> {
  const byPath = new Map(files.map((file) => [file.path, file.bytes]));
  const pinned = new Set(pin.files.map((file) => file.path));
  const unlisted = [...byPath.keys()].filter((path) => !pinned.has(path));
  if (unlisted.length > 0)
    fail(
      'VERIFY_FAILED',
      `tarball holds files the pin does not list: ${unlisted.sort().join(', ')}`,
    );
  const absent = pin.files.filter((file) => !byPath.has(file.path));
  if (absent.length > 0)
    fail(
      'VERIFY_FAILED',
      `pin lists files the tarball lacks: ${absent.map((file) => file.path).join(', ')}`,
    );
  for (const file of pin.files) {
    const digest = sha256Hex(byPath.get(file.path) as Uint8Array);
    if (digest !== file.sha256)
      fail(
        'VERIFY_FAILED',
        `${file.path}: SHA256 ${digest} differs from the pin`,
      );
  }
  for (const notice of [BUNDLE_ENTRIES.license, BUNDLE_ENTRIES.notices]) {
    if ((byPath.get(notice)?.byteLength ?? 0) === 0)
      fail(
        'VERIFY_FAILED',
        `${notice} is missing or empty; the site must ship it`,
      );
  }
  let buildInfo: unknown;
  try {
    buildInfo = JSON.parse(
      new TextDecoder().decode(byPath.get(BUNDLE_ENTRIES.buildInfo)),
    );
  } catch {
    fail('VERIFY_FAILED', `${BUNDLE_ENTRIES.buildInfo} is not JSON`);
  }
  const digests = isRecord(buildInfo) ? buildInfo.assetDigests : undefined;
  if (
    !isRecord(digests) ||
    digests.loaderSha256 !==
      sha256Hex(byPath.get(BUNDLE_ENTRIES.loader) as Uint8Array) ||
    digests.wasmSha256 !==
      sha256Hex(byPath.get(BUNDLE_ENTRIES.wasm) as Uint8Array)
  )
    fail(
      'VERIFY_FAILED',
      `${BUNDLE_ENTRIES.buildInfo} does not describe the shipped blink.mjs and blink.wasm`,
    );
  return byPath;
}

export function isStagedBundlePath(path: string): boolean {
  if (path === BUNDLE_ENTRIES.license || path === BUNDLE_ENTRIES.notices)
    return true;
  if (path.startsWith('assets/')) return true;
  return path.startsWith('runtime/') && !path.startsWith('runtime/node/');
}

export interface SummaryRow {
  item: string;
  source: string;
  bytes: number;
  sha256: string;
  ms: number;
}

export interface StageContext {
  fetcher?: Fetcher;
  timeoutSignal?: (ms: number) => AbortSignal;
  now?: () => number;
}

interface RunContext {
  fetcher: Fetcher | undefined;
  timeoutSignal: (ms: number) => AbortSignal;
  now: () => number;
  overall: AbortSignal;
  rows: SummaryRow[];
}

function checkDeadline(ctx: RunContext): void {
  if (ctx.overall.aborted)
    fail('TIMEOUT', `staging passed its ${STAGE_DEADLINE_MS} ms cap`);
}

async function fetchAsset(
  ctx: RunContext,
  item: string,
  url: string,
  limitBytes: number,
): Promise<Uint8Array> {
  checkDeadline(ctx);
  const started = ctx.now();
  const perFetch = ctx.timeoutSignal(TRANSFER_LIMITS.fetchDeadlineMs);
  const signal = AbortSignal.any([ctx.overall, perFetch]);
  try {
    const result = await fetchLimited(url, {
      limitBytes,
      signal,
      ...(ctx.fetcher === undefined ? {} : { fetcher: ctx.fetcher }),
    });
    ctx.rows.push({
      item,
      source: result.finalUrl,
      bytes: result.bytes.byteLength,
      sha256: result.sha256,
      ms: Math.round(ctx.now() - started),
    });
    return result.bytes;
  } catch (error) {
    if (ctx.overall.aborted)
      fail('TIMEOUT', `${url}: staging passed its ${STAGE_DEADLINE_MS} ms cap`);
    if (perFetch.aborted)
      fail(
        'TIMEOUT',
        `${url}: no complete response within ${TRANSFER_LIMITS.fetchDeadlineMs} ms`,
      );
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof BuildError) {
      if (error.code === 'LIMIT_EXCEEDED')
        fail('LIMIT_EXCEEDED', `${url}: ${message}`);
      if (error.code === 'ABORTED') fail('ABORTED', `${url}: ${message}`);
      if (error.code === 'VERIFY_FAILED')
        fail('VERIFY_FAILED', `${url}: ${message}`);
    }
    fail('ASSET_LOAD', `${url}: ${message}`);
  }
}

async function readLocal(
  ctx: RunContext,
  item: string,
  path: string,
  limitBytes: number,
): Promise<Uint8Array> {
  checkDeadline(ctx);
  const started = ctx.now();
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    fail('ASSET_LOAD', `${path}: cannot read`);
  }
  if (size > limitBytes)
    fail('LIMIT_EXCEEDED', `${path} is larger than ${limitBytes} bytes`);
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.byteLength > limitBytes)
    fail('LIMIT_EXCEEDED', `${path} is larger than ${limitBytes} bytes`);
  const sha256 = sha256Hex(bytes);
  ctx.rows.push({
    item,
    source: path,
    bytes: bytes.byteLength,
    sha256,
    ms: Math.round(ctx.now() - started),
  });
  return bytes;
}

export function loadGuestBinaries(
  path = GUEST_TOOLS_PATH,
): Record<string, string> {
  const tools =
    (
      JSON.parse(readFileSync(path, 'utf-8')) as {
        tools?: Record<string, { binary?: unknown }>;
      }
    ).tools ?? {};
  const out: Record<string, string> = {};
  for (const [tool, spec] of Object.entries(tools)) {
    if (
      typeof spec.binary === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(spec.binary)
    )
      out[tool] = spec.binary;
  }
  return out;
}

interface StagedGuest {
  role: GuestRole;
  accepted: AcceptedGuest;
  binary: string;
  elf: Uint8Array;
  buildInfo: Uint8Array;
  catalog: Uint8Array;
}

async function verifyGuest(
  slug: string,
  guest: RecipeGuest,
  binaries: Record<string, string>,
  read: (
    asset: string,
    limitBytes: number,
    item: string,
  ) => Promise<Uint8Array>,
  ctx: RunContext,
): Promise<StagedGuest> {
  const { role, accepted } = guest;
  if (accepted === undefined)
    fail('INVALID_INPUT', `${slug}: ${role} is not accepted`);
  const binary = binaries[guest.tool];
  if (binary === undefined)
    fail('INVALID_INPUT', `${slug}: tool ${guest.tool} is not in tools.json`);
  const label = `${slug} ${role}`;
  const buildInfo = await read(
    BUILD_INFO_ASSET,
    TRANSFER_LIMITS.maxMetadataBytes,
    `${label} build-info`,
  );
  const catalog = await read(
    CATALOG_ASSET,
    TRANSFER_LIMITS.maxCatalogBytes,
    `${label} catalog`,
  );
  const elf = await read(binary, TRANSFER_LIMITS.maxElfBytes, `${label} ELF`);
  checkDeadline(ctx);
  let verified: ReturnType<typeof verifyArtifactSet>;
  try {
    verified = verifyArtifactSet(
      { elf, buildInfo, catalog },
      {
        buildKey: accepted.buildKey,
        tool: guest.tool,
        repository: guest.repository,
        commit: accepted.commit,
      },
    );
  } catch (error) {
    fail(
      'VERIFY_FAILED',
      `${label} (tag ${releaseTag(guest.tool, accepted.buildKey)}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (verified.elfSha256 !== accepted.elfSha256)
    fail(
      'VERIFY_FAILED',
      `${label}: ELF SHA256 ${verified.elfSha256} is not the accepted ${accepted.elfSha256}`,
    );
  if (verified.buildInfoSha256 !== accepted.buildInfoSha256)
    fail(
      'VERIFY_FAILED',
      `${label}: build-info SHA256 ${verified.buildInfoSha256} is not the accepted ${accepted.buildInfoSha256}`,
    );
  if (verified.buildInfo.versionOrName !== accepted.versionOrName)
    fail(
      'VERIFY_FAILED',
      `${label}: build-info versionOrName ${verified.buildInfo.versionOrName} is not the accepted ${accepted.versionOrName}`,
    );
  return { role, accepted, binary, elf, buildInfo, catalog };
}

export interface LocalGuestInput {
  dir: string;
  accepted: unknown;
}

export interface LocalInputs {
  tarballPath: string;
  expected: {
    pin: unknown;
    guests?: Record<string, Partial<Record<GuestRole, LocalGuestInput>>>;
  };
}

export interface StageOptions extends StageContext {
  mode: 'pin' | 'local';
  layer1Dir?: string;
  pinPath?: string;
  local?: LocalInputs;
  summaryPath?: string;
}

export interface StageReport {
  mode: 'pin' | 'local';
  version: string | null;
  staged: { slug: string; bytes: number }[];
  pending: { slug: string; reasons: string[] }[];
  rows: SummaryRow[];
}

function recipesIn(layer1Dir: string, hasPin: boolean): FormicariumRecipe[] {
  const allowlist = loadGuestAllowlist();
  const out: FormicariumRecipe[] = [];
  for (const slug of readdirSync(layer1Dir).sort()) {
    if (slug.startsWith('_') || slug.startsWith('.')) continue;
    const dir = join(layer1Dir, slug);
    if (!statSync(dir).isDirectory()) continue;
    const recipe = readFormicariumRecipe(slug, dir, allowlist, hasPin);
    if (recipe) out.push(recipe);
  }
  return out;
}

function insideDir(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || !(rel.startsWith('..') || isAbsolute(rel));
}

async function writeOutputs(
  recipe: FormicariumRecipe,
  pin: FormicariumPin,
  tarballSha256: string,
  bundle: Map<string, Uint8Array>,
  guests: StagedGuest[],
  mode: 'pin' | 'local',
): Promise<number> {
  const root = join(recipe.dir, STAGED_BUNDLE_DIR);
  const version = pin.packageVersion;
  let bytes = 0;
  const files: PinnedFile[] = [];
  for (const [path, content] of [...bundle.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  )) {
    if (!isStagedBundlePath(path)) continue;
    const target = join(root, version, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    bytes += content.byteLength;
    files.push({ path: `${version}/${path}`, sha256: sha256Hex(content) });
  }
  const manifest = {
    schemaVersion: 1,
    package: FORMICARIUM_PACKAGE,
    version,
    tarballSha256,
    sourceCommit: pin.sourceCommit,
    entries: Object.fromEntries(
      Object.entries(BUNDLE_ENTRIES).map(([name, path]) => [
        name,
        `${version}/${path}`,
      ]),
    ),
    files,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(root, ASSETS_MANIFEST), manifestText);
  bytes += manifestText.length;
  for (const guest of guests) {
    const dir = join(recipe.dir, STAGED_GUESTS_DIR, guest.role);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, guest.binary), guest.elf, { mode: 0o644 });
    await writeFile(join(dir, BUILD_INFO_ASSET), guest.buildInfo);
    await writeFile(join(dir, CATALOG_ASSET), guest.catalog);
    // Only local staging writes it: a pending recipe has no accepted in its
    // recipe.json, and the page falls back to this file for local testing.
    if (mode === 'local')
      await writeFile(
        join(dir, LOCAL_ACCEPTED_ASSET),
        `${JSON.stringify(guest.accepted, null, 2)}\n`,
      );
    bytes +=
      guest.elf.byteLength +
      guest.buildInfo.byteLength +
      guest.catalog.byteLength;
  }
  return bytes;
}

function summaryMarkdown(report: StageReport, failure?: string): string {
  const lines = [
    '### formicarium assets',
    '',
    `Mode: \`${report.mode}\`. Package version: ${report.version ?? 'none (no pin)'}.`,
    '',
  ];
  if (report.rows.length > 0) {
    lines.push(
      '| Item | Source | Bytes | SHA256 | ms |',
      '|---|---|---:|---|---:|',
    );
    for (const row of report.rows)
      lines.push(
        `| ${row.item} | ${row.source} | ${row.bytes} | \`${row.sha256}\` | ${row.ms} |`,
      );
    lines.push('');
  }
  for (const item of report.staged)
    lines.push(`- staged ${item.slug}: ${item.bytes} bytes`);
  for (const item of report.pending)
    lines.push(`- pending ${item.slug}: ${item.reasons.join(', ')}`);
  if (failure) lines.push('', `**Failed:** ${failure}`);
  return `${lines.join('\n')}\n`;
}

export async function stageAssets(options: StageOptions): Promise<StageReport> {
  const layer1Dir = resolve(options.layer1Dir ?? LAYER1_DIR);
  if (insideDir(layer1Dir, SITE_DIR))
    fail('INVALID_INPUT', `staging never writes into ${SITE_DIR}`);
  const timeoutSignal =
    options.timeoutSignal ?? ((ms: number) => AbortSignal.timeout(ms));
  const ctx: RunContext = {
    fetcher: options.fetcher,
    timeoutSignal,
    now: options.now ?? (() => performance.now()),
    overall: timeoutSignal(STAGE_DEADLINE_MS),
    rows: [],
  };
  const report: StageReport = {
    mode: options.mode,
    version: null,
    staged: [],
    pending: [],
    rows: ctx.rows,
  };
  try {
    await stageInto(options, layer1Dir, ctx, report);
  } catch (error) {
    if (options.summaryPath)
      await appendFile(
        options.summaryPath,
        summaryMarkdown(
          report,
          error instanceof Error ? error.message : String(error),
        ),
      );
    throw error;
  }
  if (options.summaryPath)
    await appendFile(options.summaryPath, summaryMarkdown(report));
  return report;
}

async function stageInto(
  options: StageOptions,
  layer1Dir: string,
  ctx: RunContext,
  report: StageReport,
): Promise<void> {
  let pinValue: unknown;
  let hasPin: boolean;
  if (options.mode === 'local') {
    if (options.local === undefined)
      fail('INVALID_INPUT', 'local mode needs its inputs');
    pinValue = options.local.expected.pin;
    hasPin = true;
  } else {
    const pinPath = options.pinPath ?? FORMICARIUM_PIN_PATH;
    hasPin = existsSync(pinPath);
    if (hasPin) {
      try {
        pinValue = JSON.parse(readFileSync(pinPath, 'utf-8'));
      } catch {
        fail('INVALID_INPUT', `${pinPath} is not JSON`);
      }
    }
  }
  const recipes = recipesIn(layer1Dir, hasPin);
  for (const recipe of recipes) {
    await rm(join(recipe.dir, STAGED_BUNDLE_DIR), {
      recursive: true,
      force: true,
    });
    await rm(join(recipe.dir, STAGED_GUESTS_DIR), {
      recursive: true,
      force: true,
    });
  }
  const active: { recipe: FormicariumRecipe; guests: RecipeGuest[] }[] = [];
  for (const recipe of recipes) {
    const guests = recipe.guests.map((guest): RecipeGuest => {
      const input =
        options.mode === 'local'
          ? options.local?.expected.guests?.[recipe.slug]?.[guest.role]
          : undefined;
      if (input === undefined) return guest;
      return {
        ...guest,
        accepted: validateAccepted(
          recipe.slug,
          `expected ${guest.role}`,
          input.accepted,
        ),
      };
    });
    const state = recipeState(guests, hasPin);
    if (state.state === 'pending')
      report.pending.push({ slug: recipe.slug, reasons: state.reasons });
    else active.push({ recipe, guests });
  }
  if (!hasPin) return;
  const pin = parsePin(pinValue);
  report.version = pin.packageVersion;
  const tarball =
    options.mode === 'local'
      ? await readLocal(
          ctx,
          'formicarium tarball',
          resolve((options.local as LocalInputs).tarballPath),
          TRANSFER_LIMITS.maxDownloadBytes,
        )
      : await fetchAsset(
          ctx,
          'formicarium tarball',
          tarballUrl(pin.packageVersion),
          TRANSFER_LIMITS.maxDownloadBytes,
        );
  const tarballSha256 = sha256Hex(tarball);
  if (tarballSha256 !== pin.tarballSha256)
    fail(
      'VERIFY_FAILED',
      `tarball SHA256 ${tarballSha256} is not the pinned ${pin.tarballSha256}`,
    );
  checkDeadline(ctx);
  const bundle = verifyArchiveAgainstPin(readNpmTarball(tarball), pin);
  checkDeadline(ctx);
  const binaries = loadGuestBinaries();
  const prepared: { recipe: FormicariumRecipe; guests: StagedGuest[] }[] = [];
  for (const { recipe, guests: declared } of active) {
    const coiProblem = coiServiceWorkerProblem(
      join(recipe.dir, COI_SERVICEWORKER_FILE),
    );
    if (coiProblem) fail('VERIFY_FAILED', coiProblem);
    const guests: StagedGuest[] = [];
    for (const guest of declared) {
      const accepted = guest.accepted as AcceptedGuest;
      const tag = releaseTag(guest.tool, accepted.buildKey);
      const localDir =
        options.local?.expected.guests?.[recipe.slug]?.[guest.role]?.dir;
      if (options.mode === 'local' && localDir === undefined)
        fail(
          'INVALID_INPUT',
          `${recipe.slug} ${guest.role}: local mode needs a guest dir`,
        );
      const read =
        options.mode === 'local'
          ? (asset: string, limit: number, item: string) =>
              readLocal(ctx, item, resolve(localDir as string, asset), limit)
          : (asset: string, limit: number, item: string) =>
              fetchAsset(
                ctx,
                item,
                assetUrl(RELEASE_REPOSITORY, tag, asset),
                limit,
              );
      guests.push(await verifyGuest(recipe.slug, guest, binaries, read, ctx));
    }
    prepared.push({ recipe, guests });
  }
  checkDeadline(ctx);
  for (const { recipe, guests } of prepared) {
    const bytes = await writeOutputs(
      recipe,
      pin,
      tarballSha256,
      bundle,
      guests,
      options.mode,
    );
    report.staged.push({ slug: recipe.slug, bytes });
  }
}

export interface SiteReport {
  bytes: number;
  coiCopies: number;
  bundles: number;
  hiddenFiles: string[];
}

export const DEPLOY_WORKFLOW_PATH = join(
  REPO_ROOT,
  '.github',
  'workflows',
  'deploy-docs.yml',
);
const UPLOAD_PAGES_ACTION = 'actions/upload-pages-artifact@';
// actions/upload-pages-artifact always passes --exclude=.git and
// --exclude=.github to tar, whatever include-hidden-files says.
const ALWAYS_EXCLUDED = new Set(['.git', '.github']);

export interface UploadSettings {
  includeHiddenFiles: boolean;
}

// check-site runs before the upload, so it reads the upload step's own
// setting instead of a flag that could drift from the workflow.
export function readUploadSettings(
  workflowPath = DEPLOY_WORKFLOW_PATH,
): UploadSettings {
  const flow = Bun.YAML.parse(readFileSync(workflowPath, 'utf-8')) as {
    jobs?: Record<
      string,
      { steps?: { uses?: string; with?: Record<string, unknown> }[] }
    >;
  };
  const uploads = Object.values(flow.jobs ?? {}).flatMap((job) =>
    (job.steps ?? []).filter((step) =>
      step.uses?.startsWith(UPLOAD_PAGES_ACTION),
    ),
  );
  if (uploads.length !== 1)
    fail(
      'INVALID_INPUT',
      `${workflowPath} has ${uploads.length} ${UPLOAD_PAGES_ACTION} steps; expected 1`,
    );
  // The action compares the input as the string 'true'.
  const value = uploads[0]?.with?.['include-hidden-files'];
  return { includeHiddenFiles: value === true || value === 'true' };
}

export function uploadDropsPath(
  relativePath: string,
  settings: UploadSettings,
): boolean {
  return relativePath
    .split(/[\\/]/)
    .some(
      (part) =>
        ALWAYS_EXCLUDED.has(part) ||
        (!settings.includeHiddenFiles && part.startsWith('.')),
    );
}

async function walk(
  dir: string,
  visit: (path: string, size: number) => Promise<void>,
): Promise<void> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink())
      fail('VERIFY_FAILED', `${path} is a symlink; Pages refuses them`);
    if (entry.isDirectory()) await walk(path, visit);
    else if (entry.isFile()) await visit(path, (await stat(path)).size);
  }
}

export async function checkSite(
  siteDir = SITE_DIR,
  summaryPath?: string,
  upload: UploadSettings = readUploadSettings(),
): Promise<SiteReport> {
  if (!existsSync(siteDir)) fail('INVALID_INPUT', `${siteDir} does not exist`);
  const report: SiteReport = {
    bytes: 0,
    coiCopies: 0,
    bundles: 0,
    hiddenFiles: [],
  };
  const manifests: string[] = [];
  await walk(siteDir, async (path, size) => {
    report.bytes = checkedAdd(
      report.bytes,
      size,
      PAGES_SITE_LIMIT_BYTES,
      `site ${siteDir}`,
    );
    const rel = relative(siteDir, path);
    if (rel.split(sep).some((part) => part.startsWith('.')))
      report.hiddenFiles.push(rel.split(sep).join('/'));
    if (path.endsWith(`${sep}${COI_SERVICEWORKER_FILE}`)) {
      const problem = coiServiceWorkerProblem(path);
      if (problem) fail('VERIFY_FAILED', problem);
      report.coiCopies += 1;
    }
    if (path.endsWith(`${sep}${STAGED_BUNDLE_DIR}${sep}${ASSETS_MANIFEST}`))
      manifests.push(path);
  });
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      files?: PinnedFile[];
    };
    const root = dirname(manifestPath);
    for (const file of manifest.files ?? []) {
      checkArchivePath(file.path);
      const path = join(root, file.path);
      if (!existsSync(path))
        fail(
          'VERIFY_FAILED',
          `${path} is listed in ${manifestPath} but missing`,
        );
      const digest = sha256Hex(readFileSync(path));
      if (digest !== file.sha256)
        fail(
          'VERIFY_FAILED',
          `${path}: SHA256 ${digest} differs from ${manifestPath}`,
        );
    }
    for (const notice of [BUNDLE_ENTRIES.license, BUNDLE_ENTRIES.notices]) {
      if (
        !(manifest.files ?? []).some((file) => file.path.endsWith(`/${notice}`))
      )
        fail('VERIFY_FAILED', `${manifestPath} does not ship ${notice}`);
    }
    report.bundles += 1;
  }
  report.hiddenFiles.sort();
  const dropped = report.hiddenFiles.filter((rel) =>
    uploadDropsPath(rel, upload),
  );
  if (dropped.length > 0)
    fail(
      'VERIFY_FAILED',
      `the Pages upload (include-hidden-files: ${upload.includeHiddenFiles}) would drop ${dropped.join(', ')}`,
    );
  if (summaryPath)
    await appendFile(
      summaryPath,
      `### site size\n\n${report.bytes} bytes of ${PAGES_SITE_LIMIT_BYTES}; ${report.coiCopies} coi-serviceworker copies and ${report.bundles} formicarium bundles verified. Hidden files kept by the upload: ${report.hiddenFiles.length === 0 ? 'none' : report.hiddenFiles.map((rel) => `\`${rel}\``).join(', ')}.\n`,
    );
  return report;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string' },
      tarball: { type: 'string' },
      expect: { type: 'string' },
      layer1: { type: 'string' },
      site: { type: 'string' },
    },
    strict: true,
  });
  const summaryPath = process.env.GITHUB_STEP_SUMMARY || undefined;
  if (values.mode === 'check-site') {
    const report = await checkSite(
      values.site ? resolve(values.site) : SITE_DIR,
      summaryPath,
    );
    console.error(
      `Site: ${report.bytes} bytes, ${report.coiCopies} coi-serviceworker copies, ${report.bundles} formicarium bundles.`,
    );
    console.error(
      `Hidden files: ${report.hiddenFiles.length === 0 ? 'none' : report.hiddenFiles.join(', ')}.`,
    );
    return;
  }
  if (values.mode !== 'pin' && values.mode !== 'local')
    fail('INVALID_INPUT', '--mode must be pin, local or check-site');
  if (
    values.mode === 'pin' &&
    (values.tarball || values.expect || values.layer1)
  )
    fail(
      'INVALID_INPUT',
      'pin mode reads only the pin file and the public URLs',
    );
  let local: LocalInputs | undefined;
  if (values.mode === 'local') {
    if (!values.tarball || !values.expect)
      fail('INVALID_INPUT', 'local mode needs --tarball and --expect');
    const expected = JSON.parse(
      readFileSync(values.expect, 'utf-8'),
    ) as LocalInputs['expected'];
    const base = dirname(resolve(values.expect));
    for (const roles of Object.values(expected.guests ?? {}))
      for (const input of Object.values(roles))
        if (input && typeof input.dir === 'string')
          input.dir = resolve(base, input.dir);
    local = { tarballPath: values.tarball, expected };
  }
  const report = await stageAssets({
    mode: values.mode,
    ...(values.layer1 ? { layer1Dir: values.layer1 } : {}),
    ...(local ? { local } : {}),
    ...(summaryPath ? { summaryPath } : {}),
  });
  for (const row of report.rows)
    console.error(
      `${row.item}: ${row.bytes} bytes ${row.sha256} from ${row.source} (${row.ms} ms)`,
    );
  for (const item of report.staged)
    console.error(`Staged ${item.slug}: ${item.bytes} bytes`);
  for (const item of report.pending)
    console.error(`Pending ${item.slug}: ${item.reasons.join(', ')}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    process.exit(1);
  });
}
