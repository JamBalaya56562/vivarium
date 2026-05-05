# Consumer workflow

> 任意のリポジトリが `uses:` することで、Vivarium 内部のコードを一切コピーせずに
> 自分の CI 内で Vivarium ホスト型バグ再現を検証できる再利用可能 GitHub Actions ワークフロー。

ワークフローは
[`aletheia-works/.github/.github/workflows/vivarium-verdict.yml`](https://github.com/aletheia-works/.github/blob/main/.github/workflows/vivarium-verdict.yml)
に配置されている。
公開済みの `ghcr.io/aletheia-works/vivarium-<slug>` イメージをプルし、
レシピを実行し、[Contract v1](./contract-v1.md) に準拠する `verdict.json` をキャプチャし、
[公開 JSON Schema](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json)
に対して検証し、キャプチャした verdict が呼び出し元が期待するものと一致することを
アサートする。

## 5 行のコンシューマー例

```yaml
jobs:
  bash-issue:
    uses: aletheia-works/.github/.github/workflows/vivarium-verdict.yml@main
    with:
      slug: bash-local-shadows-exit
```

これだけで統合は完了だ。コンシューマーリポジトリの
`.github/workflows/check-bug.yml` には多数のジョブを置けて（追跡するレシピごとに 1 つ）、
それぞれが自分の CI の green / red シグナルになる。
スラッグは
[`src/layer2_docker/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
（Layer 2 カタログ）と
[`src/layer3_thirdway/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer3_thirdway)
（Layer 3 カタログ。トレースはイメージに焼き込まれている）以下のディレクトリ名だ。

## インプット

| インプット | 型 | 必須 | デフォルト | 目的 |
|---|---|---|---|---|
| `slug` | 文字列 | ✅ | — | レシピスラッグ（例: `bash-local-shadows-exit`）。デフォルトのイメージタグ導出とアーティファクト・ログ行のラベル付けに使用。 |
| `image` | 文字列 | — | `ghcr.io/aletheia-works/vivarium-<slug>:latest` | イメージオーバーライド。特定の git-sha タグをピン留めしたいか、プライベートフォークをテストしたいコンシューマーに有用。 |
| `expected_verdict` | 文字列 | — | `"reproduced"` | `"reproduced"` または `"unreproduced"`。キャプチャした verdict と一致しない場合、ジョブは失敗する。アップストリームのバグが修正されているレシピを意図的に追跡する場合にのみ `"unreproduced"` を使用。 |
| `timeout_minutes` | 数値 | — | `5` | ジョブのタイムアウト。ほとんどの Layer 2 レシピは数秒で完了する。このバジェットは低速ネットワークでのイメージプルのために存在する。 |

## Verdict セマンティクス

`reproduced` はこの実行で**アップストリームバグが再現された**ことを意味する——
再現は機能している。`unreproduced` はバグが**再現されない**ことを意味する。
通常はアップストリームプロジェクトがバンドルイメージに取り込んだ修正を出荷したからだ。
完全な説明は
[Contract v1: Verdict セマンティクス](./contract-v1.md#verdict-セマンティクス)を参照。

「このバグは修正された」アラートを望むコンシューマーは:

```yaml
jobs:
  fixed-detector:
    uses: aletheia-works/.github/.github/workflows/vivarium-verdict.yml@main
    with:
      slug: my-favourite-recipe
      expected_verdict: reproduced  # デフォルト; 明確にするため明示
```

…と書けばよく、バグの再現が止まった瞬間にワークフローが赤くなる——
これがまさにアップストリーム修正検知シグナルだ。

## アーティファクト

ジョブはキャプチャした `verdict.json` を
`verdict-<slug>-<run_id>` という名前で 30 日保持のワークフローアーティファクトとして
アップロードする。コンシューマー側のバッジやデバッグフローは
GitHub Actions API 経由でアーティファクトをフェッチできる。

## このワークフローがしないこと

- **Layer 1 (WASM) の検証。** Layer 1 の再現はブラウザ内のページで実行される。
  verdict サーフェスはライブの DOM / JavaScript だ。Layer 1 の CI コンシューマー側検証は
  別の問題であり、再利用可能なワークフローでは対応できない——
  Vivarium ギャラリーの Playwright スイートが Layer 1 リグレッションチェックの正式な仕組みだ。
- **ホスト型 GHA ランナーでの Layer 3 (rr replay) の検証。**
  replay ステップ自体はレシピのイメージ CMD の一部として実行されるため、
  このワークフローはコンシューマー側から Layer 3 を駆動するが、
  **CPUID フォールティングをゲストに公開するランナーでのみ**機能する。
  GitHub ホスト型 Ubuntu ランナーはこれを公開しない。Layer 3 コンシューマー検証
  にはベアメタルまたは PMU 公開型 KVM のセルフホストランナーが必要だ。

## 関連情報

- [Contract v1](./contract-v1.md) — このワークフローが消費する verdict サーフェス。
- [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json) —
  ワークフローが検証に使用するスキーマ。
- [Layer 2 カタログ](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
  — `inputs.slug` に使用できるスラッグ。
- [Layer 3 カタログ](https://github.com/aletheia-works/vivarium/tree/main/src/layer3_thirdway)
  — 追加スラッグ（rr replay。上記のランナー注意事項あり）。
