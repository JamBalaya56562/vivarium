# motionEye on a Lambda MicroVM (spike)

Stage 0 of the per-PR preview environment that is to become Layer 3: a
motionEye build, running with its backend, that a maintainer can open from a
link in the pull request description. This directory is a throwaway spike;
stage 1 rewrites it in OpenTofu under `infra/aws/`.

## What the image holds

- motionEye built from a given commit, installed the way its
  `docker/Dockerfile` does it (Debian trixie, motion and ffmpeg from
  `motioneye_init`).
- `preview/fakecam.py`: four fake cameras on `127.0.0.1:9900`, each a JPEG
  with a moving square and the time, so a reviewer can see frames update.
- `preview/seed.py`: runs at build time and registers the four cameras as
  netcams, through motionEye's own `config.add_camera`.
- `preview/hooks.py`: the MicroVM lifecycle hooks on port 9000.
  `ready` and `validate` return 200 once motionEye answers on 8765 and every
  camera's `/picture/<id>/current/` returns a JPEG, and 503 before that.

## Build and run locally

The scripts are PowerShell 7, run from this directory.

```powershell
./pack.ps1 motioneye-project/motioneye 8451b85d
docker build -t vivarium-spike/motioneye-microvm:8451b85d build/8451b85d
docker run -d --name me-spike -p 18765:8765 -p 19000:9000 vivarium-spike/motioneye-microvm:8451b85d
curl.exe -i http://127.0.0.1:19000/aws/lambda-microvms/runtime/v1/ready
```

`pack.ps1` downloads the commit's tarball and writes `build/<commit>/` (the
Docker build context) and `build/<commit>.zip` (the same files, the code
artifact `create-microvm-image` takes). The tarball goes in unextracted and
the Dockerfile extracts it: a zip made on Windows carries no Unix modes, and
Lambda's build then could not run motionEye's `extra/linux_init`.

## Run it on Lambda MicroVMs

`aws.ps1 <step>` runs the AWS CLI through the `amazon/aws-cli:2.37.12`
container with `~/.aws` mounted, in `ap-northeast-1`. It keeps what one step
hands the next in `build/aws.json`, writes each request as a JSON file under
`build/`, and ends each step with an `OK:` line. MicroVM calls name the image
by its ARN, since `get-microvm-image` refuses a bare name. Log in first with
`aws login --remote` in the same container. Each step:

| Step | Creates or changes |
|---|---|
| `setup` | An S3 bucket (public access blocked), a log group kept 7 days, the build role |
| `image <commit>` | Uploads `build/<commit>.zip` and builds an ARM_64 image of 1 GB baseline, with egress to the internet for the build; when the image exists, builds a new version of it |
| `status`, `version [n]`, `logs` | Nothing: the image state, one version's state and reason, and the build log |
| `run` | One MicroVM: ingress only, suspends after 5 idle minutes, ends after an hour at most |
| `token` | An auth token for ports 8765 and 9000, valid for an hour |
| `check` | Nothing: `ready`, `/`, login and the four pictures through the endpoint, saved under `build/shots/` |
| `suspend`, `terminate` | Suspends or ends the MicroVM |
| `proxy` | The proxy function (Node.js 24, arm64) and its role, and a **public** function URL with `RESPONSE_STREAM`; a second run updates the code |
| `link`, `proxy-logs` | Nothing: the URL with its key, and the proxy's log |
| `cleanup` | Deletes the proxy, the image, the bucket, the roles and the log groups |

The resume check is `suspend`, wait until `vm` reports it suspended, then
`check` again: auto-resume should bring it back and the pictures should be
new frames.

## The proxy

`proxy/index.mjs` is the function behind a Lambda function URL with
`RESPONSE_STREAM`. It needs no SDK: like formicarium's relay-token it signs
the MicroVMs REST calls itself.

- `?vivarium-key=<ACCESS_KEY>` sets an `HttpOnly` cookie holding an HMAC of
  the key, then redirects to the same path without it. Any other request
  without that cookie gets 403, before any AWS call.
- It reuses a live MicroVM of the image or starts one, takes a token for port
  8765 only, and keeps it until a minute before it expires.
- It forwards the method, path, query, body and headers, with motionEye's
  cookies but not its own, adds `X-aws-proxy-auth` and `X-aws-proxy-port`,
  and streams the answer back. `Set-Cookie` goes to the function URL's
  cookie list. A failed fetch drops the connection and retries once; a
  second failure is a 503.

`node --test proxy/` runs its tests without AWS. `node proxy/local.mjs` runs
the same code as a plain HTTP server on port 18080 in front of the local
container, with a stand-in for the MicroVMs API.

## Results so far

Step 1, local Docker, motionEye `dev` at `8451b85d` (2026-10-31, amd64):

- `ready` returned 503 twice, then 200 about 10 s after the container started.
- `/` returned 200; after logging in as `admin` with the empty password,
  `/picture/1..4/current/` each returned 200 `image/jpeg` (about 8 KB), and
  two fetches 3 s apart differed.
- After `docker pause` for 40 s and `docker unpause`, four fetches 2 s apart
  all differed and `ready` returned 200 again. This freezes processes the way
  a suspend would, but it is not a Firecracker snapshot restore; step 2
  checks that on Lambda.

Step 3, the proxy, without AWS (2026-11-01):

- `node --test`: 12 tests pass.
- Through `proxy/local.mjs` in front of the container: no cookie 403, the key
  link 302 to `/` with the cookie, `/` 200 (`text/html`, 138 KB), login 200,
  `/picture/1..4/current/` 200 `image/jpeg`, a 218 KB script 200. In a
  browser, logging in showed the settings and camera 1's moving frame.
  The image's motion is 4.7.1 (Debian trixie), not 4.5.1.

Step 2, first Lambda build (2026-11-01): `CREATE_FAILED` in `motioneye_init`
with `PermissionError` on `extra/linux_init`. Reproduced locally by building
from the zip with every file at mode 0644; with the tarball inside, the same
build passes, `linux_init` and `relayevent.sh` are 0755, and `ready` returns
200.

## Open points for step 2

- The image is built for ARM_64, as formicarium's relay is; this spike has
  only run on amd64.
- motionEye makes its cookie secret at start-up, so every MicroVM resumed
  from one image version shares it. One MicroVM per PR keeps this harmless
  for now; a `/run` hook that restarts motionEye would remove it.
- The admin password is empty, as on a fresh install, and the login answers
  `force_password_change: true`.
