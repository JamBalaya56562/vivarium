import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PACKAGE = '@aletheia-works/coi-serviceworker';
const require = createRequire(import.meta.url);

export const COI_SERVICEWORKER_FILE = 'coi-serviceworker.js';
export const COI_SERVICEWORKER_SOURCE = require.resolve(
  `${PACKAGE}/${COI_SERVICEWORKER_FILE}`,
);
export const COI_SERVICEWORKER_VERSION = (
  require(`${PACKAGE}/package.json`) as { version: string }
).version;
export const COI_SERVICEWORKER_SHA256 = createHash('sha256')
  .update(readFileSync(COI_SERVICEWORKER_SOURCE))
  .digest('hex');

const FORMICARIUM_RUNTIME = 'formicarium';

export function coiServiceWorkerProblem(path: string): string | null {
  if (!existsSync(path)) return `${path}: missing`;
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (digest !== COI_SERVICEWORKER_SHA256)
    return `${path}: SHA256 ${digest} is not ${PACKAGE} ${COI_SERVICEWORKER_VERSION} (${COI_SERVICEWORKER_SHA256})`;
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
