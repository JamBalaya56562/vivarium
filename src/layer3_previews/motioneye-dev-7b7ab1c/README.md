# motionEye dev at 7b7ab1c — does the Android app keep its sign-in?

The `dev` branch of motionEye at
[7b7ab1c](https://github.com/motioneye-project/motioneye/commit/7b7ab1c97ff7c89e55f615826aec835a6269c7aa),
with no pull request. It is the baseline for
[#3364](https://github.com/motioneye-project/motioneye/issues/3364): opened
from the home screen on Android as an installed app (PWA), motionEye asks for
the login every time. Its `user` session cookie is `SameSite=Strict`.
[`motioneye-3523`](../motioneye-3523/) is the pull request that makes it
`SameSite=Lax`, for comparison.

## Checking it in the preview

1. On an Android phone, open the preview link in Chrome and sign in to GitHub.
2. Sign in to motionEye as `admin` with the password `password`.
3. Install it from Chrome's menu (**Add to home screen** or **Install app**).
4. Close Chrome, then open motionEye from the home screen. Note whether it
   shows the cameras or the login dialog.
5. Do the same with `motioneye-3523` and compare.

The preview's own access cookie lasts a day and is `SameSite=Lax`; after a day
the home-screen app is sent to the GitHub sign-in again, which is not the
behaviour under test.
