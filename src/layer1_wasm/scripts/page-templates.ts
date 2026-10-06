export const SCRIPT_TEMPLATE = 'page.template.html';
export const TERMINAL_TEMPLATE = 'page.terminal.template.html';

const TERMINAL_RUNTIMES = new Set(['terrarium']);

export function pageTemplateFor(runtime: string | undefined): string {
  return runtime !== undefined && TERMINAL_RUNTIMES.has(runtime)
    ? TERMINAL_TEMPLATE
    : SCRIPT_TEMPLATE;
}
