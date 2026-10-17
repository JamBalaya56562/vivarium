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

export interface WorkflowRun {
  id: number;
  status: string;
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
  activeRuns(workflowFile: string): Promise<WorkflowRun[]>;
  environmentReviewers(name: string): Promise<number>;
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
    async environmentReviewers(name) {
      const response = await call(
        `${api}/environments/${encodeURIComponent(name)}`,
      );
      if (response.status === 404) return 0;
      if (!response.ok)
        fail('EXTERNAL', `environment lookup returned HTTP ${response.status}`);
      const environment = (await response.json()) as {
        protection_rules?: { type?: string; reviewers?: unknown[] }[];
      };
      return (environment.protection_rules ?? [])
        .filter((rule) => rule.type === 'required_reviewers')
        .reduce((total, rule) => total + (rule.reviewers?.length ?? 0), 0);
    },
  };
}
