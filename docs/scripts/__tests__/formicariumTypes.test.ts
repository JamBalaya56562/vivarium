import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REPO_ROOT } from '../site-paths';
import { readNpmTarball } from '../stage-formicarium-assets';

const TARBALL = process.env.FORMICARIUM_LOCAL_TARBALL;
const TSC = path.join(
  REPO_ROOT,
  'src',
  'layer1_wasm',
  'node_modules',
  'typescript',
  'bin',
  'tsc',
);
const DECLARED = path.join(
  REPO_ROOT,
  'src',
  'layer1_wasm',
  '_shared',
  'formicarium_terminal.ts',
);

const missing = !TARBALL
  ? 'FORMICARIUM_LOCAL_TARBALL is not set (no local formicarium tarball)'
  : !existsSync(TARBALL)
    ? `${TARBALL} does not exist`
    : !existsSync(TSC)
      ? 'src/layer1_wasm has no installed TypeScript'
      : null;
if (missing)
  console.warn(
    `formicariumTypes: NOT MEASURED, skipped: ${missing}. This is not a pass.`,
  );

let dir: string | undefined;
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tsc(file: string) {
  return Bun.spawnSync(
    [
      process.execPath,
      TSC,
      '--noEmit',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--noUncheckedIndexedAccess',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--allowImportingTsExtensions',
      '--lib',
      'es2022,dom',
      file,
    ],
    { cwd: dir },
  );
}

describe('the formicarium API vivarium declares matches the tarball types (S2 local mode)', () => {
  test.skipIf(missing !== null)(
    'tsc accepts the tarball functions for FormicariumApi and rejects a wrong type',
    () => {
      dir = mkdtempSync(path.join(tmpdir(), 'vivarium-formicarium-types-'));
      const files = readNpmTarball(
        new Uint8Array(readFileSync(TARBALL as string)),
      );
      const types = files.filter((file) => file.path.startsWith('types/'));
      expect(types.map((file) => file.path).sort()).toContain(
        'types/browser.d.ts',
      );
      for (const file of types) {
        const target = path.join(dir, file.path);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, file.bytes);
      }
      const header = [
        "import type * as Browser from './types/browser.js';",
        "import type * as Public from './types/index.js';",
        `import type { FormicariumApi, FsEntry } from ${JSON.stringify(DECLARED)};`,
        'declare const pub: typeof Public;',
        'declare const browser: typeof Browser;',
      ];
      writeFileSync(
        path.join(dir, 'check.ts'),
        [
          ...header,
          'const api: FormicariumApi = {',
          '  createSession: browser.createSession,',
          '  validateGuest: pub.validateGuest,',
          '  registerValidatedGuest: pub.registerValidatedGuest,',
          '  createCommandSession: pub.createCommandSession,',
          // formicarium may also return symlink entries, which the recipe never builds.
          '  fixtureToFsEntries: pub.fixtureToFsEntries as (entries: readonly FsEntry[]) => readonly FsEntry[],',
          '  decodeUtf8: pub.decodeUtf8,',
          '};',
          'void api;',
        ].join('\n'),
      );
      writeFileSync(
        path.join(dir, 'wrong.ts'),
        [
          ...header,
          'const decode: FormicariumApi["decodeUtf8"] = pub.createCommandSession;',
          'void decode;',
        ].join('\n'),
      );
      const ok = tsc('check.ts');
      expect({
        code: ok.exitCode,
        out: `${ok.stdout.toString()}${ok.stderr.toString()}`,
      }).toEqual({ code: 0, out: '' });
      const wrong = tsc('wrong.ts');
      expect(wrong.exitCode).not.toBe(0);
      expect(wrong.stdout.toString()).toContain('wrong.ts');
    },
    60_000,
  );
});
