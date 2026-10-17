import {
  type ArtifactSet,
  MAX_CATALOG_BYTES,
  MAX_ELF_BYTES,
  MAX_METADATA_BYTES,
  parseUniqueJson,
  type VerifiedSet,
  verifyArtifactSet,
} from './artifact.ts';
import { BuildError, fail } from './errors.ts';
import type { GitHubApi, Release } from './github.ts';
import { canonicalJson, sha256Hex } from './key.ts';
import { BUILD_INFO_ASSET, CATALOG_ASSET, releaseTag } from './reuse.ts';

export const MAX_PLAN_BYTES = 65_536;

export interface ExternalOperation {
  schemaVersion: 1;
  operationId: string;
  action: 'publish';
  targets: string[];
  inputDigests: Record<string, string>;
  acceptanceEvidenceIds: string[];
  rollbackPlanDigest: string;
  approvalReference: string;
}

export interface SetIdentity {
  tool: string;
  binary: string;
  key: string;
  repository: string;
  commit: string;
}

function targetsFor(identity: SetIdentity): string[] {
  const tag = releaseTag(identity.tool, identity.key);
  return [
    tag,
    `${tag}/${identity.binary}`,
    `${tag}/${BUILD_INFO_ASSET}`,
    `${tag}/${CATALOG_ASSET}`,
  ];
}

function digestsFor(
  identity: SetIdentity,
  verified: VerifiedSet,
): Record<string, string> {
  return {
    buildKey: identity.key,
    elfSha256: verified.elfSha256,
    buildInfoSha256: verified.buildInfoSha256,
    catalogSha256: verified.catalogSha256,
  };
}

// The person approves this plan's SHA256; approvalReference alone approves nothing.
export function makePublishPlan(options: {
  identity: SetIdentity;
  verified: VerifiedSet;
  buildRunId: number;
  rollbackPlan: string;
  approvalReference: string;
}): { plan: ExternalOperation; bytes: Uint8Array; sha256: string } {
  const plan: ExternalOperation = {
    schemaVersion: 1,
    operationId: `publish-${releaseTag(options.identity.tool, options.identity.key)}-${options.buildRunId}`,
    action: 'publish',
    targets: targetsFor(options.identity),
    inputDigests: digestsFor(options.identity, options.verified),
    acceptanceEvidenceIds: [`vivarium-run-${options.buildRunId}`],
    rollbackPlanDigest: sha256Hex(options.rollbackPlan),
    approvalReference: options.approvalReference,
  };
  const bytes = new TextEncoder().encode(canonicalJson(plan));
  return { plan, bytes, sha256: sha256Hex(bytes) };
}

export function checkPlan(
  bytes: Uint8Array,
  approvedSha256: string,
  identity: SetIdentity,
  verified: VerifiedSet,
): ExternalOperation {
  if (sha256Hex(bytes) !== approvedSha256)
    fail('VERIFY_FAILED', 'the plan differs from the approved SHA256');
  const plan = parseUniqueJson(
    bytes,
    MAX_PLAN_BYTES,
    'plan',
  ) as ExternalOperation;
  if (plan.schemaVersion !== 1 || plan.action !== 'publish')
    fail('INVALID_INPUT', 'the plan is not a publish operation');
  if (canonicalJson(plan.targets) !== canonicalJson(targetsFor(identity)))
    fail('VERIFY_FAILED', 'the plan targets another tag or files');
  if (
    canonicalJson(plan.inputDigests) !==
    canonicalJson(digestsFor(identity, verified))
  )
    fail('VERIFY_FAILED', "the artifact differs from the plan's inputDigests");
  if (!/^[0-9a-f]{64}$/.test(plan.rollbackPlanDigest))
    fail('INVALID_INPUT', 'the plan needs a rollback plan digest');
  if (
    typeof plan.approvalReference !== 'string' ||
    plan.approvalReference.length === 0
  )
    fail('INVALID_INPUT', 'the plan needs an approval reference');
  return plan;
}

async function downloadSet(
  api: GitHubApi,
  release: Release,
  identity: SetIdentity,
): Promise<ArtifactSet> {
  const asset = (name: string) => {
    const found = release.assets.filter((item) => item.name === name);
    if (found.length !== 1)
      fail('UNUSABLE_KEY', `the Release does not hold exactly one ${name}`);
    return found[0] as (typeof found)[0];
  };
  if (release.assets.length !== 3)
    fail('UNUSABLE_KEY', 'the Release does not hold exactly its three files');
  return {
    elf: await api.downloadAsset(asset(identity.binary), MAX_ELF_BYTES),
    buildInfo: await api.downloadAsset(
      asset(BUILD_INFO_ASSET),
      MAX_METADATA_BYTES,
    ),
    catalog: await api.downloadAsset(asset(CATALOG_ASSET), MAX_CATALOG_BYTES),
  };
}

export const RELEASE_ENVIRONMENT = 'fixed-guest-release';

// GitHub creates a missing environment on first use with no reviewers, so a
// job that reached this point may not have been approved by anyone.
export async function checkApprovalGate(api: GitHubApi): Promise<void> {
  if ((await api.environmentReviewers(RELEASE_ENVIRONMENT)) < 1)
    fail(
      'INVALID_INPUT',
      `the ${RELEASE_ENVIRONMENT} environment has no required reviewers; nothing is written`,
    );
}

export type PublishOutcome =
  | { status: 'published'; tag: string; verified: VerifiedSet }
  | { status: 'already-published'; tag: string; verified: VerifiedSet };

export async function publishSet(options: {
  api: GitHubApi;
  identity: SetIdentity;
  files: ArtifactSet;
  planBytes: Uint8Array;
  approvedPlanSha256: string;
}): Promise<PublishOutcome> {
  const { api, identity } = options;
  const expected = {
    buildKey: identity.key,
    tool: identity.tool,
    repository: identity.repository,
    commit: identity.commit,
  };
  const verified = verifyArtifactSet(options.files, expected);
  const plan = checkPlan(
    options.planBytes,
    options.approvedPlanSha256,
    identity,
    verified,
  );
  const tag = releaseTag(identity.tool, identity.key);

  const existing = await api.findRelease(tag);
  if (existing !== null && !existing.draft) {
    let published: VerifiedSet;
    try {
      published = verifyArtifactSet(
        await downloadSet(api, existing, identity),
        expected,
      );
    } catch (error) {
      if (error instanceof BuildError && error.code === 'EXTERNAL') throw error;
      fail(
        'UNUSABLE_KEY',
        `the published set for this key fails verification: ${error instanceof Error ? error.message : ''}`,
      );
    }
    if (published.elfSha256 !== verified.elfSha256)
      fail(
        'NOT_REPRODUCIBLE',
        "this build's ELF differs from the published ELF for the same key; the published set is kept",
      );
    return { status: 'already-published', tag, verified: published };
  }
  // A draft was never published, so replacing it deletes nothing released.
  if (existing !== null) await api.deleteDraft(existing);

  const draft = await api.createDraft(
    tag,
    tag,
    `Fixed guest build. Operation ${plan.operationId}.`,
  );
  try {
    const uploaded: Release = { ...draft, assets: [] };
    uploaded.assets.push(
      await api.uploadAsset(draft, identity.binary, options.files.elf),
    );
    uploaded.assets.push(
      await api.uploadAsset(draft, BUILD_INFO_ASSET, options.files.buildInfo),
    );
    uploaded.assets.push(
      await api.uploadAsset(draft, CATALOG_ASSET, options.files.catalog),
    );
    const back = verifyArtifactSet(
      await downloadSet(api, uploaded, identity),
      expected,
    );
    if (
      back.elfSha256 !== verified.elfSha256 ||
      back.buildInfoSha256 !== verified.buildInfoSha256 ||
      back.catalogSha256 !== verified.catalogSha256
    )
      fail('VERIFY_FAILED', 'uploaded files differ from the verified files');
    await api.publish(draft);
  } catch (error) {
    await api.deleteDraft(draft).catch(() => undefined);
    throw error;
  }
  return { status: 'published', tag, verified };
}
