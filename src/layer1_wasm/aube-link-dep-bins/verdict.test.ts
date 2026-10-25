import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  BIN_COMMAND,
  BUILDER_NODE_MODULES,
  buildEnvelope,
  COMMANDS,
  type CommandResult,
  type CommandRunner,
  canonicalJson,
  commandSha256,
  decide,
  fixtureSha256,
  type Outcome,
  parseListing,
  readListing,
  runSession,
  SessionError,
  settle,
  stripAnsi,
} from './verdict.ts';

const BUILDER_MANIFEST =
  '{"name":"builder","version":"1.0.0","dependencies":{"linked-tool":"link:../linked-tool"}}\n';
const ESC = String.fromCharCode(27);
const LIST = `ls ${BUILDER_NODE_MODULES}`;
const BASELINE_LISTING =
  'builder/\nlinked-tool -> /work/app/vendor/linked-tool\n';
const FIX_LISTING = `.bin/\n${BASELINE_LISTING}`;

function runner(
  outputs: Partial<Record<string, Partial<CommandResult>>> = {},
): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(command) {
      calls.push(command);
      const defaults: Record<string, string> = {
        'cat vendor/builder/package.json': BUILDER_MANIFEST,
        'aube install': 'dependencies:\n+ builder@1.0.0\n',
        [LIST]: BASELINE_LISTING,
        [BIN_COMMAND]: 'linked-tool\n',
      };
      return {
        command,
        code: 0,
        output: defaults[command] ?? '',
        ...outputs[command],
      };
    },
  };
}

async function failure(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(SessionError);
    return (error as Error).message;
  }
  throw new Error('expected a SessionError');
}

describe('readListing', () => {
  test('reports whether builder has a .bin beside its dependencies', () => {
    expect(readListing(parseListing(BASELINE_LISTING))).toBe(false);
    expect(readListing(parseListing(FIX_LISTING))).toBe(true);
  });

  test('refuses a listing without builder or the linked dependency', () => {
    expect(() => readListing(['.bin/', 'linked-tool -> x'])).toThrow(
      'builder is not in its own node_modules',
    );
    expect(() => readListing(['.bin/', 'builder/', 'linked-tool/'])).toThrow(
      'linked-tool is not linked beside builder',
    );
  });
});

describe('runSession', () => {
  test('runs the commands in order and reports a missing .bin as reproduced', async () => {
    const terminal = runner();
    const session = await runSession('baseline', terminal, {
      builderManifest: BUILDER_MANIFEST,
    });
    expect(terminal.calls).toEqual([...COMMANDS]);
    expect(session).toMatchObject({
      role: 'baseline',
      listing: ['builder/', 'linked-tool -> /work/app/vendor/linked-tool'],
      hasBinDirectory: false,
      bins: [],
      reproduced: true,
      corrected: false,
    });
    expect(session.commands.map((c) => c.command)).toEqual([...COMMANDS]);
  });

  test('lists .bin only when it exists and corrects on linked-tool through ANSI escapes and CRLF', async () => {
    const coloured = `${ESC}[1m${FIX_LISTING.replace(/\n/g, '\r\n')}${ESC}[0m`;
    const terminal = runner({ [LIST]: { output: coloured } });
    const session = await runSession('fix', terminal, {
      builderManifest: BUILDER_MANIFEST,
    });
    expect(terminal.calls).toEqual([...COMMANDS, BIN_COMMAND]);
    expect(session).toMatchObject({
      hasBinDirectory: true,
      bins: ['linked-tool'],
      corrected: true,
      reproduced: false,
    });
    expect(stripAnsi(`${ESC}[31mred${ESC}[0m`)).toBe('red');
  });

  test('keeps a .bin without linked-tool reproduced', async () => {
    const session = await runSession(
      'fix',
      runner({
        [LIST]: { output: FIX_LISTING },
        [BIN_COMMAND]: { output: 'other-tool\n' },
      }),
      { builderManifest: BUILDER_MANIFEST },
    );
    expect(session).toMatchObject({
      hasBinDirectory: true,
      bins: ['other-tool'],
      corrected: false,
      reproduced: true,
    });
  });

  test('fails on a changed fixture, a failed install and an unexpected layout', async () => {
    const fixture = { builderManifest: BUILDER_MANIFEST };
    expect(
      await failure(
        runSession(
          'baseline',
          runner({ 'cat vendor/builder/package.json': { output: '{}\n' } }),
          fixture,
        ),
      ),
    ).toBe('baseline: vendor/builder/package.json differs from the fixture');
    expect(
      await failure(
        runSession('fix', runner({ 'aube install': { code: 1 } }), fixture),
      ),
    ).toBe('fix: aube install exited 1');
    expect(
      await failure(
        runSession('fix', runner({ [LIST]: { code: 1, output: '' } }), fixture),
      ),
    ).toBe(`fix: ${LIST} exited 1`);
    expect(
      await failure(
        runSession('fix', runner({ [LIST]: { output: '.bin/\n' } }), fixture),
      ),
    ).toBe('fix: builder is not in its own node_modules');
  });
});

function ok(corrected: boolean): Outcome {
  return {
    ok: true,
    session: {
      role: 'baseline',
      commands: [],
      listing: [],
      hasBinDirectory: corrected,
      bins: corrected ? ['linked-tool'] : [],
      reproduced: !corrected,
      corrected,
    },
  };
}

describe('decide', () => {
  test('decides the verdict from the baseline alone', () => {
    expect(decide(ok(false), ok(true))).toEqual({
      verdict: 'reproduced',
      fixStatus: 'ok',
      baselineError: null,
      fixError: null,
      baselineCorrected: false,
    });
    expect(decide(ok(false), ok(false))).toMatchObject({
      verdict: 'reproduced',
      fixStatus: 'error',
      fixError: "fix: builder's .bin has no linked-tool",
    });
  });

  test('records a corrected baseline as unreproduced, not as a pass', () => {
    expect(decide(ok(true), ok(true))).toEqual({
      verdict: 'unreproduced',
      fixStatus: 'ok',
      baselineError: null,
      fixError: null,
      baselineCorrected: true,
    });
  });

  test('turns a failure into an error, never a verdict', async () => {
    const failed = await settle(Promise.reject(new SessionError('boom')));
    expect(failed).toEqual({ ok: false, error: 'boom' });
    expect(decide(failed, failed)).toEqual({
      verdict: 'unreproduced',
      fixStatus: 'error',
      baselineError: 'boom',
      fixError: 'boom',
      baselineCorrected: false,
    });
  });
});

describe('digests', () => {
  const encoder = new TextEncoder();
  const manifest = encoder.encode(BUILDER_MANIFEST);
  const app = encoder.encode('{}\n');

  test('gives the same fixture digest for the same files in any order', async () => {
    const a = await fixtureSha256([
      { path: 'vendor/builder/package.json', bytes: manifest },
      { path: 'package.json', bytes: app },
    ]);
    const b = await fixtureSha256([
      { path: 'package.json', bytes: app },
      { path: 'vendor/builder/package.json', bytes: manifest },
    ]);
    expect(a).toBe(b);
    const sha = (bytes: Uint8Array | string) =>
      createHash('sha256').update(bytes).digest('hex');
    expect(a).toBe(
      sha(
        `[{"path":"package.json","sha256":"${sha(app)}"},{"path":"vendor/builder/package.json","sha256":"${sha(manifest)}"}]`,
      ),
    );
    expect(
      await fixtureSha256([
        { path: 'vendor/builder/package.json', bytes: manifest },
        { path: 'package.json', bytes: encoder.encode('{ }\n') },
      ]),
    ).not.toBe(a);
  });

  test('gives a stable command digest that follows the order', async () => {
    expect(await commandSha256(COMMANDS)).toBe(
      await commandSha256([...COMMANDS]),
    );
    expect(await commandSha256([...COMMANDS].reverse())).not.toBe(
      await commandSha256(COMMANDS),
    );
  });

  test('normalizes like the build-info rule and refuses what it cannot', async () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe(
      '{"a":[true,null,"x"],"b":1}',
    );
    expect(() => canonicalJson({ a: 1.5 })).toThrow('safe integers');
    expect(() => canonicalJson('\uD800')).toThrow('lone surrogate');
    await expect(
      fixtureSha256([
        { path: 'a', bytes: app },
        { path: 'a', bytes: app },
      ]),
    ).rejects.toThrow('repeats a');
  });
});

describe('buildEnvelope', () => {
  test('reports formicarium, the pinned version and the identities in extras', () => {
    const started = new Date('2026-10-19T00:00:00.000Z');
    const finished = new Date('2026-10-19T00:00:01.500Z');
    const envelope = buildEnvelope({
      decision: decide(ok(false), ok(true)),
      baseline: null,
      fix: null,
      upstreamUrl: 'https://github.com/aubepkg/aube',
      packageVersion: '0.3.0',
      packSha256: 'p'.repeat(64),
      fixtureSha256: 'f'.repeat(64),
      guests: {
        baseline: { commit: 'a'.repeat(40), buildKey: 'b'.repeat(64) },
        fix: { commit: 'c'.repeat(40), buildKey: 'd'.repeat(64) },
      },
      startedAt: started,
      finishedAt: finished,
    });
    expect(envelope).toMatchObject({
      contract: 'v1',
      bug: { project: 'aube', issue: 0 },
      runtime: {
        name: 'formicarium',
        version: '0.3.0',
        extras: {
          fixture_sha256: 'f'.repeat(64),
          baseline_commit: 'a'.repeat(40),
          baseline_build_key: 'b'.repeat(64),
          fix_commit: 'c'.repeat(40),
          fix_build_key: 'd'.repeat(64),
          pack_sha256: 'p'.repeat(64),
        },
      },
      result: {
        baseline_error: null,
        fix_error: null,
        baseline_corrected: false,
      },
      timing: { duration_ms: 1500, started_at: '2026-10-19T00:00:00.000Z' },
    });
    for (const value of Object.values(envelope.runtime.extras))
      expect(typeof value).toBe('string');
  });
});
