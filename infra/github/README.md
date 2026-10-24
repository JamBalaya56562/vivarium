# `infra/github/` — GitHub Settings as Code

OpenTofu configuration that manages this repository's settings declaratively.

## Managed resources

| Resource | File |
|---|---|
| Repository | `main.tf` |
| Branch ruleset for `main` | `main.tf` |
| Issue/PR labels | `main.tf` |
| Phase milestones | `main.tf` |

## CI workflows

| Trigger | Workflow | Action |
|---|---|---|
| PR touching `infra/github/**` | `terraform-plan.yml` | Runs `tofu plan` and posts the diff as a PR comment |
| Merge to `main` | `terraform-apply.yml` | Runs `tofu apply` |
| Weekly + post-apply | `terraform-state-backup.yml` | Re-uploads the encrypted state artifact to renew its retention |

## Running locally

### 1. Create a Fine-grained PAT

Create a Fine-grained personal access token at
<https://github.com/settings/personal-access-tokens/new> with:

- **Resource owner**: the organization that owns this repository
- **Repository access**: this repository only
- **Repository permissions**: Administration (RW), Contents (RW), Metadata (R),
  Issues (RW), Pull requests (RW), Actions (RW), Workflows (RW),
  Secrets (RW), Variables (RW), Environments (RW), Webhooks (RW),
  Dependabot alerts (RW), Code scanning alerts (RW)
- **Organization permissions**: none

### 2. Prepare local files

```bash
cd infra/github
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars and set github_owner

export GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
```

### 3. Fetch the latest state

The canonical state lives as an artifact on the most recent successful
`terraform-apply` run. Download it before running `plan`/`apply` locally:

```bash
gh run download --name terraform-state --dir .
```

The state is encrypted. Set `TF_ENCRYPTION` to the configuration CI uses,
with the passphrase from the organization secret `TF_STATE_PASSPHRASE`:

```bash
export TF_ENCRYPTION='
key_provider "pbkdf2" "state" {
  passphrase = "<TF_STATE_PASSPHRASE>"
}
method "aes_gcm" "state" {
  keys = key_provider.pbkdf2.state
}
state {
  method = method.aes_gcm.state
}'
```

### 4. Run tofu

```bash
tofu init
tofu plan
tofu apply
```

## State management

State is stored only as the GitHub Actions artifact `terraform-state` on the
run that the variable `LATEST_APPLY_RUN_ID` names. Anyone can download the
artifacts of a public repository, so Plan and Apply encrypt the state with
the organization secret `TF_STATE_PASSPHRASE`. They still read an
unencrypted state, so the first Apply after the switch writes it encrypted.
The backup workflow only re-uploads that artifact to extend its retention; no
state is published as a Release. The state holds no secrets, and no token is
managed as a resource. If the state is lost, import the live resources
instead of applying from an empty state.

A `concurrency` group serializes workflow runs to avoid concurrent writes;
there is no true distributed lock, so avoid running `apply` locally while CI
is running.

## File layout

```text
infra/github/
├── versions.tf                 # OpenTofu and provider versions
├── providers.tf                # GitHub provider config
├── variables.tf                # Input variables
├── main.tf                     # Repository settings, main ruleset, labels, milestones
├── terraform.tfvars.example    # Template for terraform.tfvars
├── .gitignore                  # Excludes state and secrets
├── .terraform.lock.hcl         # Provider version lock (committed)
└── README.md
```
