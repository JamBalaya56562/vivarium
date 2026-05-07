// Phase 7 B3 — R.2 Path A (Layer 1 source-substitution branch-fix).
//
// Recipe pages opt in by calling `enablePathA({...})` at the end of
// their main run. The helper:
//   1. Mounts a "Try a fix" panel into the recipe page
//      (look for `<section id="path-a-mount">`).
//   2. Reads the page's baseline run (captured by the recipe and passed
//      in via `baseline`) and prepares it as `original-verdict.json`.
//   3. Accepts a fix source via paste / public URL fetch / file pick / URL
//      params (`?fix=` base64url, `?fix_url=`).
//   4. Runs the fix via the recipe's `runFix` callback (which re-uses the
//      already-loaded WASM interpreter), captures it as
//      `branch-fix-verdict.json`.
//   5. Exposes both as downloadable `.json` files the visitor drops on
//      `/repro/compare`.
//
// The captured shape is Contract v1 (Layer 2/3 verdict shape) so R.3
// consumes Path A's output without schema branches. Layer-1-specific
// fields are synthesised:
//   - `image_tag`   = `layer1:<slug>:<sha256(source)[0..12]>`
//   - `image_digest` = empty string (schema explicitly allows empty)
//   - `stderr_tail`  = empty string (Layer 1 has no stderr stream)
//
// Design decisions in ADR-0030 (private memo).

const FIX_PARAM_LIMIT_BYTES = 4 * 1024;

export type VerdictLiteral = "reproduced" | "unreproduced";

/** Captured run produced by the recipe's `runFix` / `baseline` callbacks. */
export interface PathACapturedRun {
  /** Process exit code (0 for clean exit). */
  exitCode: number;
  /** Verdict literal for this run. */
  verdict: VerdictLiteral;
  /** Human-readable explanation, surfaced in the recipe-page UI and
   *  in the captured verdict's metadata. */
  message: string;
  /** Stdout string (typically JSON-stringified result). Goes into the
   *  Contract v1 `stdout` field. */
  stdout: string;
}

/** Contract v1 verdict shape (mirrors Layer 2/3 verdict.json shape). */
export interface ContractV1Verdict {
  contract: "v1";
  verdict: VerdictLiteral;
  exit_code: number;
  image_tag: string;
  image_digest: string;
  captured_at: string;
  stdout: string;
  stderr_tail: string;
}

export interface PathAStrings {
  /** Section heading rendered above the panel. */
  heading: string;
  /** Lead paragraph below the heading. */
  lead: string;
  pasteLabel: string;
  pastePlaceholder: string;
  urlLabel: string;
  urlPlaceholder: string;
  filePickLabel: string;
  runButton: string;
  running: string;
  resetButton: string;
  resetHelp: string;
  resultHeading: string;
  baselineLabel: string;
  branchLabel: string;
  downloadOriginal: string;
  downloadBranchFix: string;
  compareLink: string;
  errorEmpty: string;
  errorTooLarge: string;
  errorFetchFailed: string;
  errorRunFailed: string;
  semanticsHeading: string;
  semanticsBody: string;
  panelEyebrow: string;
}

const DEFAULT_STRINGS: PathAStrings = {
  panelEyebrow: "// PATH A · LAYER 1 BRANCH-FIX",
  heading: "Try a fix in this browser tab",
  lead:
    "Paste an alternative version of the reproduction script — a userland fix your AI agent proposed, for example — and re-run it against the same WASM runtime. The verdict tells you whether the fix avoided the bug.",
  pasteLabel: "Paste fix source",
  pastePlaceholder: "<?php\n// fixed reproduction…",
  urlLabel: "or fetch from URL (raw GitHub / Gist)",
  urlPlaceholder: "https://raw.githubusercontent.com/<user>/<fork>/<branch>/<path>",
  filePickLabel: "or pick a file",
  runButton: "Run fix",
  running: "Running…",
  resetButton: "Reset",
  resetHelp: "Clears the loaded fix and the captured branch-fix verdict.",
  resultHeading: "Captured runs",
  baselineLabel: "Original (baseline)",
  branchLabel: "Branch-fix (your source)",
  downloadOriginal: "Download original-verdict.json",
  downloadBranchFix: "Download branch-fix-verdict.json",
  compareLink: "Compare side-by-side on /repro/compare →",
  errorEmpty:
    "No fix source loaded. Paste a script, supply a URL, or pick a file.",
  errorTooLarge:
    "Fix source exceeds the URL-param limit (4 KiB) when used as `?fix=`. Loading inline anyway — but for sharing prefer `?fix_url=`.",
  errorFetchFailed: "Could not fetch the URL (CORS or network error).",
  errorRunFailed: "The runtime errored before producing a verdict.",
  semanticsHeading: "What the verdict means",
  semanticsBody:
    "`reproduced` means the bug still triggers — your fix did not avoid the bug. `unreproduced` means the bug did not trigger — your fix steered around the broken code path.",
};

const DEFAULT_STRINGS_JA: Partial<PathAStrings> = {
  panelEyebrow: "// PATH A · LAYER 1 BRANCH-FIX",
  heading: "このブラウザタブで fix を試す",
  lead:
    "再現スクリプトの代替版 (例: AI エージェントが提案したユーザーランドの fix) をペーストし、同じ WASM ランタイムで再走させる。verdict が fix がバグを回避できたかどうかを教える。",
  pasteLabel: "fix ソースをペースト",
  pastePlaceholder: "<?php\n// 修正版の再現…",
  urlLabel: "または URL から取得 (raw GitHub / Gist)",
  urlPlaceholder: "https://raw.githubusercontent.com/<user>/<fork>/<branch>/<path>",
  filePickLabel: "またはファイルを選択",
  runButton: "fix を実行",
  running: "実行中…",
  resetButton: "リセット",
  resetHelp: "読み込まれた fix とキャプチャされた branch-fix verdict をクリアする。",
  resultHeading: "キャプチャされた run",
  baselineLabel: "オリジナル (ベースライン)",
  branchLabel: "Branch-fix (あなたのソース)",
  downloadOriginal: "original-verdict.json をダウンロード",
  downloadBranchFix: "branch-fix-verdict.json をダウンロード",
  compareLink: "/repro/compare で side-by-side 比較 →",
  errorEmpty:
    "fix ソースが読み込まれていない。スクリプトをペーストするか、URL を指定するか、ファイルを選択する。",
  errorTooLarge:
    "fix ソースが `?fix=` の URL パラメータ上限 (4 KiB) を超過。インラインで読み込みは継続するが、共有時は `?fix_url=` を推奨。",
  errorFetchFailed: "URL を取得できなかった (CORS またはネットワークエラー)。",
  errorRunFailed: "ランタイムが verdict 生成前にエラーした。",
  semanticsHeading: "verdict の意味",
  semanticsBody:
    "`reproduced` はバグがまだ trigger される — fix がバグを回避できていない。`unreproduced` はバグが trigger されない — fix が壊れた code path を回避できている。",
};

export interface PathAOptions {
  /** Recipe slug — used in the synthesised image_tag and the
   *  comparison-page deep-link. */
  slug: string;
  /** The recipe's default reproduction source. Used to compute a
   *  source-hash differentiator and as the placeholder text in the
   *  panel's textarea. */
  baselineSource: string;
  /** The captured baseline run (the recipe's normal verdict). The
   *  panel renders this as the "original" side for downloads. */
  baseline: PathACapturedRun;
  /** Run the substituted source through the same WASM interpreter
   *  the recipe page already loaded. The callback owns the actual
   *  re-run. */
  runFix: (source: string) => Promise<PathACapturedRun>;
  /** UI strings. Pages can override per-language; the panel does not
   *  read `<html lang>` itself to keep the surface explicit. */
  strings?: Partial<PathAStrings>;
  /** Mount selector. Defaults to `#path-a-mount`. */
  mountSelector?: string;
  /** Override `window.location` for tests. */
  locationOverride?: { search: string; origin: string; pathname: string };
}

interface RuntimeState {
  baseline: PathACapturedRun;
  baselineSource: string;
  branchSource: string | null;
  branchRun: PathACapturedRun | null;
  busy: boolean;
}

/* ------------------------------------------------------------------------ */
/* Hash + base64url helpers                                                 */
/* ------------------------------------------------------------------------ */

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

function base64UrlDecode(input: string): string {
  let padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const rem = padded.length % 4;
  if (rem === 2) padded += "==";
  else if (rem === 3) padded += "=";
  else if (rem !== 0) throw new Error("invalid base64url length");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ------------------------------------------------------------------------ */
/* Verdict synthesis                                                        */
/* ------------------------------------------------------------------------ */

async function captureToVerdict(
  slug: string,
  source: string,
  capture: PathACapturedRun,
): Promise<ContractV1Verdict> {
  const hash = (await sha256Hex(source)).slice(0, 12);
  return {
    contract: "v1",
    verdict: capture.verdict,
    exit_code: capture.exitCode,
    image_tag: `layer1:${slug}:${hash}`,
    image_digest: "",
    captured_at: new Date().toISOString(),
    stdout: capture.stdout,
    stderr_tail: "",
  };
}

/* ------------------------------------------------------------------------ */
/* Panel                                                                    */
/* ------------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | undefined> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    node.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

interface PanelHandle {
  setStatus(text: string, kind: "info" | "error" | "ok"): void;
  setBranchRun(run: PathACapturedRun, branchVerdict: ContractV1Verdict): void;
  resetBranch(): void;
  setBusy(busy: boolean): void;
  pasteEl: HTMLTextAreaElement;
  urlEl: HTMLInputElement;
  fileEl: HTMLInputElement;
  runBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
}

function buildPanel(
  mount: HTMLElement,
  s: PathAStrings,
  state: RuntimeState,
  originalVerdict: ContractV1Verdict,
  slug: string,
): PanelHandle {
  mount.classList.add("vh-path-a");

  const panelEyebrow = el(
    "p",
    { class: "vh-path-a__eyebrow" },
    s.panelEyebrow,
  );
  const heading = el("h2", { class: "vh-path-a__heading" }, s.heading);
  const lead = el("p", { class: "vh-path-a__lead" }, s.lead);

  const pasteLabel = el("span", { class: "vh-path-a__field-label" }, s.pasteLabel);
  const pasteEl = el("textarea", {
    class: "vh-path-a__textarea",
    rows: "10",
    spellcheck: "false",
    placeholder: s.pastePlaceholder,
  }) as HTMLTextAreaElement;

  const pasteField = el("label", { class: "vh-path-a__field" }, pasteLabel, pasteEl);

  const urlLabel = el("span", { class: "vh-path-a__field-label" }, s.urlLabel);
  const urlEl = el("input", {
    class: "vh-path-a__input",
    type: "url",
    placeholder: s.urlPlaceholder,
    spellcheck: "false",
    autocapitalize: "off",
    autocorrect: "off",
  }) as HTMLInputElement;
  const urlField = el("label", { class: "vh-path-a__field" }, urlLabel, urlEl);

  const fileLabel = el("span", { class: "vh-path-a__field-label" }, s.filePickLabel);
  const fileEl = el("input", {
    class: "vh-path-a__file",
    type: "file",
    accept: ".php,.rb,.py,.txt,.text,text/plain",
  }) as HTMLInputElement;
  const fileField = el("label", { class: "vh-path-a__field" }, fileLabel, fileEl);

  const runBtn = el(
    "button",
    { type: "button", class: "vh-path-a__btn vh-path-a__btn--primary" },
    s.runButton,
  ) as HTMLButtonElement;
  const resetBtn = el(
    "button",
    { type: "button", class: "vh-path-a__btn vh-path-a__btn--ghost" },
    s.resetButton,
  ) as HTMLButtonElement;
  const actions = el(
    "div",
    { class: "vh-path-a__actions" },
    runBtn,
    resetBtn,
  );

  const statusEl = el("p", { class: "vh-path-a__status", role: "status" });

  const resultHeading = el(
    "h3",
    { class: "vh-path-a__result-heading" },
    s.resultHeading,
  );
  const downloadsEl = el("div", { class: "vh-path-a__downloads" });
  const compareEl = el("p", { class: "vh-path-a__compare-link" });

  const semanticsEl = el(
    "section",
    { class: "vh-path-a__semantics" },
    el("h3", { class: "vh-path-a__semantics-heading" }, s.semanticsHeading),
    el("p", { class: "vh-path-a__semantics-body" }, s.semanticsBody),
  );

  mount.append(
    panelEyebrow,
    heading,
    lead,
    pasteField,
    urlField,
    fileField,
    actions,
    statusEl,
    resultHeading,
    downloadsEl,
    compareEl,
    semanticsEl,
  );

  const renderDownloads = (
    branchVerdict: ContractV1Verdict | null,
  ): void => {
    downloadsEl.replaceChildren();

    const renderLink = (label: string, verdict: ContractV1Verdict, fileName: string) => {
      const blob = new Blob([JSON.stringify(verdict, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = el(
        "a",
        {
          class: "vh-path-a__download-link",
          href: url,
          download: fileName,
        },
        label,
      );
      return a;
    };

    const originalRow = el(
      "div",
      { class: "vh-path-a__download-row" },
      el("span", { class: "vh-path-a__download-side" }, s.baselineLabel),
      el(
        "span",
        {
          class: `vh-path-a__verdict vh-path-a__verdict--${originalVerdict.verdict}`,
        },
        originalVerdict.verdict,
      ),
      renderLink(s.downloadOriginal, originalVerdict, "original-verdict.json"),
    );
    downloadsEl.append(originalRow);

    if (branchVerdict) {
      const branchRow = el(
        "div",
        { class: "vh-path-a__download-row" },
        el("span", { class: "vh-path-a__download-side" }, s.branchLabel),
        el(
          "span",
          {
            class: `vh-path-a__verdict vh-path-a__verdict--${branchVerdict.verdict}`,
          },
          branchVerdict.verdict,
        ),
        renderLink(s.downloadBranchFix, branchVerdict, "branch-fix-verdict.json"),
      );
      downloadsEl.append(branchRow);
    }
  };

  const renderCompareLink = (): void => {
    compareEl.replaceChildren();
    const compareUrl = `/vivarium/repro/compare?slug=${encodeURIComponent(slug)}`;
    const a = el(
      "a",
      {
        class: "vh-path-a__compare-anchor",
        href: compareUrl,
        target: "_top",
      },
      s.compareLink,
    );
    compareEl.append(a);
  };

  // Initial render: original-only.
  renderDownloads(null);
  renderCompareLink();

  return {
    setStatus(text, kind) {
      statusEl.textContent = text;
      statusEl.classList.remove(
        "vh-path-a__status--info",
        "vh-path-a__status--error",
        "vh-path-a__status--ok",
      );
      statusEl.classList.add(`vh-path-a__status--${kind}`);
    },
    setBranchRun(_run, branchVerdict) {
      renderDownloads(branchVerdict);
    },
    resetBranch() {
      renderDownloads(null);
    },
    setBusy(busy) {
      runBtn.disabled = busy;
      resetBtn.disabled = busy;
      runBtn.textContent = busy ? s.running : s.runButton;
      state.busy = busy;
    },
    pasteEl,
    urlEl,
    fileEl,
    runBtn,
    resetBtn,
  };
}

/* ------------------------------------------------------------------------ */
/* enablePathA                                                              */
/* ------------------------------------------------------------------------ */

export async function enablePathA(opts: PathAOptions): Promise<void> {
  const mountSelector = opts.mountSelector ?? "#path-a-mount";
  const mount = document.querySelector<HTMLElement>(mountSelector);
  if (!mount) {
    // Recipe page didn't include the mount-point — silently no-op so a
    // typo in the recipe HTML doesn't tank the entire page.
    console.warn(
      `path_a: mount-point "${mountSelector}" not found; Path A panel not rendered.`,
    );
    return;
  }

  const s: PathAStrings = { ...DEFAULT_STRINGS, ...(opts.strings ?? {}) };

  const state: RuntimeState = {
    baseline: opts.baseline,
    baselineSource: opts.baselineSource,
    branchSource: null,
    branchRun: null,
    busy: false,
  };

  const originalVerdict = await captureToVerdict(
    opts.slug,
    opts.baselineSource,
    opts.baseline,
  );

  const panel = buildPanel(mount, s, state, originalVerdict, opts.slug);

  const setBranch = async (source: string) => {
    panel.setBusy(true);
    panel.setStatus(s.running, "info");
    try {
      const run = await opts.runFix(source);
      const verdict = await captureToVerdict(opts.slug, source, run);
      state.branchSource = source;
      state.branchRun = run;
      panel.setBranchRun(run, verdict);
      panel.setStatus(`${run.verdict} — ${run.message}`, "ok");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      panel.setStatus(`${s.errorRunFailed} ${message}`, "error");
      state.branchSource = null;
      state.branchRun = null;
      panel.resetBranch();
    } finally {
      panel.setBusy(false);
    }
  };

  const fetchAndSet = async (url: string) => {
    panel.setBusy(true);
    panel.setStatus(s.running, "info");
    try {
      const res = await fetch(url, { mode: "cors", credentials: "omit" });
      if (!res.ok) {
        panel.setStatus(`${s.errorFetchFailed} (HTTP ${res.status})`, "error");
        panel.setBusy(false);
        return;
      }
      const text = await res.text();
      panel.pasteEl.value = text;
      await setBranch(text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      panel.setStatus(`${s.errorFetchFailed} (${message})`, "error");
      panel.setBusy(false);
    }
  };

  // Wiring — paste / URL / file pick / Run / Reset.
  panel.runBtn.addEventListener("click", async () => {
    const pasteValue = panel.pasteEl.value.trim();
    const urlValue = panel.urlEl.value.trim();
    if (!pasteValue && !urlValue) {
      panel.setStatus(s.errorEmpty, "error");
      return;
    }
    if (pasteValue) {
      await setBranch(pasteValue);
    } else if (urlValue) {
      await fetchAndSet(urlValue);
    }
  });

  panel.resetBtn.addEventListener("click", () => {
    panel.pasteEl.value = "";
    panel.urlEl.value = "";
    state.branchSource = null;
    state.branchRun = null;
    panel.resetBranch();
    panel.setStatus("", "info");
  });

  panel.fileEl.addEventListener("change", async () => {
    const file = panel.fileEl.files?.[0];
    if (!file) return;
    panel.setBusy(true);
    try {
      const text = await file.text();
      panel.pasteEl.value = text;
      await setBranch(text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      panel.setStatus(`${s.errorRunFailed} ${message}`, "error");
    } finally {
      panel.setBusy(false);
    }
    panel.fileEl.value = "";
  });

  // URL-param auto-trigger: `?fix=<base64url>` (≤4 KiB) or `?fix_url=<url>`.
  const loc = opts.locationOverride ?? (typeof window !== "undefined" ? window.location : null);
  if (loc) {
    const params = new URLSearchParams(loc.search);
    const inlineFix = params.get("fix");
    const fixUrl = params.get("fix_url");
    if (inlineFix) {
      try {
        const decoded = base64UrlDecode(inlineFix);
        if (decoded.length > FIX_PARAM_LIMIT_BYTES) {
          panel.setStatus(s.errorTooLarge, "info");
        }
        panel.pasteEl.value = decoded;
        await setBranch(decoded);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        panel.setStatus(`${s.errorRunFailed} ${message}`, "error");
      }
    } else if (fixUrl) {
      panel.urlEl.value = fixUrl;
      await fetchAndSet(fixUrl);
    }
  }
}

/** Pre-bundled Japanese strings — recipes serving a `lang="ja"` page can
 *  pass `enablePathA({ strings: PATH_A_STRINGS_JA, ... })`. */
export const PATH_A_STRINGS_JA: Partial<PathAStrings> = DEFAULT_STRINGS_JA;
