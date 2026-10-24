import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import npm from '../package.json';
import { createServer } from '../src/server';

const npmCli = (args: string[], cwd: string) =>
  execFileSync('bunx', ['npm@latest', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

async function sourceToolNames(): Promise<string[]> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'verify-package', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

async function installedServer(project: string) {
  const client = new Client({ name: 'verify-package', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: join(project, 'node_modules', '.bin', 'vivarium-mcp'),
      cwd: project,
      stderr: 'inherit',
    }),
  );
  try {
    return {
      version: client.getServerVersion()?.version,
      tools: (await client.listTools()).tools.map((tool) => tool.name).sort(),
    };
  } finally {
    await client.close();
  }
}

const root = mkdtempSync(join(tmpdir(), 'vivarium-mcp-'));
try {
  const packed = JSON.parse(
    npmCli(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      resolve(import.meta.dir, '..'),
    ),
  )[npm.name];
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' })}\n`,
  );
  npmCli(
    ['install', '--no-audit', '--no-fund', join(root, packed.filename)],
    project,
  );
  const installed = await installedServer(project);
  const expected = await sourceToolNames();
  if (installed.version !== npm.version) {
    throw new Error(
      `Installed server reports ${installed.version}, expected ${npm.version}`,
    );
  }
  if (JSON.stringify(installed.tools) !== JSON.stringify(expected)) {
    throw new Error(
      `Installed server lists [${installed.tools}], expected [${expected}]`,
    );
  }
  console.log(
    `${packed.filename}: ${packed.entryCount} files, ${installed.tools.length} tools over stdio`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
