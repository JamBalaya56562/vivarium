# Vivarium Layer 2 reproduction — {{TITLE}}.
#
# Upstream issue: {{ISSUE_URL}}
#
# Pinned base: {{BASE_IMAGE}}. Pin a major tag (e.g. node:26-slim,
# python:3.15-slim) so the image digest captured in the
# CI-generated verdict.json is reproducible. See the recipe
# README and src/layer2_docker/AGENTS.md for the full convention.
FROM {{BASE_IMAGE}}

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

CMD ["/repro.sh"]
