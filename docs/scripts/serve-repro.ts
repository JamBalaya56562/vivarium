import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { SERVICE_WORKER } from './generate-repro-i18n';
import { setupReproDevMiddleware } from './repro-dev-middleware';
import { SITE_BASE } from './site-paths';

type Next = () => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const JA_PREFIX = `${SITE_BASE}ja/repro/`;
const JA_FORMICARIUM = /^[^/]+\/[^/]+\/_formicarium\/[^?#]+$/;

// The deployed /ja/ tree holds the page, its service worker and, for a
// formicarium recipe, its _formicarium/ copy (a Worker must sit inside the
// page's service-worker scope). Every other asset is reached through its
// <base>; serving more here would hide a page whose <base> is wrong.
export function servedByPages(pathname: string): boolean {
  if (!pathname.startsWith(JA_PREFIX)) return true;
  return (
    pathname.endsWith('/') ||
    pathname.endsWith('/index.html') ||
    pathname.endsWith(`/${SERVICE_WORKER}`) ||
    JA_FORMICARIUM.test(pathname.slice(JA_PREFIX.length))
  );
}

function notFound(res: ServerResponse, url: string): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`404: ${url}\n`);
}

function serve(port: number): void {
  const handlers: Handler[] = [];
  setupReproDevMiddleware({
    middlewares: {
      use(handler: Handler): void {
        handlers.push(handler);
      },
    },
  });
  createServer((req, res) => {
    const url = req.url ?? '';
    const { pathname } = new URL(url, 'http://localhost');
    if (!servedByPages(pathname)) {
      notFound(res, url);
      return;
    }

    let index = 0;
    const next: Next = () => {
      const handler = handlers[index];
      index += 1;
      if (handler) {
        handler(req, res, next);
        return;
      }
      if (url === '/') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('vivarium repro server\n');
        return;
      }
      notFound(res, url);
    };
    next();
  }).listen(port, () => {
    process.stdout.write(`vivarium repro server on http://localhost:${port}\n`);
  });
}

if (import.meta.main) serve(Number(process.argv[2] ?? 8769));
