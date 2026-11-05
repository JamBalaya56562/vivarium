# motionEye #3524 — API keys for scripts and integrations

[motioneye-project/motioneye#3524](https://github.com/motioneye-project/motioneye/pull/3524)
adds named API keys that act as the admin or the surveillance user, sent as
`Authorization: Bearer <key>` or as the password of basic auth. It closes
[#921](https://github.com/motioneye-project/motioneye/issues/921),
[#1137](https://github.com/motioneye-project/motioneye/issues/1137),
[#1418](https://github.com/motioneye-project/motioneye/issues/1418) and
[#1845](https://github.com/motioneye-project/motioneye/issues/1845), so
`preview.json` has `issue: 0` rather than one of the four.

## Checking it in the preview

1. Open the preview link, sign in to GitHub, then sign in to motionEye as
   `admin` with the password `password`.
2. Open **Settings › General Settings › API Keys › Manage** and create one key
   for the admin and one for the surveillance user. Each key is shown once;
   the list shows its last characters.
3. The preview's GitHub sign-in stops a `curl` from outside, so send requests
   from the browser's console on the preview's page:

   ```js
   const status = (path, token) =>
     fetch(path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status);
   ```

4. Compare the status codes with the table, using `await status(path, key)`.

   | Path | Admin key | Surveillance key | Wrong key |
   |---|---|---|---|
   | `/config/list/` | 200 | 200 | 403 |
   | `/config/1/get/` | 200 | 403 | 403 |
   | `/apikey/list/` | 403 | 403 | 403 |

   A wrong key gets 403 even though the session cookie is sent with it, and a
   key cannot manage keys. A wrong key has to start with `meye_`: any other
   bearer token is not treated as a key, and the session answers instead.
5. Reopen the list and check that it shows when each key was last used.
6. Revoke a key, send it again, and confirm that it now gets 403.

Integrations such as Home Assistant cannot be tried here, because a preview
has no outbound network.
