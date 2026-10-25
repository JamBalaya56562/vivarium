import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './errors.ts';
import type { GitHubApi, ListedRelease } from './github.ts';
import type { Runner } from './process.ts';

export const DEFAULT_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const GUEST_TAG = /^guest-([a-z0-9][a-z0-9-]*)-([0-9a-f]{64})$/;
const RECIPE_FILE = /^src\/layer1_wasm\/([^/_][^/]*)\/recipe\.json$/;

export type PruneStatus = 'referenced' | 'waiting' | 'delete';

export interface PruneDecision {
  tag: string;
  releaseId: number;
  buildKey: string;
  status: PruneStatus;
  referencedBy: string[];
  unreferencedSince: string | null;
  deleteAfter: string | null;
}

export interface PruneResult {
  dryRun: boolean;
  graceDays: number;
  decisions: PruneDecision[];
  orphanTags: string[];
  deleted: string[];
}

export function guestKey(tag: string): string | null {
  return GUEST_TAG.exec(tag)?.[2] ?? null;
}

export function acceptedKeys(text: string): string[] {
  const recipe = JSON.parse(text) as {
    guests?: { accepted?: { buildKey?: unknown } }[];
  };
  if (!Array.isArray(recipe.guests)) return [];
  return recipe.guests
    .map((guest) => guest?.accepted?.buildKey)
    .filter((key): key is string => typeof key === 'string');
}

function addReference(
  references: Map<string, string[]>,
  key: string,
  where: string,
) {
  const list = references.get(key) ?? [];
  if (!list.includes(where)) list.push(where);
  references.set(key, list);
}

export async function referencesOnMain(
  layer1Directory: string,
  references = new Map<string, string[]>(),
): Promise<Map<string, string[]>> {
  let entries: Dirent[];
  try {
    entries = await readdir(layer1Directory, { withFileTypes: true });
  } catch {
    fail('INVALID_INPUT', `cannot list ${layer1Directory}`);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    let text: string;
    try {
      text = await readFile(
        join(layer1Directory, entry.name, 'recipe.json'),
        'utf8',
      );
    } catch {
      continue;
    }
    let keys: string[];
    try {
      keys = acceptedKeys(text);
    } catch {
      fail('INVALID_INPUT', `main has an unreadable ${entry.name}/recipe.json`);
    }
    for (const key of keys) addReference(references, key, `main:${entry.name}`);
  }
  return references;
}

export async function referencesInOpenPulls(
  api: GitHubApi,
  references = new Map<string, string[]>(),
): Promise<Map<string, string[]>> {
  for (const pull of await api.openPulls()) {
    for (const file of await api.pullFiles(pull)) {
      if (file.status === 'removed' || !RECIPE_FILE.test(file.filename))
        continue;
      const text = await api.fileAt(file.filename, `refs/pull/${pull}/head`);
      if (text === null) continue;
      let keys: string[];
      try {
        keys = acceptedKeys(text);
      } catch {
        fail('INVALID_INPUT', `#${pull} has an unreadable ${file.filename}`);
      }
      for (const key of keys) addReference(references, key, `#${pull}`);
    }
  }
  return references;
}

export async function historyLookup(
  run: Runner,
  repositoryRoot: string,
): Promise<(key: string) => Promise<string | null>> {
  const git = async (...args: string[]) => {
    const result = await run('git', args, { cwd: repositoryRoot });
    if (result.code !== 0) fail('EXTERNAL', `git ${args[0]} failed`);
    return result.stdout.trim();
  };
  // A shallow history hides the commit that dropped a key, which would date
  // the key from its publication and delete it early.
  if ((await git('rev-parse', '--is-shallow-repository')) !== 'false')
    fail('INVALID_INPUT', 'the checkout needs its full history');
  return async (key) =>
    (await git(
      'log',
      '--first-parent',
      '-1',
      '--format=%cI',
      `-S${key}`,
      'HEAD',
      '--',
      'src/layer1_wasm',
    )) || null;
}

export function decide(options: {
  releases: readonly ListedRelease[];
  references: ReadonlyMap<string, readonly string[]>;
  lastReferencedAt: ReadonlyMap<string, string | null>;
  now: Date;
  graceDays: number;
}): PruneDecision[] {
  const decisions: PruneDecision[] = [];
  for (const release of options.releases) {
    const key = guestKey(release.tag);
    if (key === null || release.draft) continue;
    const referencedBy = [...(options.references.get(key) ?? [])];
    if (referencedBy.length > 0) {
      decisions.push({
        tag: release.tag,
        releaseId: release.id,
        buildKey: key,
        status: 'referenced',
        referencedBy,
        unreferencedSince: null,
        deleteAfter: null,
      });
      continue;
    }
    const since = options.lastReferencedAt.get(key) ?? release.publishedAt;
    if (since === null || Number.isNaN(Date.parse(since)))
      fail('EXTERNAL', `${release.tag} has no usable date`);
    const deleteAfter = new Date(
      Date.parse(since) + options.graceDays * DAY_MS,
    );
    decisions.push({
      tag: release.tag,
      releaseId: release.id,
      buildKey: key,
      status: deleteAfter <= options.now ? 'delete' : 'waiting',
      referencedBy,
      unreferencedSince: new Date(Date.parse(since)).toISOString(),
      deleteAfter: deleteAfter.toISOString(),
    });
  }
  return decisions.sort((a, b) => (a.tag < b.tag ? -1 : 1));
}

export async function pruneReleases(options: {
  api: GitHubApi;
  layer1Directory: string;
  lastReferencedAt: (key: string) => Promise<string | null>;
  now: Date;
  graceDays: number;
  dryRun: boolean;
}): Promise<PruneResult> {
  if (!Number.isSafeInteger(options.graceDays) || options.graceDays < 1)
    fail('INVALID_INPUT', 'the grace period must be at least one day');
  const references = await referencesInOpenPulls(
    options.api,
    await referencesOnMain(options.layer1Directory),
  );
  const releases = await options.api.listReleases();
  const lastReferencedAt = new Map<string, string | null>();
  for (const release of releases) {
    const key = guestKey(release.tag);
    if (key === null || release.draft || references.has(key)) continue;
    lastReferencedAt.set(key, await options.lastReferencedAt(key));
  }
  const decisions = decide({
    releases,
    references,
    lastReferencedAt,
    now: options.now,
    graceDays: options.graceDays,
  });
  const released = new Set(releases.map((release) => release.tag));
  const orphanTags = (await options.api.guestTags())
    .filter((tag) => {
      const key = guestKey(tag);
      return key !== null && !released.has(tag) && !references.has(key);
    })
    .sort();
  const deleted: string[] = [];
  if (!options.dryRun) {
    for (const decision of decisions) {
      if (decision.status !== 'delete') continue;
      await options.api.deletePublished({
        id: decision.releaseId,
        tag: decision.tag,
        draft: false,
        publishedAt: null,
      });
      await options.api.deleteTag(decision.tag);
      deleted.push(decision.tag);
    }
    for (const tag of orphanTags) {
      await options.api.deleteTag(tag);
      deleted.push(tag);
    }
  }
  return {
    dryRun: options.dryRun,
    graceDays: options.graceDays,
    decisions,
    orphanTags,
    deleted,
  };
}

export function renderPruneSummary(result: PruneResult): string {
  const lines = [
    `## Guest Releases${result.dryRun ? ' (dry run, nothing deleted)' : ''}`,
    '',
    `A \`guest-<tool>-<buildKey>\` Release is deleted with its tag ${result.graceDays} days after no recipe on \`main\` and no open pull request accepts its key.`,
    '',
  ];
  const orphans = result.orphanTags.map(
    (tag) =>
      `- \`${tag}\`: tag with no Release, ${result.deleted.includes(tag) ? '**deleted**' : '**would be deleted**'}`,
  );
  if (result.decisions.length === 0) {
    lines.push('No guest Releases.', '', ...orphans, '');
    return `${lines.join('\n')}\n`;
  }
  lines.push(
    '| Release | Status | Unreferenced since | Deleted after |',
    '|---|---|---|---|',
  );
  for (const decision of result.decisions) {
    const status =
      decision.status === 'referenced'
        ? `referenced by ${decision.referencedBy.join(', ')}`
        : decision.status === 'waiting'
          ? 'waiting'
          : result.deleted.includes(decision.tag)
            ? '**deleted**'
            : '**would be deleted**';
    lines.push(
      `| \`${decision.tag}\` | ${status} | ${decision.unreferencedSince ?? '–'} | ${decision.deleteAfter ?? '–'} |`,
    );
  }
  if (orphans.length > 0) lines.push('', ...orphans);
  lines.push('');
  return `${lines.join('\n')}\n`;
}
