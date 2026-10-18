import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2] ?? 8767);

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname.endsWith('/')
      ? `${pathname}index.html`
      : pathname;
    const filePath = resolve(root, `.${relative}`);
    if (!filePath.startsWith(`${root}${sep}`))
      return new Response('Not found', { status: 404 });
    if (pathname === '/') return new Response('vivarium Layer 1 server\n');
    const file = Bun.file(filePath);
    if (!(await file.exists()))
      return new Response('Not found', { status: 404 });
    return new Response(file, { headers: { 'Cache-Control': 'no-store' } });
  },
});
console.log(`vivarium Layer 1 server on http://localhost:${port}`);
