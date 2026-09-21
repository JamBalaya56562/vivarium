#!/usr/bin/env bash
#MISE description="Log in to ghcr.io using a write:packages-scoped PAT file (does not touch gh CLI auth state)"
set -euo pipefail
pat_file="${VIVARIUM_GHCR_PAT_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/vivarium/ghcr-pat}"
if [ ! -f "$pat_file" ]; then
  cat <<MSG >&2
ghcr.io PAT file not found: $pat_file

One-time setup (ghcr.io requires a CLASSIC PAT; fine-grained PATs are
not supported for container-registry auth as of this writing — see
https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry):

  1. https://github.com/settings/tokens/new?scopes=write:packages
     - Note: e.g. "vivarium-ghcr-push"
     - Expiration: 30 days (or shorter)
     - Scopes: write:packages (auto-includes read:packages)
  2. mkdir -p "\$(dirname "$pat_file")"
  3. printf '%s' '<paste-token>' > "$pat_file" && chmod 600 "$pat_file"

The file is read at push time only; the credential is dropped from the
docker config immediately after \`branch-fix:publish\` completes.
MSG
  exit 1
fi
user="${GHCR_USER:-$(gh api user --jq .login 2>/dev/null || true)}"
[ -z "$user" ] && { echo "Set GHCR_USER=<username> or run 'gh auth login'." >&2; exit 1; }
docker login ghcr.io -u "$user" --password-stdin < "$pat_file"
