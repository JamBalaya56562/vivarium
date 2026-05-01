---
pageType: home

hero:
  name: Vivarium
  text: バグ再現の共通基盤
  tagline: あらゆる言語・環境・スケールで。
  actions:
    - theme: brand
      text: ビジョンを読む(英語)
      link: /vision
    - theme: alt
      text: GitHub で見る
      link: https://github.com/aletheia-works/vivarium

features:
  - title: Layer 1 — WebAssembly
    details: ブラウザ内でミリ秒オーダーの再現。Pyodide、sqlite-wasm、Rust wasm32-wasi、Ruby.wasm、PHP.wasm。アルゴリズム、データ処理、パーサ向き。
  - title: Layer 2 — Docker
    details: 環境を丸ごと再現する高忠実度モード。実ファイルシステム、実プロセス、実ネットワークに依存するバグ向け。
  - title: Layer 3 — 第三の道
    details: Record-replay、決定論的シミュレーション、microVM、そして未発明の技法。Layer 1 / 2 では届かない問題のためのカテゴリ。
  - title: 問題が先、技術は後
    details: 再現性こそがプリミティブ。技術は問題に選ばれるのであって、その逆ではない。
  - title: AI 委譲開発
    details: 人間が方向とマージを担い、AI エージェントが実装・レビュー・反復を担う。インフラは継続的に動く。
  - title: 終わらないプロジェクト
    details: 単位は四半期ではなく年。期限なし、ローンチ圧力なし、完成日なし。
  - title: 公開仕様(英語)
    details: Contract v1(verdict サーフェス)、Manifest v1(第三者再現の `.vivarium/manifest.toml` 宣言)、Recipes index v1(機械可読カタログ)。それぞれ JSON Schema を伴う。
    link: /spec/
  - title: エージェント連携(英語)
    details: Model Context Protocol サーバ(`@aletheia-works/vivarium-mcp`)が recipe カタログと verdict スナップショットを Claude Code、Cline、Cursor、Continue ほかの AI エージェントクライアントへ公開。JSR と npm に OIDC + Sigstore provenance 付きでデュアル公開。
    link: /spec/recipes-index-v1
---

> このページは日本語ローカライズの最初のステップです。詳細ドキュメント
> (Vision、Architecture、Roadmap、AI workflow、Reproductions、Spec)は
> 現時点では英語のみです。順次翻訳していきます — 進捗は
> [Roadmap の Phase 6 / sub-stream L](/roadmap#phase-6--usability-and-visual-layer)
> を参照してください。
