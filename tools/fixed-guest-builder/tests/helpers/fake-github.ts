import { fail } from '../../src/errors.ts';
import type {
  GitHubApi,
  Release,
  ReleaseAsset,
  WorkflowRun,
} from '../../src/github.ts';

export class FakeGitHub implements GitHubApi {
  releases: Release[] = [];
  blobs = new Map<number, Uint8Array>();
  runs: WorkflowRun[] = [];
  writes: string[] = [];
  failUploadOf: string | undefined;
  corruptDownloadOf: string | undefined;
  private next = 1;

  addPublished(tag: string, files: Record<string, Uint8Array>): Release {
    const release: Release = { id: this.next++, tag, draft: false, assets: [] };
    for (const [name, bytes] of Object.entries(files)) {
      const asset = { id: this.next++, name };
      this.blobs.set(asset.id, bytes);
      release.assets.push(asset);
    }
    this.releases.push(release);
    return release;
  }

  async findRelease(tag: string) {
    const release = this.releases.find((item) => item.tag === tag);
    return release === undefined
      ? null
      : { ...release, assets: [...release.assets] };
  }

  async createDraft(tag: string) {
    this.writes.push(`create ${tag}`);
    const release: Release = { id: this.next++, tag, draft: true, assets: [] };
    this.releases.push(release);
    return { ...release, assets: [] };
  }

  async uploadAsset(
    release: Release,
    name: string,
    bytes: Uint8Array,
  ): Promise<ReleaseAsset> {
    this.writes.push(`upload ${name}`);
    if (this.failUploadOf === name) fail('EXTERNAL', 'upload failed');
    const stored = this.releases.find((item) => item.id === release.id);
    if (stored === undefined || !stored.draft)
      throw new Error('upload to a non-draft');
    const asset = { id: this.next++, name };
    this.blobs.set(
      asset.id,
      this.corruptDownloadOf === name
        ? new TextEncoder().encode('corrupt')
        : bytes,
    );
    stored.assets.push(asset);
    return asset;
  }

  async downloadAsset(asset: ReleaseAsset) {
    const bytes = this.blobs.get(asset.id);
    if (bytes === undefined) fail('EXTERNAL', 'asset missing');
    return bytes;
  }

  async publish(release: Release) {
    this.writes.push(`publish ${release.tag}`);
    const stored = this.releases.find((item) => item.id === release.id);
    if (stored === undefined) throw new Error('publish of a missing release');
    stored.draft = false;
  }

  async deleteDraft(release: Release) {
    const stored = this.releases.find((item) => item.id === release.id);
    if (stored === undefined) return;
    if (!stored.draft) throw new Error('tried to delete a published release');
    this.writes.push(`delete ${release.tag}`);
    this.releases = this.releases.filter((item) => item.id !== release.id);
  }

  reviewers = 1;

  async environmentReviewers() {
    return this.reviewers;
  }

  async activeRuns() {
    return this.runs;
  }
}
