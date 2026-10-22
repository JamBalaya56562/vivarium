import { describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BuildError } from '../src/errors.ts';
import { sha256Hex } from '../src/key.ts';
import {
  deriveSet,
  preparePlan,
  ROLLBACK_PLAN,
  renderSummary,
} from '../src/prepare.ts';
import { checkPlan } from '../src/release.ts';
import { assetsOf, SOURCE, sampleSet } from './helpers/artifacts.ts';
import { FakeGitHub } from './helpers/fake-github.ts';
import { tempDir } from './helpers/git.ts';

const BUILD_RUN = 39178190974;
const RELEASE_RUN = 39200000001;
const RUN_URL = `https://github.com/aletheia-works/vivarium/actions/runs/${BUILD_RUN}`;
const TOOLS = await Bun.file(new URL('../tools.json', import.meta.url)).json();

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return 'none';
}

function receiptFor(
  set: ReturnType<typeof sampleSet>,
  compiled = true,
): Record<string, unknown> {
  const sha = (bytes: Uint8Array) => sha256Hex(bytes);
  return {
    schemaVersion: 1,
    buildKey: set.key,
    tag: `guest-biome-${set.key}`,
    compiled,
    elfSha256: sha(set.files.elf),
    buildInfoSha256: sha(set.files.buildInfo),
    catalogSha256: sha(set.files.catalog),
    artifactDirectory: compiled
      ? `/home/runner/work/_temp/fgb-out/${set.key}`
      : null,
    source: SOURCE,
    sizes: { sourceBytes: 1, dependencyBytes: 1, freeDiskBytes: 1 },
    durationsMs: { total: 1 },
    recordedAt: '2026-10-19T00:34:54.217Z',
    ciRunUrl: RUN_URL,
  };
}

async function buildArtifact(
  options: {
    compiled?: boolean;
    receipt?: (receipt: Record<string, unknown>) => void;
    reference?: Record<string, unknown>;
  } = {},
) {
  const set = sampleSet('\x7fELF-sample', {
    reference: options.reference ?? { ciRunUrl: RUN_URL },
  });
  const root = await tempDir();
  const receipt = receiptFor(set, options.compiled ?? true);
  options.receipt?.(receipt);
  await writeFile(join(root, 'receipt.json'), `${JSON.stringify(receipt)}\n`);
  if (options.compiled ?? true) {
    await mkdir(join(root, set.key));
    for (const [name, bytes] of Object.entries(assetsOf(set.files)))
      await writeFile(join(root, set.key, name), bytes);
  }
  const api = new FakeGitHub();
  api.addBuildRun(BUILD_RUN);
  return { set, root, api };
}

function derive(
  api: FakeGitHub,
  root: string,
  extra: { toolsConfig?: unknown; currentRunId?: number } = {},
) {
  return deriveSet({
    api,
    buildRunId: BUILD_RUN,
    currentRunId: extra.currentRunId ?? RELEASE_RUN,
    artifactDirectory: root,
    toolsConfig: extra.toolsConfig ?? TOOLS,
  });
}

describe('deriveSet and the plan', () => {
  test('derives the identity from the artifact and plans the publish', async () => {
    const { set, root, api } = await buildArtifact();
    const prepared = await derive(api, root);
    expect(prepared.identity).toEqual({
      tool: 'biome',
      binary: 'biome',
      key: set.key,
      repository: SOURCE.repository,
      commit: SOURCE.commit,
    });
    expect(prepared.compiled).toBe(true);
    const plan = preparePlan(prepared, BUILD_RUN, RELEASE_RUN);
    const tag = `guest-biome-${set.key}`;
    expect(plan.plan.targets).toEqual([
      tag,
      `${tag}/biome`,
      `${tag}/build-info.json`,
      `${tag}/catalog.json`,
      `${tag}/LICENSE`,
      `${tag}/THIRD_PARTY_NOTICES.md`,
    ]);
    expect(plan.plan.inputDigests.licenseSha256).toBe(
      sha256Hex(set.files.license),
    );
    expect(plan.plan.inputDigests.noticesSha256).toBe(
      sha256Hex(set.files.notices),
    );
    expect(plan.plan.acceptanceEvidenceIds).toEqual([
      `vivarium-run-${BUILD_RUN}`,
    ]);
    expect(plan.plan.rollbackPlanDigest).toBe(sha256Hex(ROLLBACK_PLAN));
    expect(plan.plan.approvalReference).toContain(String(RELEASE_RUN));
    expect(
      checkPlan(plan.bytes, plan.sha256, prepared.identity, prepared.verified)
        .operationId,
    ).toBe(plan.plan.operationId);
  });

  test('the summary shows the plan, its SHA256 and every digest', async () => {
    const { root, api } = await buildArtifact();
    const prepared = await derive(api, root);
    const plan = preparePlan(prepared, BUILD_RUN, RELEASE_RUN);
    const summary = renderSummary(prepared, plan);
    for (const value of [
      plan.sha256,
      prepared.verified.elfSha256,
      prepared.verified.buildInfoSha256,
      prepared.verified.catalogSha256,
      prepared.verified.licenseSha256,
      prepared.verified.noticesSha256,
      prepared.identity.key,
      RUN_URL,
      new TextDecoder().decode(plan.bytes),
    ])
      expect(summary).toContain(value);
  });

  test('refuses a run of another workflow, branch, event, repository or an unfinished run', async () => {
    const changes: ((run: Record<string, unknown>) => void)[] = [
      (run) => {
        run.path = '.github/workflows/fixed-guest-release.yml';
      },
      (run) => {
        run.headBranch = 'feature';
      },
      (run) => {
        run.event = 'push';
      },
      (run) => {
        run.repository = 'someone/vivarium';
      },
      (run) => {
        run.headRepository = 'someone/vivarium';
      },
      (run) => {
        run.status = 'in_progress';
        run.conclusion = null;
      },
    ];
    for (const change of changes) {
      const { root, api } = await buildArtifact();
      change(api.runDetails.get(BUILD_RUN) as never);
      expect(await errorCode(derive(api, root))).toBe('VERIFY_FAILED');
    }
    const { root, api } = await buildArtifact();
    api.jobs.set(BUILD_RUN, [
      {
        name: 'build biome',
        status: 'completed',
        conclusion: 'failure',
        steps: [],
      },
    ]);
    expect(await errorCode(derive(api, root))).toBe('VERIFY_FAILED');
  });

  test('accepts its own unfinished run once the build job succeeded', async () => {
    const { root, api } = await buildArtifact();
    const run = api.runDetails.get(BUILD_RUN) as { status: string };
    run.status = 'in_progress';
    api.jobs.get(BUILD_RUN)?.push({
      name: 'release / prepare',
      status: 'in_progress',
      conclusion: null,
      steps: [],
    });
    const prepared = await derive(api, root, { currentRunId: BUILD_RUN });
    expect(prepared.identity.tool).toBe('biome');
  });

  test('refuses a receipt that disagrees with build-info, the run or the files', async () => {
    const receipts: ((receipt: Record<string, unknown>) => void)[] = [
      (receipt) => {
        receipt.source = { ...SOURCE, commit: 'c'.repeat(40) };
      },
      (receipt) => {
        receipt.ciRunUrl = `${RUN_URL}1`;
      },
      (receipt) => {
        receipt.elfSha256 = 'd'.repeat(64);
      },
      (receipt) => {
        receipt.tag = `guest-other-${receipt.buildKey}`;
      },
    ];
    for (const change of receipts) {
      const { root, api } = await buildArtifact({ receipt: change });
      expect(await errorCode(derive(api, root))).toBe('VERIFY_FAILED');
    }
    const other = await buildArtifact({
      reference: { ciRunUrl: `${RUN_URL}1` },
    });
    expect(await errorCode(derive(other.api, other.root))).toBe(
      'VERIFY_FAILED',
    );
    const tampered = await buildArtifact();
    await writeFile(
      join(tampered.root, tampered.set.key, 'biome'),
      new TextEncoder().encode('\x7fELF-other'),
    );
    expect(await errorCode(derive(tampered.api, tampered.root))).toBe(
      'VERIFY_FAILED',
    );
  });

  test('refuses a tool that tools.json does not configure', async () => {
    const { root, api } = await buildArtifact();
    expect(
      await errorCode(
        derive(api, root, { toolsConfig: { ...TOOLS, tools: {} } }),
      ),
    ).toBe('INVALID_INPUT');
    expect(
      await errorCode(
        derive(api, root, {
          toolsConfig: {
            ...TOOLS,
            tools: { biome: { ...TOOLS.tools.biome, binary: 'biome2' } },
          },
        }),
      ),
    ).toBe('VERIFY_FAILED');
  });

  test('refuses a missing artifact, receipt or set file, and stray files', async () => {
    const listed = await buildArtifact();
    listed.api.artifacts.set(BUILD_RUN, []);
    expect(await errorCode(derive(listed.api, listed.root))).toBe(
      'VERIFY_FAILED',
    );
    const noReceipt = await buildArtifact();
    await rm(join(noReceipt.root, 'receipt.json'));
    expect(await errorCode(derive(noReceipt.api, noReceipt.root))).toBe(
      'VERIFY_FAILED',
    );
    for (const name of ['catalog.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      const missing = await buildArtifact();
      await rm(join(missing.root, missing.set.key, name));
      expect(await errorCode(derive(missing.api, missing.root))).toBe(
        'VERIFY_FAILED',
      );
    }
    const stray = await buildArtifact();
    await writeFile(join(stray.root, 'extra.txt'), 'x');
    expect(await errorCode(derive(stray.api, stray.root))).toBe(
      'VERIFY_FAILED',
    );
  });

  test('for a reused key, takes the published set and refuses an unpublished one', async () => {
    const { set, root, api } = await buildArtifact({ compiled: false });
    const tag = `guest-biome-${set.key}`;
    const served = assetsOf(set.files) as Record<
      string,
      Uint8Array<ArrayBuffer>
    >;
    const published = async (url: string) => {
      if (url.endsWith(`/releases/tags/${tag}`))
        return Response.json({
          draft: false,
          assets: Object.keys(served).map((name) => ({ name })),
        });
      const name = url.split('/').pop() as string;
      const bytes = served[name];
      return bytes === undefined
        ? new Response('missing', { status: 404 })
        : new Response(bytes);
    };
    const prepared = await deriveSet({
      api,
      buildRunId: BUILD_RUN,
      currentRunId: RELEASE_RUN,
      artifactDirectory: root,
      toolsConfig: TOOLS,
      fetcher: published,
    });
    expect(prepared.compiled).toBe(false);
    expect(prepared.files.elf).toEqual(set.files.elf);
    expect(
      await errorCode(
        deriveSet({
          api,
          buildRunId: BUILD_RUN,
          currentRunId: RELEASE_RUN,
          artifactDirectory: root,
          toolsConfig: TOOLS,
          fetcher: async () => new Response('{}', { status: 404 }),
        }),
      ),
    ).toBe('VERIFY_FAILED');
  });
});
