import { describe, expect, test } from 'bun:test';
import { verifyArtifactSet } from '../src/artifact.ts';
import { parseAllowlist } from '../src/declaration.ts';
import { BuildError } from '../src/errors.ts';
import { createGitHubApi } from '../src/github.ts';
import {
  checkApprovalGate,
  makePublishPlan,
  publishSet,
  type SetIdentity,
} from '../src/release.ts';
import { releaseTag } from '../src/reuse.ts';
import { SOURCE, sampleSet } from './helpers/artifacts.ts';
import { FakeGitHub } from './helpers/fake-github.ts';

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BuildError) return error.code;
    throw error;
  }
  return undefined;
}

const ALLOW = parseAllowlist({
  schemaVersion: 1,
  repositories: [SOURCE.repository],
});

function setup(elf?: string) {
  const set = sampleSet(elf);
  const identity: SetIdentity = {
    tool: 'biome',
    binary: 'biome',
    key: set.key,
    ...SOURCE,
  };
  const verified = verifyArtifactSet(set.files, set.expected);
  const plan = makePublishPlan({
    identity,
    verified,
    buildRunId: 42,
    rollbackPlan: 'point the recipe back to the previous key',
    approvalReference: 'chat 2026-10-17',
  });
  return { set, identity, plan, tag: releaseTag('biome', set.key) };
}

describe('publishSet', () => {
  test('drafts, verifies the uploaded files, then publishes', async () => {
    const { set, identity, plan, tag } = setup();
    const api = new FakeGitHub();
    const result = await publishSet({
      api,
      identity,
      files: set.files,
      planBytes: plan.bytes,
      approvedPlanSha256: plan.sha256,
      allowlist: ALLOW,
    });
    expect(result.status).toBe('published');
    expect(api.writes).toEqual([
      `create ${tag}`,
      'upload biome',
      'upload build-info.json',
      'upload catalog.json',
      `publish ${tag}`,
    ]);
    expect(api.releases[0]?.draft).toBe(false);
  });

  test('writes nothing when the plan differs from the approved SHA256 or from the artifact', async () => {
    const { set, identity, plan } = setup();
    const api = new FakeGitHub();
    expect(
      await errorCode(
        publishSet({
          api,
          identity,
          files: set.files,
          planBytes: plan.bytes,
          approvedPlanSha256: '0'.repeat(64),
          allowlist: ALLOW,
        }),
      ),
    ).toBe('VERIFY_FAILED');
    const other = setup('\x7fELF-other');
    expect(
      await errorCode(
        publishSet({
          api,
          identity: other.identity,
          files: other.set.files,
          planBytes: plan.bytes,
          approvedPlanSha256: plan.sha256,
          allowlist: ALLOW,
        }),
      ),
    ).toBe('VERIFY_FAILED');
    expect(api.writes).toEqual([]);
  });

  test('writes nothing when the repository has left allowlist.json since the build', async () => {
    const { set, identity, plan, tag } = setup();
    const removed = parseAllowlist({
      schemaVersion: 1,
      repositories: ['https://github.com/jambalaya56562/biome'],
    });
    for (const published of [false, true]) {
      const api = new FakeGitHub();
      if (published)
        api.addPublished(tag, {
          biome: set.files.elf,
          'build-info.json': set.files.buildInfo,
          'catalog.json': set.files.catalog,
        });
      expect(
        await errorCode(
          publishSet({
            api,
            identity,
            files: set.files,
            planBytes: plan.bytes,
            approvedPlanSha256: plan.sha256,
            allowlist: removed,
          }),
        ),
      ).toBe('INVALID_INPUT');
      expect(api.writes).toEqual([]);
    }
  });

  test('only verifies when the key is already published with the same ELF', async () => {
    const { set, identity, plan, tag } = setup();
    const api = new FakeGitHub();
    api.addPublished(tag, {
      biome: set.files.elf,
      'build-info.json': set.files.buildInfo,
      'catalog.json': set.files.catalog,
    });
    const result = await publishSet({
      api,
      identity,
      files: set.files,
      planBytes: plan.bytes,
      approvedPlanSha256: plan.sha256,
      allowlist: ALLOW,
    });
    expect(result.status).toBe('already-published');
    expect(api.writes).toEqual([]);
  });

  test('records NOT_REPRODUCIBLE and keeps the published set when the ELF differs', async () => {
    const { set, identity, plan, tag } = setup();
    // An earlier, internally consistent set for the same key: the key does
    // not depend on the ELF, so a non-reproducible build lands here.
    const earlier = sampleSet('\x7fELF-earlier');
    expect(earlier.key).toBe(set.key);
    const api = new FakeGitHub();
    api.addPublished(tag, {
      biome: earlier.files.elf,
      'build-info.json': earlier.files.buildInfo,
      'catalog.json': earlier.files.catalog,
    });
    expect(
      await errorCode(
        publishSet({
          api,
          identity,
          files: set.files,
          planBytes: plan.bytes,
          approvedPlanSha256: plan.sha256,
          allowlist: ALLOW,
        }),
      ),
    ).toBe('NOT_REPRODUCIBLE');
    expect(api.releases).toHaveLength(1);
    expect(api.writes).toEqual([]);
  });

  test('marks the key unusable when the published set fails verification', async () => {
    const { set, identity, plan, tag } = setup();
    const api = new FakeGitHub();
    api.addPublished(tag, {
      biome: new TextEncoder().encode('\x7fELF-tampered'),
      'build-info.json': set.files.buildInfo,
      'catalog.json': set.files.catalog,
    });
    expect(
      await errorCode(
        publishSet({
          api,
          identity,
          files: set.files,
          planBytes: plan.bytes,
          approvedPlanSha256: plan.sha256,
          allowlist: ALLOW,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
    expect(api.writes).toEqual([]);
  });

  test('marks the key unusable when the published set is incomplete', async () => {
    const { set, identity, plan, tag } = setup();
    const api = new FakeGitHub();
    api.addPublished(tag, {
      biome: set.files.elf,
      'build-info.json': set.files.buildInfo,
    });
    expect(
      await errorCode(
        publishSet({
          api,
          identity,
          files: set.files,
          planBytes: plan.bytes,
          approvedPlanSha256: plan.sha256,
          allowlist: ALLOW,
        }),
      ),
    ).toBe('UNUSABLE_KEY');
    expect(api.writes).toEqual([]);
  });

  test('replaces a draft left by a failed run', async () => {
    const { set, identity, plan, tag } = setup();
    const api = new FakeGitHub();
    await api.createDraft(tag);
    api.writes = [];
    const result = await publishSet({
      api,
      identity,
      files: set.files,
      planBytes: plan.bytes,
      approvedPlanSha256: plan.sha256,
      allowlist: ALLOW,
    });
    expect(result.status).toBe('published');
    expect(api.writes[0]).toBe(`delete ${tag}`);
    expect(api.releases).toHaveLength(1);
  });

  test('removes its draft and never publishes when an upload fails or uploads back differently', async () => {
    for (const failure of ['upload', 'corrupt'] as const) {
      const { set, identity, plan, tag } = setup();
      const api = new FakeGitHub();
      if (failure === 'upload') api.failUploadOf = 'catalog.json';
      else api.corruptDownloadOf = 'build-info.json';
      expect(
        await errorCode(
          publishSet({
            api,
            identity,
            files: set.files,
            planBytes: plan.bytes,
            approvedPlanSha256: plan.sha256,
            allowlist: ALLOW,
          }),
        ),
      ).toBeDefined();
      expect(api.writes).not.toContain(`publish ${tag}`);
      expect(api.releases).toHaveLength(0);
    }
  });
});

describe('createGitHubApi', () => {
  test('sends the token to the API but not to the asset storage redirect', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = createGitHubApi({
      repository: 'aletheia-works/vivarium',
      token: 'secret-token',
      fetcher: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/releases/assets/7'))
          return new Response(null, {
            status: 302,
            headers: { location: 'https://objects.example/blob?sig=x' },
          });
        return new Response('bytes');
      },
    });
    const bytes = await api.downloadAsset({ id: 7, name: 'biome' }, 10);
    expect(new TextDecoder().decode(bytes)).toBe('bytes');
    expect(
      (calls[0]?.init.headers as Record<string, string> | undefined)
        ?.authorization,
    ).toBe('Bearer secret-token');
    expect(calls[1]?.init.headers).toBeUndefined();
    expect(calls[1]?.init.credentials).toBe('omit');
    expect(await errorCode(api.downloadAsset({ id: 8, name: 'big' }, 2))).toBe(
      'LIMIT_EXCEEDED',
    );
    expect(
      await errorCode(
        api.deleteDraft({ id: 1, tag: 't', draft: false, assets: [] }),
      ),
    ).toBe('INVALID_INPUT');
  });
});

describe('createGitHubApi requests', () => {
  test('lists releases with drafts, creates a draft, uploads, publishes and deletes only drafts', async () => {
    const calls: { url: string; method: string; body: string }[] = [];
    const api = createGitHubApi({
      repository: 'aletheia-works/vivarium',
      token: 'ghs_test_token_value',
      fetcher: async (url, init) => {
        const body =
          init.body instanceof Blob
            ? await init.body.text()
            : String(init.body ?? '');
        calls.push({ url, method: init.method ?? 'GET', body });
        if (url.includes('/releases?per_page=100&page=1'))
          return Response.json([
            {
              id: 3,
              tag_name: 'guest-x',
              draft: true,
              assets: [{ id: 4, name: 'biome' }],
            },
          ]);
        if (url.endsWith('/releases') && init.method === 'POST')
          return Response.json({
            id: 5,
            tag_name: 'guest-y',
            draft: true,
            assets: [],
          });
        if (url.startsWith('https://uploads.github.com/'))
          return Response.json({ id: 6, name: 'biome' });
        if (init.method === 'DELETE')
          return new Response(null, { status: 204 });
        return Response.json({});
      },
    });
    expect(await api.findRelease('guest-x')).toEqual({
      id: 3,
      tag: 'guest-x',
      draft: true,
      assets: [{ id: 4, name: 'biome' }],
    });
    expect(await api.findRelease('guest-missing')).toBeNull();
    const draft = await api.createDraft('guest-y', 'guest-y', 'body');
    expect(
      JSON.parse(
        calls.find(
          (call) => call.method === 'POST' && call.url.endsWith('/releases'),
        )?.body ?? '{}',
      ),
    ).toMatchObject({ draft: true, make_latest: 'false' });
    expect(
      await api.uploadAsset(draft, 'biome', new TextEncoder().encode('elf')),
    ).toEqual({ id: 6, name: 'biome' });
    expect(
      calls.find((call) => call.url.startsWith('https://uploads.github.com/'))
        ?.body,
    ).toBe('elf');
    await api.publish(draft);
    expect(
      JSON.parse(calls.find((call) => call.method === 'PATCH')?.body ?? '{}'),
    ).toEqual({ draft: false, make_latest: 'false' });
    await api.deleteDraft(draft);
    expect(
      calls.some(
        (call) => call.method === 'DELETE' && call.url.endsWith('/releases/5'),
      ),
    ).toBe(true);
  });

  test('reports HTTP errors and network failures as EXTERNAL', async () => {
    const failing = createGitHubApi({
      repository: 'a/b',
      token: 'ghs_test_token_value',
      fetcher: async () => new Response('no', { status: 403 }),
    });
    expect(await errorCode(failing.createDraft('t', 't', 'b'))).toBe(
      'EXTERNAL',
    );
    expect(
      await errorCode(
        failing.deleteDraft({ id: 1, tag: 't', draft: true, assets: [] }),
      ),
    ).toBe('EXTERNAL');
    const offline = createGitHubApi({
      repository: 'a/b',
      token: 'ghs_test_token_value',
      fetcher: async () => {
        throw new TypeError('network down');
      },
    });
    expect(await errorCode(offline.findRelease('t'))).toBe('EXTERNAL');
  });

  test('reads a run, its latest jobs and its artifacts, and refuses a list longer than one page', async () => {
    const urls: string[] = [];
    const pages = { jobs: 2, artifacts: 1 };
    const api = createGitHubApi({
      repository: 'aletheia-works/vivarium',
      token: 'ghs_test_token_value',
      fetcher: async (url) => {
        urls.push(url);
        if (url.includes('/jobs'))
          return Response.json({
            total_count: pages.jobs,
            jobs: [
              {
                name: 'build biome',
                status: 'completed',
                conclusion: 'success',
                id: 3,
                steps: [
                  {
                    name: 'Build or reuse',
                    status: 'completed',
                    conclusion: 'success',
                    number: 5,
                  },
                ],
              },
              {
                name: 'release / prepare',
                status: 'queued',
                conclusion: null,
                id: 4,
              },
            ],
          });
        if (url.includes('/artifacts'))
          return Response.json({
            total_count: pages.artifacts,
            artifacts: [{ name: 'fixed-guest-9', expired: false, id: 4 }],
          });
        return Response.json({
          id: 9,
          repository: { full_name: 'aletheia-works/vivarium' },
          head_repository: null,
          path: '.github/workflows/fixed-guest-build.yml',
          head_branch: 'main',
          event: 'workflow_dispatch',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/aletheia-works/vivarium/actions/runs/9',
          inputs: null,
        });
      },
    });
    expect(await api.workflowRun(9)).toEqual({
      id: 9,
      repository: 'aletheia-works/vivarium',
      headRepository: null,
      path: '.github/workflows/fixed-guest-build.yml',
      headBranch: 'main',
      event: 'workflow_dispatch',
      status: 'completed',
      conclusion: 'success',
      htmlUrl: 'https://github.com/aletheia-works/vivarium/actions/runs/9',
    });
    expect(await api.runJobs(9)).toEqual([
      {
        name: 'build biome',
        status: 'completed',
        conclusion: 'success',
        steps: [
          {
            name: 'Build or reuse',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      },
      {
        name: 'release / prepare',
        status: 'queued',
        conclusion: null,
        steps: [],
      },
    ]);
    expect(await api.runArtifacts(9)).toEqual([
      { name: 'fixed-guest-9', expired: false },
    ]);
    expect(urls[1]).toContain('/actions/runs/9/jobs?filter=latest');
    pages.jobs = 101;
    pages.artifacts = 101;
    expect(await errorCode(api.runJobs(9))).toBe('EXTERNAL');
    expect(await errorCode(api.runArtifacts(9))).toBe('EXTERNAL');
  });
});

describe('checkApprovalGate', () => {
  test('refuses when the environment has no required reviewers', async () => {
    const api = new FakeGitHub();
    api.reviewers = 0;
    expect(await errorCode(checkApprovalGate(api))).toBe('INVALID_INPUT');
    api.reviewers = 1;
    await checkApprovalGate(api);
  });

  test('counts only required reviewers and treats a missing environment as none', async () => {
    const answer =
      (body: unknown, status = 200) =>
      async () =>
        status === 200 ? Response.json(body) : new Response('{}', { status });
    const make = (fetcher: () => Promise<Response>) =>
      createGitHubApi({
        repository: 'a/b',
        token: 'ghs_test_token_value',
        fetcher,
      });
    expect(
      await make(
        answer({
          protection_rules: [
            { type: 'wait_timer' },
            { type: 'required_reviewers', reviewers: [{}, {}] },
          ],
        }),
      ).environmentReviewers('fixed-guest-release'),
    ).toBe(2);
    expect(
      await make(answer({ protection_rules: [] })).environmentReviewers('x'),
    ).toBe(0);
    expect(await make(answer({}, 404)).environmentReviewers('x')).toBe(0);
    expect(
      await errorCode(make(answer({}, 500)).environmentReviewers('x')),
    ).toBe('EXTERNAL');
  });
});
