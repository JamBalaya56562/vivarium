#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER1_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(LAYER1_DIR));

type Kind = 'upstream' | 'fix';

type Upstream =
  | { registry: 'pypi'; package: string; version: string }
  | { registry: 'github'; repository: string; version: string; commit: string };

interface RecipeMeta {
  upstream?: Upstream;
  fix_candidate?: { repository: string; branch: string; commit: string };
}

interface FixCandidate {
  url: string;
  branch: string;
  commit: string;
}

const PROSE = /\.md$|(^|\/)roundtrip\.json$/;

function readJson<T>(path: string): T | undefined {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf-8')) as T) : undefined;
}

function recipeOf(slug: string): RecipeMeta | undefined {
  return readJson<RecipeMeta>(join(LAYER1_DIR, slug, 'recipe.json'));
}

function fixCandidateOf(slug: string): FixCandidate | undefined {
  const wheel = readJson<{ source?: { url?: string; ref?: string; commit?: string } }>(
    join(LAYER1_DIR, slug, 'fix-candidate.json'),
  );
  const declared = recipeOf(slug)?.fix_candidate;
  if (wheel && declared) {
    throw new Error(`${slug} pins its fix candidate twice: use fix-candidate.json source.commit or recipe.json fix_candidate, not both`);
  }
  if (wheel) {
    const { url, ref, commit } = wheel.source ?? {};
    return url && ref && commit ? { url, branch: ref, commit } : undefined;
  }
  return declared
    ? { url: `https://github.com/${declared.repository}`, branch: declared.branch, commit: declared.commit }
    : undefined;
}

async function getJson<T>(url: string): Promise<T> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

async function latestRelease(upstream: Upstream): Promise<{ version: string; commit?: string }> {
  if (upstream.registry === 'pypi') {
    const doc = await getJson<{ info: { version: string } }>(`https://pypi.org/pypi/${upstream.package}/json`);
    return { version: doc.info.version };
  }
  const api = `https://api.github.com/repos/${upstream.repository}`;
  const release = await getJson<{ tag_name: string }>(`${api}/releases/latest`);
  const commit = await getJson<{ sha: string }>(`${api}/commits/${encodeURIComponent(release.tag_name)}`);
  return { version: release.tag_name, commit: commit.sha };
}

function branchHead(url: string, branch: string): string | undefined {
  const proc = Bun.spawnSync(['git', 'ls-remote', '--exit-code', url, `refs/heads/${branch}`]);
  if (proc.exitCode === 2) return undefined;
  if (proc.exitCode !== 0) {
    throw new Error(`git ls-remote ${url} ${branch} exited ${proc.exitCode}: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString().split(/\s/)[0];
}

function exactly(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9A-Za-z.])${escaped}(?![0-9A-Za-z]|\\.[0-9A-Za-z])`, 'g');
}

function trackedFiles(slug: string): string[] {
  const proc = Bun.spawnSync(['git', 'ls-files', '--', `src/layer1_wasm/${slug}`], { cwd: REPO_ROOT });
  return proc.stdout.toString().split('\n').filter(Boolean);
}

function rewrite(slug: string, changes: Array<[string, string]>): { rewritten: string[]; prose: string[] } {
  const files = trackedFiles(slug);
  const rewritten: string[] = [];
  for (const file of files.filter((f) => !PROSE.test(f))) {
    const path = join(REPO_ROOT, file);
    const before = readFileSync(path, 'utf-8');
    const after = changes.reduce((body, [from, to]) => body.replace(exactly(from), to), before);
    if (after !== before) {
      writeFileSync(path, after);
      rewritten.push(file);
    }
  }
  if (!rewritten.some((file) => !file.endsWith('/recipe.json'))) {
    throw new Error(`${slug}: ${changes[0]?.[0]} does not appear in any of the recipe's files`);
  }
  const prose = files
    .filter((f) => PROSE.test(f))
    .flatMap((file) =>
      readFileSync(join(REPO_ROOT, file), 'utf-8')
        .split('\n')
        .map((line, i) => [file, i + 1, line] as const)
        .filter(([, , line]) => changes.some(([from]) => exactly(from).test(line))),
    )
    .map(([file, n, line]) => `${file}:${n}: ${line.trim()}`);
  return { rewritten, prose };
}

function summary(
  headline: string,
  rows: Array<[string, string, string]>,
  { rewritten, prose }: { rewritten: string[]; prose: string[] },
): string {
  const lines = [
    headline,
    '',
    '| | From | To |',
    '| --- | --- | --- |',
    ...rows.map(([label, from, to]) => `| ${label} | \`${from}\` | \`${to}\` |`),
    '',
    'Rewritten:',
    '',
    ...rewritten.map((file) => `- \`${file}\``),
  ];
  if (prose.length > 0) {
    lines.push(
      '',
      '<details><summary>Prose that still names the old pin (left as written)</summary>',
      '',
      '```text',
      ...prose,
      '```',
      '',
      '</details>',
    );
  }
  return lines.join('\n');
}

async function bumpUpstream(slug: string): Promise<void> {
  const upstream = recipeOf(slug)?.upstream;
  if (!upstream) throw new Error(`${slug}/recipe.json has no upstream field`);
  const next = await latestRelease(upstream);
  const rows: Array<[string, string, string]> = [['Version', upstream.version, next.version]];
  if (upstream.registry === 'github' && next.commit) rows.push(['Commit', upstream.commit, next.commit]);
  const changed = rows.filter(([, from, to]) => from !== to);
  if (changed.length === 0) return;
  const result = rewrite(
    slug,
    changed.map(([, from, to]) => [from, to]),
  );
  const source = upstream.registry === 'pypi' ? `PyPI \`${upstream.package}\`` : `GitHub \`${upstream.repository}\``;
  console.log(summary(`Moves the \`${slug}\` baseline to the latest ${source} release.`, changed, result));
}

function bumpFix(slug: string): void {
  const fix = fixCandidateOf(slug);
  if (!fix) throw new Error(`${slug} has no pinned fix candidate`);
  const head = branchHead(fix.url, fix.branch);
  if (!head) {
    console.error(`${slug}: ${fix.branch} no longer exists in ${fix.url}; leaving the fix candidate at ${fix.commit}.`);
    return;
  }
  if (head === fix.commit) return;
  const result = rewrite(slug, [
    [fix.commit, head],
    [fix.commit.slice(0, 8), head.slice(0, 8)],
  ]);
  console.log(
    summary(
      `Moves the \`${slug}\` fix candidate to the head of \`${fix.branch}\` in ${fix.url}.`,
      [['Commit', fix.commit, head]],
      result,
    ),
  );
}

function list(): void {
  const lines = readdirSync(LAYER1_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((slug) => [
      ...(recipeOf(slug)?.upstream ? [`${slug}\tupstream`] : []),
      ...(fixCandidateOf(slug) ? [`${slug}\tfix`] : []),
    ]);
  console.log(lines.join('\n'));
}

const [arg, kind = 'upstream'] = process.argv.slice(2) as [string | undefined, Kind | undefined];
if (arg === '--list') list();
else if (arg && kind === 'upstream') await bumpUpstream(arg);
else if (arg && kind === 'fix') bumpFix(arg);
else throw new Error('usage: bump-upstream.ts --list | bump-upstream.ts <slug> [upstream|fix]');
