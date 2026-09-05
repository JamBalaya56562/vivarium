import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

import { setupReproDevMiddleware } from './repro-dev-middleware';
import { SITE_BASE } from './site-paths';

type Next = () => void;
type Handler = (req: IncomingMessage, res: ServerResponse, next: Next) => void;

const JA_PREFIX = `${SITE_BASE}ja/repro/`;

const port = Number(process.argv[2] ?? 8769);
const handlers: Handler[] = [];

setupReproDevMiddleware({
  middlewares: {
    use(handler: Handler): void {
      handlers.push(handler);
    },
  },
});

// The deployed /ja/ tree holds one file per recipe — the page itself. Every
// other asset is reached through its <base>, which points back at the English
// directory. Serving more here would hide a page whose <base> is wrong.
function servedByPages(pathname: string): boolean {
  if (!pathname.startsWith(JA_PREFIX)) return true;
  return pathname.endsWith('/') || pathname.endsWith('/index.html');
}

function notFound(res: ServerResponse, url: string): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(`404: ${url}\n`);
}

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
