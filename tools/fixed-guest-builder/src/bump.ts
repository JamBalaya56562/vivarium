import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Allowlist, validateDeclaration } from './declaration.ts';
import { fail } from './errors.ts';
import type { Runner } from './process.ts';
import { verifyReachable } from './source.ts';

const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,255}$/;

export const GUEST_ROLES = ['baseline', 'fix'] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];

export interface BumpRecord {
  role: GuestRole;
  tool: string;
  repository: string;
  branch: string;
  previousCommit: string;
  commit: string;
  resolvedAt: string;
}

export async function resolveBranch(options: {
  repository: string;
  branch: string;
  run: Runner;
  cloneUrl?: (repository: string) => string;
}): Promise<string> {
  if (!BRANCH.test(options.branch))
    fail('INVALID_INPUT', 'branch name is not valid');
  const url = (options.cloneUrl ?? ((repository) => repository))(
    options.repository,
  );
  const result = await options.run(
    'git',
    ['ls-remote', '--heads', '--', url, `refs/heads/${options.branch}`],
    {
      env: { GIT_TERMINAL_PROMPT: '0' },
    },
  );
  if (result.code !== 0)
    fail('SOURCE_UNREACHABLE', 'ls-remote of the declared repository failed');
  const lines = result.stdout
    .trim()
    .split('\n')
    .filter((line) => line !== '');
  if (lines.length !== 1)
    fail(
      'SOURCE_UNREACHABLE',
      `branch ${options.branch} does not exist in the declared repository`,
    );
  const [commit, ref] = (lines[0] as string).split('\t');
  if (
    ref !== `refs/heads/${options.branch}` ||
    commit === undefined ||
    !/^[0-9a-f]{40}$/.test(commit)
  )
    fail('SOURCE_UNREACHABLE', 'ls-remote returned an unexpected ref');
  return commit;
}

export async function bumpGuest(options: {
  recipePath: string;
  role: string;
  allowlist: Allowlist;
  run: Runner;
  workDirectory: string;
  cloneUrl?: (repository: string) => string;
  now?: () => Date;
}): Promise<BumpRecord | null> {
  if (!(GUEST_ROLES as readonly string[]).includes(options.role))
    fail('INVALID_INPUT', 'role must be baseline or fix');
  const role = options.role as GuestRole;
  const text = await readFile(options.recipePath, 'utf8');
  const recipe = JSON.parse(text) as { guests?: Record<string, unknown>[] };
  if (!Array.isArray(recipe.guests))
    fail('INVALID_INPUT', 'recipe has no guests');
  const matches = recipe.guests.filter((guest) => guest.role === role);
  if (matches.length !== 1)
    fail('INVALID_INPUT', `recipe must declare the ${role} guest exactly once`);
  const guest = matches[0] as Record<string, unknown>;
  const declaration = validateDeclaration(guest, options.allowlist);
  const branch = declaration.reference?.branch;
  if (branch === undefined)
    fail(
      'INVALID_INPUT',
      'the guest names no branch; PR information alone is not used to bump',
    );
  const commit = await resolveBranch({
    repository: declaration.repository,
    branch,
    run: options.run,
    ...(options.cloneUrl === undefined ? {} : { cloneUrl: options.cloneUrl }),
  });
  if (commit === declaration.commit) return null;
  await verifyReachable({
    repository: declaration.repository,
    commit,
    directory: join(options.workDirectory, 'reachability'),
    run: options.run,
    ...(options.cloneUrl === undefined ? {} : { cloneUrl: options.cloneUrl }),
  });
  const record: BumpRecord = {
    role,
    tool: declaration.tool,
    repository: declaration.repository,
    branch,
    previousCommit: declaration.commit,
    commit,
    resolvedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  // accepted stays: the site keeps running the accepted build until a person
  // accepts the build of the new commit.
  guest.commit = commit;
  const temporary = `${options.recipePath}.bump-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(recipe, null, 2)}\n`, {
    flag: 'wx',
  });
  await rename(temporary, options.recipePath);
  return record;
}
