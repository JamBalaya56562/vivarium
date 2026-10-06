import { setVerdict } from "./verdict.js";
import { pick } from "./i18n.js";

const S = pick(
  {
    pending: "Loading terrarium…",
    notIsolated:
      "this page is not cross-origin isolated, which terrarium needs for the tool's threads",
  },
  {
    pending: "terrarium を読み込み中…",
    notIsolated:
      "このページは cross-origin isolated ではないため、ツールのスレッドに必要な terrarium を動かせない",
  },
);

export const DEFAULT_TERRARIUM_VERSION = "0.1.0";

export interface ReadyDetail {
  tool: string;
  ref: string;
  commit: string | null;
  seconds: number;
}

export interface ExitDetail {
  command: string;
  code: number;
  output: string;
}

export interface TerrariumTerminal extends HTMLElement {
  readonly ready: Promise<ReadyDetail>;
  readonly transcript: string;
  run(command: string): Promise<ExitDetail>;
}

export interface TerminalOptions {
  tool: string;
  ref: string;
  fixture?: string;
  cwd?: string;
}

export interface LoadResult {
  terrariumVersion: string;
  createTerminal(options: TerminalOptions): TerrariumTerminal;
}

export async function loadTerrarium(
  options: { terrariumVersion?: string; pendingText?: string } = {},
): Promise<LoadResult> {
  const terrariumVersion = options.terrariumVersion ?? DEFAULT_TERRARIUM_VERSION;
  setVerdict("pending", options.pendingText ?? S.pending, "loading");
  emitProgress(10, "Initialising…");

  await waitForIsolatingReload();
  if (!globalThis.crossOriginIsolated) {
    throw new Error(S.notIsolated);
  }

  emitProgress(40, "Fetching terrarium…");
  const moduleUrl = `https://cdn.jsdelivr.net/npm/@aletheia-works/terrarium@${terrariumVersion}/+esm`;
  await import(/* @vite-ignore */ moduleUrl);
  await customElements.whenDefined("terrarium-terminal");
  emitProgress(94, "Runtime ready.");

  return {
    terrariumVersion,
    createTerminal({ tool, ref, fixture, cwd }: TerminalOptions) {
      const terminal = document.createElement(
        "terrarium-terminal",
      ) as TerrariumTerminal;
      terminal.setAttribute("tool", tool);
      terminal.setAttribute("ref", ref);
      if (fixture !== undefined) terminal.setAttribute("fixture", fixture);
      if (cwd !== undefined) terminal.setAttribute("cwd", cwd);
      return terminal;
    },
  };
}

const ISOLATING_RELOAD_TIMEOUT_MS = 15_000;

async function waitForIsolatingReload(): Promise<void> {
  if (globalThis.crossOriginIsolated) return;
  if (!("serviceWorker" in navigator) || navigator.serviceWorker.controller) {
    return;
  }
  await new Promise((resolve) =>
    setTimeout(resolve, ISOLATING_RELOAD_TIMEOUT_MS),
  );
}

function emitProgress(pct: number, label: string): void {
  document.dispatchEvent(
    new CustomEvent("vh-progress", {
      detail: { pct, label, bytes: "", stage: "runtime" },
    }),
  );
}
