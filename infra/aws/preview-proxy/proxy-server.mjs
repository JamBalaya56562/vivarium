import { head, listen } from './http.mjs';
import { createProxy, createRouter, microvms, settings } from './index.mjs';

const config = settings();

listen(
  createRouter({
    config,
    from: head,
    proxyFor: (preview) =>
      createProxy({ config: preview, api: microvms(preview), from: head }),
  }),
);
