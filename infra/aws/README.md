# `infra/aws/` — preview environments on Lambda MicroVMs

OpenTofu configuration for running a project's backend, at a given commit, as
a preview a reviewer opens in a browser. Each preview is a
[Lambda MicroVM](https://docs.aws.amazon.com/lambda/latest/dg/microvms-launching.html)
image built from that commit, reached at a host of its own through CloudFront
and one Lambda Web Function.

The first preview ran motionEye with four fake cameras. The approach was tried
step by step in a spike first
([aletheia-works/vivarium#615](https://github.com/aletheia-works/vivarium/pull/615)).

## What is managed

| File | Resources |
|---|---|
| [iam.tf](iam.tf) | The CI roles for plan and apply and the permissions boundary, created by hand and imported |
| [storage.tf](storage.tf) | The private, versioned S3 bucket for the images' code artifacts and the Web Functions' code, with the policy that lets Lambda read the latter |
| [previews.tf](previews.tf) | Per preview: the MicroVM image. Shared: the proxy Web Function, its revision, endpoint, role and log groups, and the build role and log group |
| [auth.tf](auth.tf) | The GitHub sign-in shared by every preview: its Web Function, revision, endpoint, role and log groups, the session key, and the list of previews and who gets into each |
| [cdn.tf](cdn.tf) | The two CloudFront distributions, the origin access control that keeps the Web Functions behind them, the cache policy and the function that passes on the viewer's host |
| [dns.tf](dns.tf) | The wildcard ACM certificate and the DNS records, in the existing Route 53 hosted zone of the domain in [`src/layer3_previews/domain.json`](../../src/layer3_previews/domain.json) |
| [network.tf](network.tf) | The egress connector the proxy runs every preview MicroVM with: a VPC with no internet gateway, NAT or DNS resolver, two subnets, a security group with no rules, and the role Lambda uses for the connector's network interfaces |

Each preview is a recipe under [`src/layer3_previews/`](../../src/layer3_previews/README.md):
a `<project>-<pull>/preview.json` naming the repository, the pull request and
the commit, or a `<project>-<name>/preview.json` without a pull request,
optionally with the `source` repository the commit is downloaded from. `previews.tf` reads them, so adding a recipe adds a preview and
removing it removes the preview.

### The image

The code artifact is a zip of [motioneye/Dockerfile.tftpl](motioneye/Dockerfile.tftpl)
and the files beside it. The build downloads the commit's tarball from GitHub
and installs it, so the zip carries no file modes that matter. The image adds:

- `fakecam.py`: four cameras on `127.0.0.1:9900`, each a moving square and the
  time, so the preview needs no real camera.
- `seed.py`: adds the four cameras to motionEye's configuration at build time,
  and sets the `admin` and `user` passwords to `password`. motionEye applies no
  setting while either password is empty, and the GitHub sign-in already
  keeps strangers out, so the passwords only spare the reviewer that step.
- `hooks.py`: the lifecycle hooks on port 9000. `ready` and `validate` answer
  200 only once motionEye serves a picture from every camera and mailpit
  answers on its UI, on 1025 and over TLS on 1465, and the upload targets
  and listing answer, so Lambda snapshots a running motionEye with frames
  flowing, mail being caught and uploads being received.
- mailpit 1.33.0, downloaded at build time and checked against its SHA-256,
  with a self-signed certificate made at build time. It takes SMTP on
  `127.0.0.1:1025` (plain or STARTTLS) and serves its UI on port 8025 under
  `/mailpit/`. It is never given a relay, so mail stays in the MicroVM.
- `smtps.py`: implicit TLS on `127.0.0.1:1465`, passed on to mailpit, for
  motionEye's TLS mode.
- `media.py`: at build time, two days of pictures and short MP4 movies per
  camera, dated before the build, so the media browser is not empty.
- Upload targets for motionEye's upload and network-share settings: vsftpd
  (FTP and explicit FTPS, `vsftpd.conf`), OpenSSH for SFTP only
  (`sshd.conf`) and Samba (`smb.conf`), all on `127.0.0.1` with the user
  `preview` and the password `password`, plus `uploads.py`, which lists what
  arrived at `/uploads/` on port 8030. They are installed after
  `motioneye_init`, because they pull in systemd and `motioneye_init` stops
  before writing motionEye's configuration when it finds systemd.
- RustFS, for a recipe whose `preview.json` lists `"s3"` in `services`:
  `Dockerfile.tftpl` adds it in a block of its own, `s3bucket.py` makes the
  `motioneye` bucket at build time, and it serves S3 over TLS on
  `127.0.0.1:9100` with the shared certificate. `entrypoint.sh`, the hooks
  and `uploads.py` use it only when `/usr/local/bin/rustfs` exists. A plan
  refuses any other value in `services`.

The image is ARM_64 with 1 GB.

### The proxy

[preview-proxy/index.mjs](preview-proxy/index.mjs) is one Web Function behind
one distribution, `*.<domain>`. A CloudFront function copies the viewer's host
into a header, which the proxy reads to pick the preview; any other host gets
404.

- **Reaching it**: the endpoint is `IamAuth`, and its resource policy allows
  only this distribution, which signs its requests through origin access
  control with `always-amz-auth`. So the endpoint's own domain answers 403, and
  a preview's `POST` and `Authorization` header reach the application unchanged.
  A function URL behind origin access control could do neither: it needs a hash
  of the body from the browser, and takes `Authorization` for the signature.
- **Cache**: the cache policy has a one-second ceiling and keys on the host,
  every cookie, `Authorization` and the query, because CloudFront forwards
  `Authorization` on a `GET` only when the policy names it, and a policy cannot
  name headers with every TTL at zero.
- **Access**: except for a `public` path (below), a request without a
  valid session cookie is sent to the sign-in below, before any AWS call.
  The sign-in comes back with `?vivarium-ticket=<ticket>`, valid for a
  minute and for this preview only;
  the proxy turns it into an `HttpOnly` session cookie for a day and
  redirects to the same path without the ticket, and logs the GitHub login.
  The paths a recipe lists as `public` in `preview.json` reach the proxy as
  `PUBLIC_PATHS`, and a `GET` or `HEAD` to one of them needs no session. The
  proxy then lists the image's MicroVMs and forwards the request only to
  one that is `RUNNING`; otherwise it answers 503, and it never starts or
  resumes a MicroVM for such a request. Such a request is traffic to a
  running MicroVM, so polling a public path may keep a preview from
  suspending, up to its 8 hours in all. That is accepted: only a
  signed-in visitor can start or resume one, and the paths are meant to be
  as harmless as motionEye's manifest and icon.
- **The MicroVM**: the proxy reuses the image's live MicroVM, or starts one.
  The MicroVM suspends after 5 minutes without traffic, resumes on the next
  request, and ends after an hour suspended or 8 hours in all.
- **Forwarding**: the proxy reads its routes from the image template's
  `routes.json`, a map of path prefixes to ports, and sends each path to the
  port of its longest matching prefix, or to the port for `/`. For motionEye
  ([motioneye/routes.json](motioneye/routes.json)) that is `/mailpit/` to
  mailpit on 8025, `/uploads/` to the upload listing on 8030 and everything
  else to motionEye on 8765. It streams the answers back to the browser for up
  to 60 seconds, the revision's timeout, and buffers each request body in
  memory, since the platform delivers no answer before it has the whole request.
  A body over 64 MiB gets 413, because an execution environment has a fixed 2 GB
  that concurrent requests share.
  Its MicroVM token allows only the ports in `routes.json`.

Before applying, the apply workflow ends the MicroVMs of every image the plan
deletes or replaces ([preview-proxy/end-microvms.mjs](preview-proxy/end-microvms.mjs)):
deleting an image failed while a MicroVM a reviewer had used was still
suspended.

### The sign-in

[preview-proxy/auth.mjs](preview-proxy/auth.mjs) is a second Web Function,
behind its own distribution at `sign-in.<domain>`, kept apart so the proxy
never holds the OAuth secret. A preview's link is
`https://sign-in.<domain>/<preview>/`, and the proxy sends a reviewer without a session
there too, with the path they asked for.

1. It sends the browser to GitHub's OAuth authorize page with no scope and a
   signed state, bound to a cookie and good for ten minutes.
2. On `/callback` it checks the state and its cookie, trades the code for a
   token, and asks GitHub who signed in. It asks for the pull request's
   author only when the login is not already listed and the preview has a
   pull request.
3. A login in the preview's list ([`src/layer3_previews/`](../../src/layer3_previews/README.md#who-gets-in))
   or the author gets a ticket and is sent to the preview's own URL; anyone
   else gets 403. The token is not kept.

It reads the list from its `PREVIEWS` environment variable, which OpenTofu
writes, so a change to who gets in makes a new revision. The sign-in and the proxy sign their state, tickets
and sessions with one key, `random_password.preview_session`; replacing it
signs everyone out. The proxy checks only a session's signature, expiry and
preview, not the list, so a login taken off the list keeps its session for up
to a day; replacing the key is the way to end it sooner.

Every preview is a sibling host of the sign-in and runs a pull request's code,
so the session and state cookies use the `__Host-` prefix: no sibling can set
them, or read them from its own host.

Siblings are same-site, so `SameSite`, even `Strict`, does not stop a preview's
page from sending a request to another preview with the reviewer's session. The
proxy stops it instead: it answers 403 to `Sec-Fetch-Site: same-site` unless the
request is a top-level `GET` or `HEAD` navigation, the rule `SameSite=Lax` gave
while previews were cross-site. A browser that sends no `Sec-Fetch-Site` is not
stopped.

The GitHub OAuth app belongs to the organisation. Its client ID is the
`PREVIEW_GITHUB_CLIENT_ID` repository variable and its secret the
`PREVIEW_GITHUB_CLIENT_SECRET` secret, which the plan and the apply pass to
OpenTofu. Until both are set, a link answers 503.

`mise run ci:previews` runs its tests without AWS, and CI runs them on a PR
that changes the proxy or the sign-in. `mise run infra:aws:check` lints them with the docs
site's Biome settings.

### Cost

In the spike, an hour of one reviewer watching four cameras came to about
$0.15. That figure is an estimate from third-party us-east-1 rates, not a
bill. A suspended MicroVM costs no compute.

## CI

[aws-terraform-plan.yml](../../.github/workflows/aws-terraform-plan.yml)
plans a PR that changes this module and posts the plan on it.
[aws-terraform-apply.yml](../../.github/workflows/aws-terraform-apply.yml)
applies `main`. Both follow formicarium's `infra/aws`: they assume a role
through GitHub's OIDC token, so no AWS key is stored; the plan runs on
`pull_request_target` only for a PR from this repository or from someone with
write access; and the state is encrypted with `TF_STATE_PASSPHRASE` and kept
as the `terraform-state-aws` artifact of the run that
`LATEST_AWS_APPLY_RUN_ID` names.

The apply reads `LATEST_AWS_APPLY_RUN_ID` through the API when its job
starts, after any earlier apply has finished. `vars.LATEST_AWS_APPLY_RUN_ID`
would not do: it is fixed when the run is queued, so an apply queued behind
another one started from the state before it, undid what the earlier one had
built, and saved that older state.

Retry a failed apply with a new run (`gh workflow run aws-terraform-apply.yml
--ref main`), not a re-run: a re-run applies the commit it was started for,
which may be older than `main`.

The account runs other stacks, so the roles are narrow. Both read through
`tofu-read` ([bootstrap/read-policy.json.tftpl](bootstrap/read-policy.json.tftpl)).
The apply role, which only the `aws-apply` environment on `main` can assume,
may write only `vivarium-*` buckets, functions, MicroVM images, roles and
`/vivarium/*` log groups, network connectors, and VPCs, subnets and security
groups tagged `Project=vivarium`, and may create a role only inside the
`vivarium-workload-boundary` permissions boundary. It cannot change the
boundary or the CI roles: they are made by hand from [bootstrap/](bootstrap/),
and a plan reports any change made to them since.

## Setup (日本語)

AWS の認証情報は、この会話や tfvars に貼り付けません。すべて本人の端末で、本人の
認証情報を使って実行します。aws CLI は Docker で動かします。以下は PowerShell で、
リポジトリの `infra/aws` を current directory にして実行します。

### 0. ログインと認証情報

```powershell
$docker = "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
& $docker run --rm -it -v "$HOME\.aws:/root/.aws" amazon/aws-cli:2.37.12 login --remote
& $docker run --rm -v "$HOME\.aws:/root/.aws" amazon/aws-cli:2.37.12 configure export-credentials --format powershell | Invoke-Expression
```

### 1. CI の role と permissions boundary を手で作る

template の `${account_id}` と `${subject_prefix}` と `${preview_domain}` を置き換えて、`.build/bootstrap/` に
書き出してから作ります。tag は provider の `default_tags` と同じにします（違うと plan が
tag の変更を出し、apply の role はこれらを変えられないので失敗します）。

```powershell
$aws = { & $docker run --rm -v "$HOME\.aws:/root/.aws" -v "${PWD}\.build\bootstrap:/bootstrap" amazon/aws-cli:2.37.12 @args }
$account = & $aws sts get-caller-identity --query Account --output text
New-Item -ItemType Directory -Force .build\bootstrap | Out-Null
$domain = (Get-Content ..\..\src\layer3_previews\domain.json -Raw | ConvertFrom-Json).domain
foreach ($name in 'workload-boundary', 'trust-plan', 'trust-apply', 'read-policy', 'apply-policy') {
  (Get-Content "bootstrap\$name.json.tftpl" -Raw).Replace('${account_id}', $account).Replace('${subject_prefix}', 'repo:aletheia-works/vivarium').Replace('${preview_domain}', $domain) |
    Set-Content -NoNewline ".build\bootstrap\$name.json"
}
$tags = 'Key=Project,Value=vivarium', 'Key=ManagedBy,Value=opentofu'

& $aws iam create-policy --policy-name vivarium-workload-boundary --description 'The most any role this module creates may do.' --policy-document file:///bootstrap/workload-boundary.json --tags @tags

& $aws iam create-role --role-name github-actions-vivarium-tofu-plan --description 'OpenTofu plan for infra/aws. Reads this module only.' --assume-role-policy-document file:///bootstrap/trust-plan.json --tags @tags
& $aws iam put-role-policy --role-name github-actions-vivarium-tofu-plan --policy-name tofu-read --policy-document file:///bootstrap/read-policy.json

& $aws iam create-role --role-name github-actions-vivarium-tofu-apply --description 'OpenTofu apply for infra/aws from main.' --assume-role-policy-document file:///bootstrap/trust-apply.json --tags @tags
& $aws iam put-role-policy --role-name github-actions-vivarium-tofu-apply --policy-name tofu-read --policy-document file:///bootstrap/read-policy.json
& $aws iam put-role-policy --role-name github-actions-vivarium-tofu-apply --policy-name tofu-apply --policy-document file:///bootstrap/apply-policy.json
```

GitHub の OIDC provider（`token.actions.githubusercontent.com`）は、この account に既に
あるもの（formicarium と共有）を使います。新しくは作りません。

network connector を作るには、account に 1 つの service-linked role
`AWSServiceRoleForLambda` が要ります。apply の role には作る権限が無いので、まだ無い
account では 1 度だけ手で作ります。

```powershell
& $aws iam create-service-linked-role --aws-service-name lambda.amazonaws.com
```

### 2. GitHub 側

- [vivarium の Actions の変数](https://github.com/aletheia-works/vivarium/settings/variables/actions)
  に、次の 2 つを登録します。ARN には account ID が入るので、repo のコードには書きません。
  - `AWS_TOFU_PLAN_ROLE_ARN`：`arn:aws:iam::<account>:role/github-actions-vivarium-tofu-plan`
  - `AWS_TOFU_APPLY_ROLE_ARN`：`arn:aws:iam::<account>:role/github-actions-vivarium-tofu-apply`
- `aws-apply` environment は infra/github の `github_repository_environment.aws_apply` が
  作ります。この PR のマージで infra/github の Apply も走ります。
- state の暗号化は、infra/github と同じ organization secret の `TF_STATE_PASSPHRASE` を
  使います。`LATEST_AWS_APPLY_RUN_ID` は最初の Apply が作ります。

### 3. 最初の Apply

マージすると AWS Terraform Apply が走り、import block で手作りの role と boundary を
取り込み、残りを作って、state を保存します。infra/github の Apply より先に走って
`aws-apply` environment がまだ無いと失敗するので、そのときは infra/github の Apply が
終わってから AWS Terraform Apply を `workflow_dispatch` で新しく実行してください。

### 4. GitHub の OAuth App

サインインの URL は `https://sign-in.<domain>` です。Apply の summary に出る
`Sign-in callback` の URL を使って、organization の OAuth App を 1 つ作ります。

1. aletheia-works の Settings → Developer settings → OAuth Apps → New OAuth App
2. Homepage URL は `https://aletheia-works.github.io/vivarium/`、
   Authorization callback URL は summary の `Sign-in callback`
3. Client ID を repository variable の `PREVIEW_GITHUB_CLIENT_ID` に、作った
   Client secret を secret の `PREVIEW_GITHUB_CLIENT_SECRET` に登録する
4. AWS Terraform Apply を `workflow_dispatch` で新しく実行する

それまでは、リンクを開くと 503 になります。

### 5. レビュアーに渡すリンク

リンクに秘密は入っていません。Apply の summary の `Preview links` に、プレビューごとに
出ます。

### ドメインを変えるとき

`src/layer3_previews/domain.json` の domain に対応する公開 hosted zone が Route 53 に
既にある必要があります。OpenTofu は zone を読むだけで、作りません。registrar が
Route 53 でなければ、その NS を registrar 側に設定します。変えるときは次の順です。

1. `domain.json` を変えて、`docs` で `bun run generate-index` を実行する
2. 次の節のとおり、`apply-policy` を手で更新する（`${preview_domain}` が入っています）
3. マージしたら、OAuth App の callback URL を summary の `Sign-in callback` に変える

### CI の role と boundary を変えるとき

`bootstrap/` の template を変えた PR は、マージの前に、変えた policy を手順 1 と同じ方法で
手で更新します（apply の role はこれらを変えられないので、更新しないと Apply が
失敗します）。inline policy は `iam put-role-policy`、boundary は
`iam create-policy-version --set-as-default` です。
