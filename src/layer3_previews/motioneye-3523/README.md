# motionEye #3523 — the session cookie is SameSite=Lax, for installed web apps

[motioneye-project/motioneye#3523](https://github.com/motioneye-project/motioneye/pull/3523)
sets the `user` session cookie with `SameSite=Lax` instead of `Strict`, so
motionEye installed as a web app (PWA) on Android keeps its login when it is
opened again. It addresses
[#3364](https://github.com/motioneye-project/motioneye/issues/3364) without
closing it, so `preview.json` has `issue: 0`.
[`motioneye-dev-7b7ab1c`](../motioneye-dev-7b7ab1c/) is the `dev` branch
before the change, with `SameSite=Strict`, for comparison.

## Checking it in the preview

Follow the steps in [motioneye-dev-7b7ab1c](../motioneye-dev-7b7ab1c/README.md)
with this preview's link, and compare what step 4 shows in the two.
