export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  stdin?: Uint8Array;
  maxOutputBytes?: number;
  killGraceMs?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (
  command: string,
  args: readonly string[],
  options?: RunOptions,
) => Promise<RunResult>;

export interface ProcessGroup {
  pid: number;
  stop(): Promise<void>;
  result: Promise<RunResult>;
}

const DEFAULT_OUTPUT_LIMIT = 16 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 30_000;

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string> {
  if (stream === null) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.byteLength;
    if (total > limit) throw new Error('command output limit');
    chunks.push(chunk);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

// Children (git, docker, the container) never need the workflow's tokens, so
// they are not inherited; a caller that needs one passes it explicitly.
// The match is by name only: a secret such as `*_KEY` or `SSH_AUTH_SOCK` still
// passes, so a workflow that adds one adds it here too.
const WITHHELD =
  /^(ACTIONS_.*|GITHUB_TOKEN|GH_TOKEN|.*_TOKEN|.*_SECRET|.*_PASSWORD)$/;

export function inheritedEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(base).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !WITHHELD.test(entry[0]),
    ),
  );
}

export function spawnGroup(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): ProcessGroup {
  const env = { ...inheritedEnvironment(), ...options.env } as Record<
    string,
    string
  >;
  const child = Bun.spawn([command, ...args], {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    env,
    stdin: options.stdin ?? 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  });
  const grace = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      signalGroup(child.pid, 'SIGTERM');
      const timer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), grace);
      try {
        await child.exited;
      } finally {
        clearTimeout(timer);
        // Children that ignored SIGTERM may outlive the leader.
        signalGroup(child.pid, 'SIGKILL');
      }
    })();
    return stopping;
  };
  const onAbort = () => void stop();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) void stop();
  const limit = options.maxOutputBytes ?? DEFAULT_OUTPUT_LIMIT;
  const result = Promise.all([
    readLimited(child.stdout, limit),
    readLimited(child.stderr, limit),
    child.exited,
  ])
    .then(([stdout, stderr, code]) => ({ code, stdout, stderr }))
    .finally(() => options.signal?.removeEventListener('abort', onAbort));
  return { pid: child.pid, stop, result };
}

export const runProcess: Runner = (command, args, options = {}) =>
  spawnGroup(command, args, options).result;
