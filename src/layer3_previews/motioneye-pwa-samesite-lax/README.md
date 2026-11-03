# motionEye dev with a SameSite=Lax session cookie — does the Android app keep its sign-in?

[motioneye-dev-7b7ab1c](../motioneye-dev-7b7ab1c/) with one change, from
[JamBalaya56562/motioneye@5ee7869](https://github.com/JamBalaya56562/motioneye/commit/5ee7869c3710ce4135cf803e87338c1cd4ca8d85):
`motioneye/handlers/login.py` sets the `user` session cookie with
`samesite='Lax'` instead of `'Strict'`. It is not a pull request; it checks
whether that one attribute is behind
[#3364](https://github.com/motioneye-project/motioneye/issues/3364), where an
Android home-screen app (PWA) asks for the login every time.

## Checking it in the preview

Follow the steps in [motioneye-dev-7b7ab1c](../motioneye-dev-7b7ab1c/README.md)
with this preview's link, and compare what step 4 shows in the two.
