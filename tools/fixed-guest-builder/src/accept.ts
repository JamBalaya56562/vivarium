import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './errors.ts';

export interface PublishedBuild {
  tool: string;
  repository: string;
  commit: string;
  versionOrName: string;
  buildKey: string;
  elfSha256: string;
  buildInfoSha256: string;
}

export interface AcceptedChange {
  recipe: string;
  role: string;
  previousBuildKey: string | null;
}

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function parsePublishedBuild(value: unknown): PublishedBuild {
  const record = value as Record<string, unknown> | null;
  const text = (key: string, pattern?: RegExp) => {
    const item = record?.[key];
    if (
      typeof item !== 'string' ||
      item === '' ||
      !(pattern?.test(item) ?? true)
    )
      fail('INVALID_INPUT', `published build needs a valid ${key}`);
    return item;
  };
  return {
    tool: text('tool'),
    repository: text('repository'),
    commit: text('commit', HEX40),
    versionOrName: text('versionOrName'),
    buildKey: text('buildKey', HEX64),
    elfSha256: text('elfSha256', HEX64),
    buildInfoSha256: text('buildInfoSha256', HEX64),
  };
}

function acceptedFor(build: PublishedBuild) {
  return {
    commit: build.commit,
    versionOrName: build.versionOrName,
    buildKey: build.buildKey,
    elfSha256: build.elfSha256,
    buildInfoSha256: build.buildInfoSha256,
  };
}

export async function acceptBuild(options: {
  layer1Directory: string;
  build: PublishedBuild;
}): Promise<AcceptedChange[]> {
  const changes: AcceptedChange[] = [];
  const entries = await readdir(options.layer1Directory, {
    withFileTypes: true,
  });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const path = join(options.layer1Directory, entry.name, 'recipe.json');
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue;
    }
    const recipe = JSON.parse(text) as { guests?: Record<string, unknown>[] };
    if (!Array.isArray(recipe.guests)) continue;
    const accepted = acceptedFor(options.build);
    let changed = false;
    for (const guest of recipe.guests) {
      if (
        guest.tool !== options.build.tool ||
        guest.repository !== options.build.repository ||
        guest.commit !== options.build.commit
      )
        continue;
      const previous = guest.accepted as { buildKey?: string } | undefined;
      if (JSON.stringify(previous) === JSON.stringify(accepted)) continue;
      changes.push({
        recipe: entry.name,
        role: String(guest.role),
        previousBuildKey: previous?.buildKey ?? null,
      });
      guest.accepted = accepted;
      changed = true;
    }
    if (!changed) continue;
    const temporary = `${path}.accept-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(recipe, null, 2)}\n`, {
      flag: 'wx',
    });
    await rename(temporary, path);
  }
  return changes;
}
