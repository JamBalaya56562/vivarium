import { fail } from './errors.ts';
import { defaultFetcher, type Fetcher } from './http.ts';

export interface ReleaseAsset {
  id: number;
  name: string;
}

export interface Release {
  id: number;
  tag: string;
  draft: boolean;
  assets: ReleaseAsset[];
}

export interface ListedRelease {
  id: number;
  tag: string;
  draft: boolean;
  publishedAt: string | null;
}

export interface PullFile {
  filename: string;
  status: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
}

export interface WorkflowRunDetail {
  id: number;
  repository: string;
  headRepository: string | null;
  path: string;
  headBranch: string | null;
  event: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
}

export interface RunStep {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface RunJob {
  name: string;
  status: string;
  conclusion: string | null;
  steps: RunStep[];
}

export interface RunArtifact {
  name: string;
  expired: boolean;
}

export interface GitHubApi {
  // Includes drafts, which only an authenticated listing shows.
  findRelease(tag: string): Promise<Release | null>;
  createDraft(tag: string, name: string, body: string): Promise<Release>;
  uploadAsset(
    release: Release,
    name: string,
    bytes: Uint8Array,
  ): Promise<ReleaseAsset>;
  downloadAsset(asset: ReleaseAsset, limitBytes: number): Promise<Uint8Array>;
  publish(release: Release): Promise<void>;
  deleteDraft(release: Release): Promise<void>;
  listReleases(): Promise<ListedRelease[]>;
  deletePublished(release: ListedRelease): Promise<void>;
  deleteTag(tag: string): Promise<void>;
  guestTags(): Promise<string[]>;
  openPulls(): Promise<number[]>;
  pullFiles(pull: number): Promise<PullFile[]>;
  fileAt(path: string, ref: string): Promise<string | null>;
  activeRuns(workflowFile: string): Promise<WorkflowRun[]>;
  workflowRun(id: number): Promise<WorkflowRunDetail>;
  runJobs(id: number): Promise<RunJob[]>;
  runArtifacts(id: number): Promise<RunArtifact[]>;
}

const ACTIVE = ['in_progress', 'queued', 'waiting', 'pending', 'requested'];

export function createGitHubApi(options: {
  repository: string;
  token: string;
  fetcher?: Fetcher;
}): GitHubApi {
  const fetcher = options.fetcher ?? defaultFetcher;
  const api = `https://api.github.com/repos/${options.repository}`;
  const headers = {
    authorization: `Bearer ${options.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  const call = async (
    url: string,
    init: RequestInit = {},
  ): Promise<Response> => {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        headers: { ...headers, ...(init.headers as Record<string, string>) },
        redirect: 'manual',
      });
    } catch {
      fail('EXTERNAL', 'GitHub API request failed');
    }
    return response;
  };
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const response = await call(url, init);
    if (!response.ok)
      fail('EXTERNAL', `GitHub API returned HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  type RawRelease = {
    id: number;
    tag_name: string;
    draft: boolean;
    assets: { id: number; name: string }[];
  };
  const toRelease = (raw: RawRelease): Release => ({
    id: raw.id,
    tag: raw.tag_name,
    draft: raw.draft,
    assets: raw.assets.map((asset) => ({ id: asset.id, name: asset.name })),
  });
  return {
    async findRelease(tag) {
      for (let page = 1; page <= 10; page += 1) {
        const releases = await json<RawRelease[]>(
          `${api}/releases?per_page=100&page=${page}`,
        );
        const match = releases.find((release) => release.tag_name === tag);
        if (match !== undefined) return toRelease(match);
        if (releases.length < 100) return null;
      }
      fail('EXTERNAL', 'too many releases to search');
    },
    async createDraft(tag, name, body) {
      return toRelease(
        await json<RawRelease>(`${api}/releases`, {
          method: 'POST',
          body: JSON.stringify({
            tag_name: tag,
            name,
            body,
            draft: true,
            prerelease: false,
            make_latest: 'false',
          }),
        }),
      );
    },
    async uploadAsset(release, name, bytes) {
      const url = `https://uploads.github.com/repos/${options.repository}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
      const asset = await json<{ id: number; name: string }>(url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      });
      return { id: asset.id, name: asset.name };
    },
    async downloadAsset(asset, limitBytes) {
      let response = await call(`${api}/releases/assets/${asset.id}`, {
        headers: { accept: 'application/octet-stream' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (location === null || !location.startsWith('https://'))
          fail('EXTERNAL', 'asset redirect is not HTTPS');
        // The storage URL is pre-signed; the token is not sent there.
        response = await fetcher(location, {
          redirect: 'error',
          credentials: 'omit',
        });
      }
      if (!response.ok || response.body === null)
        fail('EXTERNAL', `asset download returned HTTP ${response.status}`);
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.byteLength;
        if (total > limitBytes)
          fail('LIMIT_EXCEEDED', `asset is larger than ${limitBytes} bytes`);
        chunks.push(chunk);
      }
      return new Uint8Array(Buffer.concat(chunks));
    },
    async publish(release) {
      await json(`${api}/releases/${release.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false, make_latest: 'false' }),
      });
    },
    async deleteDraft(release) {
      if (!release.draft)
        fail('INVALID_INPUT', 'only a draft Release may be deleted');
      const response = await call(`${api}/releases/${release.id}`, {
        method: 'DELETE',
      });
      if (response.status !== 204)
        fail('EXTERNAL', `draft delete returned HTTP ${response.status}`);
    },
    async listReleases() {
      const listed: ListedRelease[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const releases = await json<
          {
            id: number;
            tag_name: string;
            draft: boolean;
            published_at: string | null;
          }[]
        >(`${api}/releases?per_page=100&page=${page}`);
        for (const release of releases)
          listed.push({
            id: release.id,
            tag: release.tag_name,
            draft: release.draft,
            publishedAt: release.published_at,
          });
        if (releases.length < 100) return listed;
      }
      fail('EXTERNAL', 'too many releases to list');
    },
    async deletePublished(release) {
      if (release.draft)
        fail('INVALID_INPUT', 'a draft Release belongs to its release run');
      const response = await call(`${api}/releases/${release.id}`, {
        method: 'DELETE',
      });
      if (response.status !== 204)
        fail('EXTERNAL', `release delete returned HTTP ${response.status}`);
    },
    async deleteTag(tag) {
      const response = await call(
        `${api}/git/refs/tags/${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
      );
      if (response.status !== 204 && response.status !== 422)
        fail('EXTERNAL', `tag delete returned HTTP ${response.status}`);
    },
    async guestTags() {
      const refs = await json<{ ref: string }[]>(
        `${api}/git/matching-refs/tags/guest-`,
      );
      return refs.map((item) => item.ref.replace(/^refs\/tags\//, ''));
    },
    async openPulls() {
      const numbers: number[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const pulls = await json<{ number: number }[]>(
          `${api}/pulls?state=open&per_page=100&page=${page}`,
        );
        numbers.push(...pulls.map((pull) => pull.number));
        if (pulls.length < 100) return numbers;
      }
      fail('EXTERNAL', 'too many open pull requests to list');
    },
    async pullFiles(pull) {
      const files: PullFile[] = [];
      for (let page = 1; page <= 30; page += 1) {
        const listed = await json<PullFile[]>(
          `${api}/pulls/${pull}/files?per_page=100&page=${page}`,
        );
        files.push(
          ...listed.map((file) => ({
            filename: file.filename,
            status: file.status,
          })),
        );
        if (listed.length < 100) return files;
      }
      fail('EXTERNAL', `pull request ${pull} has too many files to list`);
    },
    async fileAt(path, ref) {
      const response = await call(
        `${api}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        { headers: { accept: 'application/vnd.github.raw+json' } },
      );
      if (response.status === 404) return null;
      if (!response.ok)
        fail('EXTERNAL', `GitHub API returned HTTP ${response.status}`);
      return response.text();
    },
    async activeRuns(workflowFile) {
      const runs: WorkflowRun[] = [];
      for (const status of ACTIVE) {
        const result = await json<{
          workflow_runs: { id: number; status: string }[];
        }>(
          `${api}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?status=${status}&per_page=100`,
        );
        for (const run of result.workflow_runs)
          runs.push({ id: run.id, status: run.status });
      }
      return runs;
    },
    async workflowRun(id) {
      const run = await json<{
        id: number;
        repository?: { full_name?: string };
        head_repository?: { full_name?: string } | null;
        path: string;
        head_branch: string | null;
        event: string;
        status: string;
        conclusion: string | null;
        html_url: string;
      }>(`${api}/actions/runs/${id}`);
      return {
        id: run.id,
        repository: run.repository?.full_name ?? '',
        headRepository: run.head_repository?.full_name ?? null,
        path: run.path,
        headBranch: run.head_branch,
        event: run.event,
        status: run.status,
        conclusion: run.conclusion,
        htmlUrl: run.html_url,
      };
    },
    async runJobs(id) {
      const result = await json<{
        total_count: number;
        jobs: {
          name: string;
          status: string;
          conclusion: string | null;
          steps?: RunStep[];
        }[];
      }>(`${api}/actions/runs/${id}/jobs?filter=latest&per_page=100`);
      if (result.total_count > result.jobs.length)
        fail('EXTERNAL', 'the run has more jobs than one page');
      return result.jobs.map((job) => ({
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        steps: (job.steps ?? []).map((step) => ({
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
        })),
      }));
    },
    async runArtifacts(id) {
      const result = await json<{
        total_count: number;
        artifacts: { name: string; expired: boolean }[];
      }>(`${api}/actions/runs/${id}/artifacts?per_page=100`);
      if (result.total_count > result.artifacts.length)
        fail('EXTERNAL', 'the build run has more artifacts than one page');
      return result.artifacts.map((artifact) => ({
        name: artifact.name,
        expired: artifact.expired,
      }));
    },
  };
}
