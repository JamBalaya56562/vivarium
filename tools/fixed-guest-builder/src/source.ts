import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fail } from './errors.ts';
import type { Runner } from './process.ts';

export interface SourcePatch {
  name: string;
  path: string;
  sha256: string;
}

export interface FetchSourceOptions {
  repository: string;
  commit: string;
  directory: string;
  run: Runner;
  cloneUrl?: (repository: string) => string;
  signal?: AbortSignal;
}

// A lazy fetch by SHA is how a commit that exists only in another fork of the
// network would get in, so it stays off while the commit is checked.
const NO_LAZY_FETCH = { GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' };

async function git(
  options: FetchSourceOptions,
  args: string[],
  env: Record<string, string> = NO_LAZY_FETCH,
) {
  return options.run('git', args, {
    cwd: options.directory,
    env,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

export async function verifyReachable(
  options: FetchSourceOptions,
): Promise<void> {
  const url = (options.cloneUrl ?? ((repository) => repository))(
    options.repository,
  );
  const clone = await options.run(
    'git',
    [
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      '--no-recurse-submodules',
      '--',
      url,
      options.directory,
    ],
    {
      env: NO_LAZY_FETCH,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (clone.code !== 0)
    fail('SOURCE_UNREACHABLE', 'clone of the declared repository failed');

  const present = await git(options, [
    'cat-file',
    '-e',
    `${options.commit}^{commit}`,
  ]);
  if (present.code !== 0)
    fail(
      'SOURCE_UNREACHABLE',
      "commit is not reachable from the declared repository's own branches or tags",
    );
  const refs = await git(options, [
    'for-each-ref',
    '--contains',
    options.commit,
    '--format=%(refname)',
    'refs/remotes',
    'refs/tags',
  ]);
  if (refs.code !== 0 || refs.stdout.trim() === '')
    fail(
      'SOURCE_UNREACHABLE',
      "commit is not reachable from the declared repository's own branches or tags",
    );
}

export async function fetchSource(options: FetchSourceOptions): Promise<void> {
  await verifyReachable(options);
  // The commit is known to belong to the repository now, so lazy fetch is fine.
  const checkout = await git(
    options,
    ['checkout', '--quiet', '--detach', options.commit],
    { GIT_TERMINAL_PROMPT: '0' },
  );
  if (checkout.code !== 0)
    fail('SOURCE_UNREACHABLE', 'checkout of the declared commit failed');
  const head = await git(options, ['rev-parse', 'HEAD']);
  if (head.stdout.trim() !== options.commit)
    fail('VERIFY_FAILED', 'checked out HEAD differs from the declared commit');

  const gitmodules = await stat(join(options.directory, '.gitmodules')).catch(
    () => undefined,
  );
  if (gitmodules !== undefined)
    fail(
      'INVALID_INPUT',
      'submodules are not fetched; this source declares .gitmodules',
    );
}

// Same check for a git dependency, which is never checked out: a bare clone
// of commits only is enough and stays small even for large repositories.
export async function verifyDependencyReachable(
  options: FetchSourceOptions,
): Promise<void> {
  const url = (options.cloneUrl ?? ((repository) => repository))(
    options.repository,
  );
  const clone = await options.run(
    'git',
    [
      'clone',
      '--bare',
      '--filter=tree:0',
      '--no-recurse-submodules',
      '--',
      url,
      options.directory,
    ],
    {
      env: NO_LAZY_FETCH,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
  );
  if (clone.code !== 0)
    fail(
      'SOURCE_UNREACHABLE',
      `clone of the dependency repository failed: ${options.repository}`,
    );
  const present = await git(options, [
    'cat-file',
    '-e',
    `${options.commit}^{commit}`,
  ]);
  const refs = await git(options, [
    'for-each-ref',
    '--contains',
    options.commit,
    '--format=%(refname)',
    'refs/heads',
    'refs/tags',
  ]);
  if (present.code !== 0 || refs.code !== 0 || refs.stdout.trim() === '')
    fail(
      'SOURCE_UNREACHABLE',
      `dependency commit is not reachable from ${options.repository}'s own branches or tags: ${options.commit}`,
    );
}

export async function sha256File(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

export async function applyPatches(
  directory: string,
  patches: readonly SourcePatch[],
  run: Runner,
  patchRoot: string,
): Promise<void> {
  for (const patch of patches) {
    const path = resolve(patchRoot, patch.path);
    if (!path.startsWith(`${resolve(patchRoot)}/`))
      fail('INVALID_INPUT', `patch path escapes the patch root: ${patch.name}`);
    const digest = await sha256File(path).catch(() =>
      fail('INVALID_INPUT', `patch file is missing: ${patch.name}`),
    );
    if (digest !== patch.sha256)
      fail(
        'VERIFY_FAILED',
        `patch SHA256 differs from the declaration: ${patch.name}`,
      );
    const check = await run('git', ['apply', '--check', path], {
      cwd: directory,
      env: NO_LAZY_FETCH,
    });
    if (check.code !== 0)
      fail('VERIFY_FAILED', `patch does not apply: ${patch.name}`);
    const apply = await run('git', ['apply', path], {
      cwd: directory,
      env: NO_LAZY_FETCH,
    });
    if (apply.code !== 0)
      fail('VERIFY_FAILED', `patch failed while applying: ${patch.name}`);
  }
}
