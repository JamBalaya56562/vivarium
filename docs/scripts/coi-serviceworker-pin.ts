import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const COI_SERVICEWORKER_FILE = 'coi-serviceworker.js';
export const COI_SERVICEWORKER_VERSION = '0.1.7';
export const COI_SERVICEWORKER_SHA256 =
  'd12bd536e27e39a773d7dc7adb1a1167d24002293e97ac81c995fb00cf8d4d5a';

const FORMICARIUM_RUNTIME = 'formicarium';

export function coiServiceWorkerProblem(path: string): string | null {
  if (!existsSync(path)) return `${path}: missing`;
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== COI_SERVICEWORKER_SHA256)
    return `${path}: SHA256 ${digest} is not coi-serviceworker ${COI_SERVICEWORKER_VERSION} (${COI_SERVICEWORKER_SHA256})`;
  return null;
}

function recipeDirs(layer1Dir: string): string[] {
  return readdirSync(layer1Dir)
    .filter((name) => !name.startsWith('.') && name !== 'node_modules')
    .filter((name) => statSync(join(layer1Dir, name)).isDirectory())
    .sort();
}

function declaresFormicarium(recipeDir: string): boolean {
  const path = join(recipeDir, 'recipe.json');
  if (!existsSync(path)) return false;
  try {
    const meta = JSON.parse(readFileSync(path, 'utf-8')) as {
      expected_runtime?: unknown;
    };
    return meta.expected_runtime === FORMICARIUM_RUNTIME;
  } catch {
    return false;
  }
}

export function findCoiServiceWorkerProblems(layer1Dir: string): string[] {
  const problems: string[] = [];
  for (const name of recipeDirs(layer1Dir)) {
    const dir = join(layer1Dir, name);
    const copy = join(dir, COI_SERVICEWORKER_FILE);
    if (existsSync(copy) || declaresFormicarium(dir)) {
      const problem = coiServiceWorkerProblem(copy);
      if (problem) problems.push(problem);
    }
  }
  return problems;
}
