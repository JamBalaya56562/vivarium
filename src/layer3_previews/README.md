# Layer 3 — Live previews

> A pull request's whole application, backend included, running in the
> cloud at that pull request's commit, for a reviewer to use in a browser.
> A commit that is not a pull request yet, such as a branch on a fork, can
> be previewed the same way, to check it before opening one.

---

## What routes here

A change whose effect only shows in the running application: a backend
behaviour a reviewer checks by using the UI, or a UI change that needs a
live backend behind it. Screenshots and test output describe such a change;
a preview lets the reviewer try it.

## What does **not** route here

- A change the reviewer can judge from the diff and the tests alone, such
  as documentation or a refactor.
- A change whose effect does not show through the application, such as how
  files are laid out on a network share.
- A bug that reproduces in the browser or in a container on the reader's
  own machine → Layer 1 or Layer 2.

## How a preview runs

Each preview is a [Lambda MicroVM](https://docs.aws.amazon.com/lambda/latest/dg/microvms-launching.html)
image built from the pull request's commit, at a host of its own under the
domain in [`domain.json`](domain.json), served by CloudFront.
Opening it signs the reviewer in with GitHub, and only the accounts in
[Who gets in](#who-gets-in) are let through. The MicroVM starts
on the first request, suspends after five minutes without traffic, and
resumes on the next one. motionEye previews sign in as `admin` with the
password `password`. [`infra/aws/`](../../infra/aws/README.md) has the
details, the cost, and where a preview's link is listed.

A reader needs only a browser, so a preview clears the bar this layer has
always had: a reader on an ordinary machine can reproduce and check the
result. That bar is why `rr` record-replay, which needs Linux on x86_64
with an exposed PMU, was removed from this layer.

## What a motionEye preview contains

The image template is [`infra/aws/motioneye/`](../../infra/aws/motioneye/).

| Part | What it is |
|---|---|
| motionEye | Installed with pip from the pull request's commit and started by `meyectl startserver`, on port 8765. |
| Cameras | Four network cameras, seeded at build time, reading `http://127.0.0.1:9900/cam1.jpg` to `cam4.jpg`. |
| Fake camera server | `fakecam.py` on `127.0.0.1:9900`. Each frame is a coloured 640×480 JPEG with a moving square and the time, so motion detection has something to see. |
| Sign-in | `admin` and the normal user both have the password `password`, seeded at build time. |
| Media | `media.py` gives every camera two days of recordings at build time, in the two days before the build: three pictures a day and one five-second H.264 MP4, in motion's `%Y-%m-%d/%H-%M-%S` layout under `/var/lib/motioneye/Camera<n>/`. The media browser, previews, downloads and playback have something to show without waiting for motion. |
| Mail | [mailpit](https://mailpit.axllent.org) 1.33.0 catches e-mail and never relays it. SMTP on `127.0.0.1:1025` takes plain text or STARTTLS; `smtps.py` on `127.0.0.1:1465` takes implicit TLS and passes the session to it. Both accept any user name and password, and the certificate is self-signed for `localhost` and `127.0.0.1`. Its web UI is at `/mailpit/` of the preview link, on port 8025. |
| Upload targets | FTP and explicit FTPS (vsftpd) on `127.0.0.1:21`, SFTP (OpenSSH, SFTP only) on `127.0.0.1:22` and an SMB share `//127.0.0.1/preview` (Samba), all with the user `preview` and the password `password`. FTPS uses the same self-signed certificate as mail. Files land in `/srv/uploads/ftp`, `/srv/uploads/sftp` and `/srv/uploads/smb`, and `uploads.py` lists them, with download links, at `/uploads/` of the preview link, on port 8030. Whether motionEye can mount the SMB share inside a Lambda MicroVM, which needs the kernel's CIFS support, has not been checked yet. |
| S3 (opt-in) | Only in a preview whose `preview.json` has `"services": ["s3"]`: RustFS 1.0.4 on `https://127.0.0.1:9100`, with the same self-signed certificate, the access key `preview`, the secret key `password` and a bucket `motioneye` made at build time. Objects are listed at `/uploads/` too. It adds about 264 MB to the image and about 170 MiB of memory, so it stays out of previews that do not need it. |
| Lifecycle hooks | `hooks.py` on port 9000. Lambda calls `ready` and `validate` while it builds the image; both sign in and expect a JPEG from every camera, and expect mailpit's UI, an SMTP greeting on 1025 and 1465, the FTP and SSH greetings, SMB listening and the upload listing, plus a TLS handshake on 9100 in a preview with the S3 target. |

## Network

| Direction | What is open |
|---|---|
| In | Only ports 8765, 8025 and 8030, through CloudFront at the preview's host, once the reviewer has signed in. The proxy sends paths under `/mailpit/` to mailpit on 8025, paths under `/uploads/` to the upload listing on 8030 and everything else to motionEye on 8765, and asks Lambda for a token limited to those three ports, so the hooks port, the fake cameras, SMTP, FTP, SFTP and SMB are not reachable from outside. |
| Out | Nothing. The proxy runs every preview MicroVM with the egress connector in [`infra/aws/network.tf`](../../infra/aws/network.tf). Its VPC has no internet gateway, no NAT and no DNS resolver, and its security group has no rules. The block sits outside the MicroVM, so commands run inside it cannot lift it. Only the image build uses `INTERNET_EGRESS`, to fetch the pull request and its packages. |

So a feature that sends something out, such as a webhook or an upload to
Google Drive, Dropbox or Amazon S3, fails in a preview. E-mail works when it
goes to mailpit: set motionEye's SMTP server to `127.0.0.1`, port 1025 (no
TLS or STARTTLS) or 1465 (TLS), with any account, then read the message at
`/mailpit/`. Uploads work when they go to the FTP, SFTP or SMB targets above;
read the files at `/uploads/`. Everyone let in shares one MicroVM and
motionEye's `admin` sign-in, so what one reviewer stores there, the others
can see.

## Who gets in

The preview's link asks for a GitHub sign-in and lets in:

- the accounts under `all_previews` in [`access.json`](access.json), for
  every preview;
- the accounts listed for the preview's `repository` under `repositories`
  in the same file;
- the accounts in the recipe's own `access`, for that preview only;
- the pull request's author, when the preview has a `pull`.

Logins are compared without case. Anyone else gets 403 after signing in. The
sign-in asks GitHub for no scope and keeps no token, and the preview's own
log records who was let in. The list is checked only at sign-in: someone
taken off it keeps their session until it ends, a day after they signed in.

## Recipes

One directory per pull request, named `<project>-<pull>`, or per commit
that is not a pull request yet, named `<project>-<name>`:

```text
src/layer3_previews/
└── <project>-<pull>/
    ├── preview.json   # repository, pull, issue, commit, optional source, services, access, public
    └── recipe.json    # title, language, severity, tags, as in the other layers
```

`preview.json`, as the first preview (motionEye #3506, removed once it
merged) had it:

```json
{
  "repository": "motioneye-project/motioneye",
  "pull": 3506,
  "issue": 800,
  "commit": "b1a4692397339c75a5d1ce93fa017612c0e80214"
}
```

`services` is optional. `["s3"]` adds the S3 target above; no other value is
accepted.

`access` is optional: a list of GitHub logins let into this preview on top
of those in [Who gets in](#who-gets-in).

`pull` is optional. Leave it out to preview a commit before it becomes a pull
request, for example to check a change on a device before proposing it. The
directory is then `<project>-<name>`: lowercase letters, digits and dashes,
at most 47 characters, and its last part is not only digits, so it cannot be
read as a pull request number. Only the accounts in `access.json` and the
recipe's `access` get in. Remove the directory once the check is done, as
nothing else will.

`source` is optional: the `owner/name` repository the commit is downloaded
from, such as a fork, when it is not in `repository`. `repository` still
names the upstream project, which picks the image template and who gets in.
For example, a branch on a fork:

```json
{
  "repository": "motioneye-project/motioneye",
  "source": "JamBalaya56562/motioneye",
  "issue": 3364,
  "commit": "5ee7869c3710ce4135cf803e87338c1cd4ca8d85"
}
```

`public` is optional: the paths the preview answers to `GET` and `HEAD`
without a sign-in, with any query. Every other path still needs one. Such
a request only reaches a MicroVM that is already running: it never starts or
resumes one, and gets a 503 instead, so the sign-in still decides when a
preview runs. A browser fetches a web app manifest without cookies, so a preview checking
installation as an app lists the manifest and its icons:

```json
"public": ["/manifest.json", "/static/img/motioneye-icon.svg"]
```

`commit` is a full SHA, so a preview shows exactly one state of the pull
request. A new push to the pull request is a new commit here.

Adding a directory adds a preview, and removing it removes the preview: a
pull request to Vivarium that changes a recipe gets an OpenTofu plan, and
merging it applies the plan. Only motionEye has an image template today
([`infra/aws/motioneye/`](../../infra/aws/motioneye/)).

`issue` is the upstream issue the pull request fixes, or 0. The recipes
index lists each preview as a Layer 3 entry with that `issue`, the `pull`
when there is one, the `commit`, a `commit_url` in the `source` repository
and a `preview_url`, and the gallery card opens the preview
directly: a preview has no page of its own on the site. The `preview_url`
is `https://sign-in.<domain>/<directory>/`, with the domain from
[`domain.json`](domain.json). A preview has no README of its own: what it
changes and how to check it are on the pull request, where reviewers read
them, and the card's source button goes there too, or to the commit when
there is no pull request.
