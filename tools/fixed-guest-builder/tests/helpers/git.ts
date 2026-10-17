import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '../../src/process.ts';

const ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runProcess('git', args, { cwd, env: ENV });
  if (result.code !== 0)
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export async function tempDir(prefix = 'fgb-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export interface Upstream {
  bare: string;
  url: string;
  main: string;
  tagged: string;
  // A commit object stored in the server but not reachable from any of its
  // refs, like a commit that only exists in another fork of the network.
  dangling: string;
}

export async function createUpstream(
  files: Record<string, string> = { 'Cargo.toml': "[package]\nname='x'\n" },
): Promise<Upstream> {
  const work = await tempDir('fgb-work-');
  await git(work, 'init', '--quiet', '--initial-branch=main');
  for (const [name, content] of Object.entries(files))
    await writeFile(join(work, name), content);
  await git(work, 'add', '.');
  await git(work, 'commit', '--quiet', '-m', 'first');
  const tagged = await git(work, 'rev-parse', 'HEAD');
  await git(work, 'tag', 'v1');
  await writeFile(join(work, 'README'), 'second\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '--quiet', '-m', 'second');
  const main = await git(work, 'rev-parse', 'HEAD');
  await git(work, 'checkout', '--quiet', '-b', 'fork-only');
  await writeFile(join(work, 'EVIL'), 'fork\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '--quiet', '-m', 'fork only');
  const dangling = await git(work, 'rev-parse', 'HEAD');
  await git(work, 'checkout', '--quiet', 'main');

  const bare = await tempDir('fgb-bare-');
  await git(bare, 'init', '--quiet', '--bare');
  await git(bare, 'config', 'uploadpack.allowFilter', 'true');
  await git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  await git(work, 'push', '--quiet', bare, 'main', 'v1', 'fork-only');
  // Drop the ref but keep the object, as GitHub's shared object store does.
  await git(bare, 'update-ref', '-d', 'refs/heads/fork-only');
  return { bare, url: `file://${bare}`, main, tagged, dangling };
}
