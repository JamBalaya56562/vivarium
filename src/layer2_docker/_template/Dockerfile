# Vivarium Layer 2 reproduction — {{TITLE}}.
#
# Upstream issue: {{ISSUE_URL}}
#
# Name a concrete release tag for the base image, never
# `:latest`, and bump it forward as new releases land — the
# recipe claims the bug is reachable on current software.
FROM {{BASE_IMAGE}}

COPY repro.sh /repro.sh
RUN chmod +x /repro.sh

CMD ["/repro.sh"]
