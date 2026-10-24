export const DEFAULT_XTERM_VERSION = '6.0.0';
export const DEFAULT_XTERM_FIT_VERSION = '0.11.0';

export interface XtermTerminal {
  readonly element: HTMLElement | undefined;
  open(parent: HTMLElement): void;
  write(data: string): void;
  reset(): void;
  focus(): void;
  dispose(): void;
  loadAddon(addon: unknown): void;
  onData(listener: (data: string) => void): unknown;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
}

export interface XtermFit {
  fit(): void;
}

export interface Xterm {
  Terminal: new (options: Record<string, unknown>) => XtermTerminal;
  FitAddon: new () => XtermFit;
}

const STYLESHEET_ID = 'vh-xterm-css';

export function xtermUrls(
  version = DEFAULT_XTERM_VERSION,
  fitVersion = DEFAULT_XTERM_FIT_VERSION,
) {
  return {
    module: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${version}/lib/xterm.mjs`,
    stylesheet: `https://cdn.jsdelivr.net/npm/@xterm/xterm@${version}/css/xterm.css`,
    fit: `https://cdn.jsdelivr.net/npm/@xterm/addon-fit@${fitVersion}/lib/addon-fit.mjs`,
  };
}

let loading: Promise<Xterm> | null = null;

export function loadXterm(
  importModule: (url: string) => Promise<unknown> = (url) =>
    import(/* @vite-ignore */ url),
): Promise<Xterm> {
  if (loading !== null) return loading;
  const urls = xtermUrls();
  if (document.getElementById(STYLESHEET_ID) === null) {
    const link = document.createElement('link');
    link.id = STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = urls.stylesheet;
    document.head.append(link);
  }
  loading = Promise.all([importModule(urls.module), importModule(urls.fit)])
    .then(([core, fit]) => ({
      Terminal: (core as Pick<Xterm, 'Terminal'>).Terminal,
      FitAddon: (fit as Pick<Xterm, 'FitAddon'>).FitAddon,
    }))
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}
