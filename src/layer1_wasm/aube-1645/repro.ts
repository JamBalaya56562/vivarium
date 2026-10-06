import { loadTerrarium, type TerrariumTerminal } from "../_shared/terrarium_loader.js";
import {
  setResult,
  setVerdict,
  type VivariumResultV1,
} from "../_shared/verdict.js";

const SESSION = [
  "aube install",
  "rm -rf node_modules",
  "aube install --frozen-lockfile",
  "aube list",
  "cat filedep/package.json",
  "cat ../outside/linked/package.json",
];

const LOCAL_PACKAGES = [
  { name: "filedep", manifest: "cat filedep/package.json" },
  { name: "linked", manifest: "cat ../outside/linked/package.json" },
];

const BASELINE_REF = "main";
const FIX_REF = "pr-1645";

interface PackageRow {
  name: string;
  lockfile_version: string | null;
  package_json_version: string | null;
}

interface SessionResult {
  ref: string;
  commit: string | null;
  packages: PackageRow[];
  reproduced: boolean;
  failed_command: string | null;
}

const outputEl = document.getElementById("output");
const outputFixEl = document.getElementById("output-fix");
const metaEl = document.getElementById("meta");

if (!outputEl || !outputFixEl || !metaEl) {
  throw new Error(
    "aube-1645: missing required DOM elements (#output, #output-fix, #meta).",
  );
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

function listedVersions(output: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const m of stripAnsi(output).matchAll(/^[├└]── (\S+) (\S+)$/gm)) {
    versions.set(m[1] as string, m[2] as string);
  }
  return versions;
}

function manifestVersion(output: string): string | null {
  try {
    const version = (JSON.parse(stripAnsi(output)) as { version?: unknown })
      .version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

async function runSession(terminal: TerrariumTerminal): Promise<SessionResult> {
  const { ref, commit } = await terminal.ready;
  const outputs = new Map<string, string>();
  let failed: string | null = null;
  for (const command of SESSION) {
    const { code, output } = await terminal.run(command);
    outputs.set(command, output);
    if (code !== 0 && failed === null) failed = command;
  }
  const listed = listedVersions(outputs.get("aube list") ?? "");
  const packages = LOCAL_PACKAGES.map(({ name, manifest }) => ({
    name,
    lockfile_version: listed.get(name) ?? null,
    package_json_version: manifestVersion(outputs.get(manifest) ?? ""),
  }));
  const reproduced =
    failed === null &&
    packages.every((p) => p.lockfile_version && p.package_json_version) &&
    packages.some((p) => p.lockfile_version !== p.package_json_version);
  return { ref, commit, packages, reproduced, failed_command: failed };
}

function describe(session: SessionResult): string {
  return session.commit
    ? `${session.ref} (${session.commit.slice(0, 8)})`
    : session.ref;
}

function setFixStatus(status: "pending" | "ok" | "error"): void {
  outputFixEl!.dataset["fixStatus"] = status;
}

const startedAt = new Date();

try {
  const { terrariumVersion, createTerminal } = await loadTerrarium();

  const baselineTerminal = createTerminal({ tool: "aube", ref: BASELINE_REF });
  const fixTerminal = createTerminal({ tool: "aube", ref: FIX_REF });
  outputEl.replaceChildren(baselineTerminal);
  outputFixEl.replaceChildren(fixTerminal);

  setVerdict("pending", "Running the aube session in terrarium…", "running");
  const fixSession = runSession(fixTerminal);
  fixSession.catch(() => {});
  const baseline = await runSession(baselineTerminal);

  if (baseline.reproduced) {
    setVerdict(
      "reproduced",
      "bug reproduced — after a frozen-lockfile install, aube list reports file: and link: dependencies as a version other than their package.json's.",
    );
  } else if (baseline.failed_command) {
    setVerdict(
      "unreproduced",
      `bug not reproduced — \`${baseline.failed_command}\` failed in the baseline terminal.`,
    );
  } else {
    setVerdict(
      "unreproduced",
      "bug not reproduced — aube list reports each local dependency's package.json version (likely fixed upstream).",
    );
  }

  const buildEnvelope = (
    fix: SessionResult | null,
  ): VivariumResultV1 => {
    const finishedAt = new Date();
    return {
      contract: "v1",
      bug: {
        project: "aube",
        issue: 1645,
        upstream_url: "https://github.com/aubepkg/aube/pull/1645",
      },
      runtime: {
        name: "terrarium",
        version: terrariumVersion,
        extras: {
          aube: describe(baseline),
          ...(fix ? { aube_fix_candidate: describe(fix) } : {}),
        },
      },
      result: {
        packages: baseline.packages,
        reproduced: baseline.reproduced,
        baseline,
        fix_candidate: fix,
      },
      timing: {
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_ms: finishedAt.getTime() - startedAt.getTime(),
      },
    };
  };

  setResult(buildEnvelope(null));

  let fix: SessionResult | null = null;
  try {
    fix = await fixSession;
    setFixStatus("ok");
  } catch (fixErr: unknown) {
    console.error(fixErr);
    setFixStatus("error");
  }

  metaEl.textContent =
    `aube ${describe(baseline)} (baseline)` +
    (fix ? ` vs ${describe(fix)} (fix candidate)` : "") +
    ` in terrarium v${terrariumVersion}.`;

  setResult(buildEnvelope(fix));
} catch (err: unknown) {
  console.error(err);
  const errAny = err as { stack?: string; message?: string } | null;
  outputEl.textContent =
    (errAny && (errAny.stack ?? errAny.message)) ?? String(err);
  outputFixEl.textContent =
    "Not run — the baseline terminal failed, so there is nothing to compare against.";
  setFixStatus("error");
  if (globalThis.__VIVARIUM_VERDICT__ !== "unreproduced") {
    setVerdict(
      "unreproduced",
      `bug not reproduced — runtime error: ${errAny?.message ?? String(err)}`,
    );
  }
}
