#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

recipes_index=docs/site/public/api/recipes.json
built_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

recipe_field() {
  value="$(jq -r --arg s "$1" \
    ".recipes[] | select(.slug == \$s) | .$2" \
    "$recipes_index")"
  if [ -z "$value" ] || [ "$value" = 'null' ]; then
    echo "::error::${1} has no ${2} in ${recipes_index}" >&2
    return 1
  fi
  printf '%s' "$value"
}

recipe_changed() {
  case "$CHANGED_SLUGS" in
    '*') return 0 ;;
  esac
  case " $CHANGED_SLUGS " in
    *" $1 "*) return 0 ;;
  esac
  return 1
}

repo_digest() {
  docker inspect --format='{{index .RepoDigests 0}}' "$1" 2>/dev/null || echo ''
}

pull_published() {
  for attempt in 1 2 3; do
    if docker pull "$1"; then
      return 0
    fi
    echo "docker pull $1 failed (attempt ${attempt}/3)"
    if [ "$attempt" -lt 3 ]; then
      sleep $((attempt * 5))
    fi
  done
  return 1
}

published_state() {
  manifest_accept='application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json'
  token="$(curl -sS -u "${GITHUB_ACTOR}:${GITHUB_TOKEN}" \
    "https://ghcr.io/token?service=ghcr.io&scope=repository:${IMAGE_OWNER}/vivarium-$1:pull" \
    | jq -r '.token // empty' || true)"
  if [ -z "$token" ]; then
    echo "vivarium-$1: no registry token issued" >&2
    echo unknown
    return
  fi
  code="$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H "Accept: ${manifest_accept}" \
    "https://ghcr.io/v2/${IMAGE_OWNER}/vivarium-$1/manifests/latest" || true)"
  echo "vivarium-$1: manifest HTTP ${code}" >&2
  case "$code" in
    200) echo present ;;
    404) echo absent ;;
    *) echo unknown ;;
  esac
}

for dockerfile in src/layer2_docker/*/Dockerfile; do
  slug_dir="$(dirname "$dockerfile")"
  slug="$(basename "$slug_dir")"
  case "$slug" in _*) continue ;; esac
  tag_latest="ghcr.io/${IMAGE_OWNER}/vivarium-${slug}:latest"
  tag_sha="ghcr.io/${IMAGE_OWNER}/vivarium-${slug}:${GITHUB_SHA}"

  if ! recipe_changed "$slug"; then
    case "$(published_state "$slug")" in
      present)
        echo "Unchanged: ${slug} - capturing against the published ${tag_latest}"
        if ! pull_published "$tag_latest"; then
          echo "::error::${tag_latest} is published but could not be pulled. Refusing to rebuild an unchanged recipe: that would move :latest and force every visitor to re-pull."
          exit 1
        fi
        bash scripts/capture-layer2-verdict.sh \
          "$tag_latest" "${slug_dir}/verdict.json" \
          --image-tag "$tag_latest" \
          --image-digest "$(repo_digest "$tag_latest")"
        continue
        ;;
      absent)
        echo "::warning::${tag_latest} has never been published; publishing ${slug} now."
        ;;
      *)
        echo "::error::Cannot tell whether ${tag_latest} is published. Refusing to rebuild an unchanged recipe: that would move :latest and force every visitor to re-pull."
        exit 1
        ;;
    esac
  fi

  description="$(recipe_field "$slug" title)"
  page_url="$(recipe_field "$slug" page_url)"
  labels=(
    --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}"
    --label "org.opencontainers.image.revision=${GITHUB_SHA}"
    --label "org.opencontainers.image.version=${GITHUB_SHA}"
    --label "org.opencontainers.image.created=${built_at}"
    --label "org.opencontainers.image.title=vivarium-${slug}"
    --label "org.opencontainers.image.description=${description}"
    --label "org.opencontainers.image.url=${page_url}"
    --label "org.opencontainers.image.documentation=${page_url}"
    --label "org.opencontainers.image.licenses=Apache-2.0"
  )

  echo "Building Layer 2 image: ${slug}"
  docker build "${labels[@]}" --tag "$tag_latest" "$slug_dir"

  echo "Pushing ${tag_latest} to GHCR"
  docker push "$tag_latest"
  verdict_tag="$tag_latest"

  if recipe_changed "$slug"; then
    echo "Pushing ${tag_sha} to GHCR"
    docker tag "$tag_latest" "$tag_sha"
    docker push "$tag_sha"
    verdict_tag="$tag_sha"
  fi

  bash scripts/capture-layer2-verdict.sh \
    "$tag_latest" "${slug_dir}/verdict.json" \
    --image-tag "$verdict_tag" \
    --image-digest "$(repo_digest "$verdict_tag")"
done
