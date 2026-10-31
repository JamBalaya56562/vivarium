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

```bash
bash pack.sh motioneye-project/motioneye 8451b85d
docker build -t vivarium-spike/motioneye-microvm:8451b85d build/8451b85d
docker run -d --name me-spike -p 18765:8765 -p 19000:9000 vivarium-spike/motioneye-microvm:8451b85d
curl -i http://127.0.0.1:19000/aws/lambda-microvms/runtime/v1/ready
```

`pack.sh` downloads the commit's source and writes `build/<commit>/` (the
Docker build context) and `build/<commit>.zip` (the same files, the code
artifact `create-microvm-image` takes).

## Run it on Lambda MicroVMs

`aws.sh` runs the AWS CLI through the `amazon/aws-cli:2.37.12` container
with `~/.aws` mounted, in `ap-northeast-1`, and keeps what one step hands the
next in `build/aws.env`. Each step is one subcommand:

| Step | Creates or changes |
|---|---|
| `setup` | An S3 bucket (public access blocked), a log group kept 7 days, the build role |
| `image <commit>` | Uploads `build/<commit>.zip`, builds an ARM_64 image of 1 GB baseline, with egress to the internet for the build |
| `status`, `logs` | Nothing: the image state and the build log |
| `run` | One MicroVM: ingress only, suspends after 5 idle minutes, ends after an hour at most |
| `token` | An auth token for ports 8765 and 9000, valid for an hour |
| `check` | Nothing: `ready`, `/`, login and the four pictures through the endpoint, saved under `build/shots/` |
| `suspend`, `terminate` | Suspends or ends the MicroVM |
| `cleanup` | Deletes the image, the bucket, the role and the log group |

The resume check is `suspend`, wait until `vm` reports it suspended, then
`check` again: auto-resume should bring it back and the pictures should be
new frames.

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

## Open points for step 2

- The image is built for ARM_64, as formicarium's relay is; this spike has
  only run on amd64.
- motionEye makes its cookie secret at start-up, so every MicroVM resumed
  from one image version shares it. One MicroVM per PR keeps this harmless
  for now; a `/run` hook that restarts motionEye would remove it.
- The admin password is empty, as on a fresh install, and the login answers
  `force_password_change: true`.
