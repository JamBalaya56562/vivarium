import { pathToFileURL } from 'node:url';

import { microvms } from './index.mjs';

const ENDING = new Set(['TERMINATING', 'TERMINATED']);
const TIMEOUT_MS = 300_000;
const POLL_MS = 5_000;

async function unended(api, imageArn) {
  const found = [];
  let nextToken;
  do {
    const page = await api.list(imageArn, nextToken);
    for (const item of page.items ?? [])
      if (item.state !== 'TERMINATED') found.push(item);
    nextToken = page.nextToken;
  } while (nextToken);
  return found;
}

export async function endMicrovms(
  api,
  imageArns,
  {
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = console.log,
  } = {},
) {
  const deadline = now() + TIMEOUT_MS;
  for (const imageArn of imageArns) {
    for (;;) {
      const live = await unended(api, imageArn);
      if (!live.length) break;
      for (const microvm of live)
        if (!ENDING.has(microvm.state)) {
          log(
            `terminating ${microvm.microvmId} (${microvm.state}) of ${imageArn}`,
          );
          await api.terminate(microvm.microvmId);
        }
      if (now() >= deadline)
        throw new Error(
          `${imageArn} still has ${live.map((m) => `${m.microvmId} (${m.state})`).join(', ')}`,
        );
      await sleep(POLL_MS);
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const env = process.env;
  await endMicrovms(
    microvms({
      region: env.AWS_REGION,
      credentials: () => ({
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        sessionToken: env.AWS_SESSION_TOKEN,
      }),
    }),
    process.argv.slice(2),
  );
}
