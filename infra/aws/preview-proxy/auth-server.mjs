import { createAuth, settings } from './auth.mjs';
import { head, listen } from './http.mjs';

const respond = createAuth({ config: settings() });

listen(async (event, response) => {
  const answer = await respond(event);
  head(response, answer).end(answer.body);
});
