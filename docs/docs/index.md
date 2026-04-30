---
pageType: home

hero:
  name: Vivarium
  text: Universal bug reproduction
  tagline: Any language, any environment, any scale.
  actions:
    - theme: brand
      text: Read the vision
      link: /vision
    - theme: alt
      text: View on GitHub
      link: https://github.com/aletheia-works/vivarium

features:
  - title: Layer 1 — WebAssembly
    details: Browser-native reproduction in milliseconds. Pyodide, sqlite-wasm, Rust wasm32-wasi, Ruby.wasm, PHP.wasm. Ideal for algorithms, data processing, and parsers.
  - title: Layer 2 — Docker
    details: Full-fidelity environment reproduction. For bugs that depend on real filesystems, real processes, and real networks.
  - title: Layer 3 — Third way
    details: Record-replay, deterministic simulation, microVMs, and techniques yet to be invented. For problems Layers 1 and 2 cannot reach.
  - title: Problem-first
    details: Reproduction is the primitive. The technology is chosen by the problem, never the other way around.
  - title: AI-delegated development
    details: Humans set direction and merge. AI agents implement, review, and iterate. Infrastructure runs continuously.
  - title: Lifelong project
    details: Measured in years, not quarters. No false urgency, no shipping-to-launch pressure, no completion deadline.
  - title: Public specs
    details: Contract v1 (verdict surface), Manifest v1 (third-party reproductions declare themselves via .vivarium/manifest.toml), and Recipes index v1 (machine-readable catalogue). Each backed by a JSON Schema.
    link: /spec/
  - title: Agent integration
    details: A Model Context Protocol server (@aletheia-works/vivarium-mcp) exposes the recipe catalogue and verdict snapshots to Claude Code, Cline, Cursor, Continue, and other AI agent clients. Dual-published to JSR and npm with OIDC + Sigstore provenance.
    link: /spec/recipes-index-v1
---
