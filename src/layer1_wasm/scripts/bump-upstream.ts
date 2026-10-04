#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER1_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(LAYER1_DIR));

type Upstream =
  | { registry: 'pypi'; package: string; version: string }
  | { registry: 'github'; repository: string; version: string; commit: string };

interface Release {
  version: string;
  commit?: string;
}

const PROSE = /\.md$|(^|\/)roundtrip\.json$/;

function upstreamOf(slug: string): Upstream | undefined {
  const path = join(LAYER1_DIR, slug, 'recipe.json');
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf-8')) as { upstream?: Upstream }).upstream;
}

async function getJson<T>(url: string): Promise<T> {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token && url.startsWith('https://api.github.com/')) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return (await res.json()) as T;
}

async function latest(upstream: Upstream): Promise<Release> {
  if (upstream.registry === 'pypi') {
    const doc = await getJson<{ info: { version: string } }>(`https://pypi.org/pypi/${upstream.package}/json`);
    return { version: doc.info.version };
  }
  const api = `https://api.github.com/repos/${upstream.repository}`;
  const release = await getJson<{ tag_name: string }>(`${api}/releases/latest`);
  const commit = await getJson<{ sha: string }>(`${api}/commits/${encodeURIComponent(release.tag_name)}`);
  return { version: release.tag_name, commit: commit.sha };
}

function exactly(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![0-9A-Za-z.])${escaped}(?![0-9A-Za-z]|\\.[0-9A-Za-z])`, 'g');
}

function trackedFiles(slug: string): string[] {
  const proc = Bun.spawnSync(['git', 'ls-files', '--', `src/layer1_wasm/${slug}`], { cwd: REPO_ROOT });
  return proc.stdout.toString().split('\n').filter(Boolean);
}

function list(): void {
  const slugs = readdirSync(LAYER1_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && upstreamOf(entry.name))
    .map((entry) => entry.name)
    .sort();
  console.log(slugs.join('\n'));
}

async function bump(slug: string): Promise<void> {
  const upstream = upstreamOf(slug);
  if (!upstream) throw new Error(`${slug}/recipe.json has no upstream field`);
  const next = await latest(upstream);
  const pairs: Array<[string, string]> = [[upstream.version, next.version]];
  if (upstream.registry === 'github' && next.commit) pairs.push([upstream.commit, next.commit]);
  const changes = pairs.filter(([from, to]) => from !== to);
  if (changes.length === 0) return;

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
    throw new Error(`${slug}: ${upstream.version} does not appear in any of the recipe's files`);
  }

  const source = upstream.registry === 'pypi' ? `PyPI \`${upstream.package}\`` : `GitHub \`${upstream.repository}\``;
  const lines = [
    `Moves the \`${slug}\` baseline to the latest ${source} release.`,
    '',
    '| | From | To |',
    '| --- | --- | --- |',
    ...changes.map(([from, to], i) => `| ${i === 0 ? 'Version' : 'Commit'} | \`${from}\` | \`${to}\` |`),
    '',
    'Rewritten:',
    '',
    ...rewritten.map((file) => `- \`${file}\``),
  ];
  const prose = files
    .filter((f) => PROSE.test(f))
    .flatMap((file) =>
      readFileSync(join(REPO_ROOT, file), 'utf-8')
        .split('\n')
        .map((line, i) => [file, i + 1, line] as const)
        .filter(([, , line]) => changes.some(([from]) => exactly(from).test(line))),
    )
    .map(([file, n, line]) => `${file}:${n}: ${line.trim()}`);
  if (prose.length > 0) {
    lines.push(
      '',
      '<details><summary>Prose that still names the old release (left as written)</summary>',
      '',
      '```text',
      ...prose,
      '```',
      '',
      '</details>',
    );
  }
  console.log(lines.join('\n'));
}

const arg = process.argv[2];
if (arg === '--list') list();
else if (arg) await bump(arg);
else throw new Error('usage: bump-upstream.ts --list | bump-upstream.ts <slug>');
