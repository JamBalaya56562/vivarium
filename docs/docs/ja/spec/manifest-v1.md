# Vivarium Manifest v1

> 外部リポジトリが `.vivarium/manifest.toml` に置いて
> Vivarium 実行可能な再現を宣言するための静的マニフェスト。
> [ADR-0015](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0015-third-party-manifest-format.md)
>（プライベートメモ）によって v1 にロックされている。

これは*アップストリーム*サーフェスだ——外部プロジェクトが Vivarium に
「私たちは再現をホストしている。場所はここだ」と伝える方法。
*ランタイム*サーフェス（DOM verdict、`verdict.json`）は
[Contract v1](./contract-v1.md) で別途定義されている。
この二つの仕様を合わせることで、サードパーティは
`aletheia-works/vivarium` のソースツリーに触れることなく再現を公開できる。

## 概要

リポジトリは以下の場所に単一の TOML ファイルを置くことで
Vivarium 互換の再現を宣言できる:

```
<repo-root>/.vivarium/manifest.toml
```

```toml
#:schema https://aletheia-works.github.io/vivarium/spec/manifest.schema.json
manifest = "v1"
slug = "bash-local-shadows-exit"
title = "bash: `local` builtin shadows command exit code"
layer = 2

[bug]
project = "bash"
issue = 0
upstream_url = "https://lists.gnu.org/archive/html/bug-bash/"

[layer2]
image = "ghcr.io/example-org/example-bash-local-shadows-exit:latest"
dockerfile = "./Dockerfile"
expected_verdict = "pass"
```

再現を実行したいコンシューマーはマニフェストを読み、`layer` でディスパッチし、
以下に定義されたレイヤーごとの規約に従う。

## スキーマディレクティブ

[Taplo](https://taplo.tamasfe.dev) や
[Tombi](https://tombi-toml.github.io/tombi) などの TOML 言語サーバを持つエディタは、
マニフェストが `#:schema` 行で始まる場合に `manifest.toml` を自動補完・検証する:

```toml
#:schema https://aletheia-works.github.io/vivarium/spec/manifest.schema.json
manifest = "v1"
…
```

このディレクティブは TOML コメントなので、プレーンパーサー（`tomllib` など）には
見えず、CI バリデーションはディレクティブの有無に関わらず同一の動作をする。
Cargo と pyproject マニフェストも同じパターンを使用する。

## なぜ TOML か

TOML 1.0（YAML でも JSON でもない）。フォーマットの選択は
[ADR-0015](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0015-third-party-manifest-format.md)
でロックされている。要約: マニフェストはレシピごとに一度、人間が手書きする。
TOML のフラットなサーフェス（有意な空白なし、アンカーなし、暗黙の型強制なし）は
YAML よりも手書きリスクを最小化する。一方でコメントと末尾カンマを許可する点で JSON より優れる。

## 必須トップレベルキー

| キー | 型 | 注記 |
|---|---|---|
| `manifest` | 文字列 | `"v1"` と等しくなければならない。バージョンリテラル。 |
| `slug` | 文字列 | ケバブケース `^[a-z0-9]+(-[a-z0-9]+)*$`。レシピの識別子。`aletheia-works/vivarium` のディレクトリ名規約に合わせる。 |
| `layer` | 整数 | `1`、`2`、`3` のいずれか。必須のレイヤー固有テーブルを選択する（以下参照）。 |
| `[bug]` | テーブル | 必須。アップストリームバグを記述。 |
| `[bug] project` | 文字列 | アップストリームプロジェクト名（例: `"bash"`）。 |
| `[bug] issue` | 整数 | Issue 番号。アップストリーム Issue トラッカーのエントリが存在しない場合は `0` を使用。 |
| `[bug] upstream_url` | 文字列（URI） | Issue / メーリングリストスレッド / PR / ドキュメントページへの標準リンク。 |

## オプションのトップレベルキー

| キー | 型 | 注記 |
|---|---|---|
| `title` | 文字列 | 短い人間可読なタイトル。 |
| `description` | 文字列 | 長い説明。Markdown を許可するが解釈されない。 |

## レイヤー固有テーブル

`[layer1]`、`[layer2]`、`[layer3]` のいずれか一つが必須——
トップレベルの `layer` 整数と一致しなければならない。

### `[layer1]` — ブラウザ内 WASM

```toml
layer = 1

[layer1]
page_url = "https://example.org/repro/some-bug/"
expected_verdict = "pass"  # デフォルト; オプション
```

| フィールド | 必須 | 注記 |
|---|---|---|
| `page_url` | ✅ | 静的再現ページの URL。ページは [Contract v1](./contract-v1.md) に準拠しなければならない。 |
| `expected_verdict` | ⏳ | `"pass"`（デフォルト）または `"fail"`。 |

### `[layer2]` — Docker カタログ

```toml
layer = 2

[layer2]
image = "ghcr.io/example-org/example-bash-local-shadows-exit:latest"
dockerfile = "./Dockerfile"  # オプション、情報提供のみ
expected_verdict = "pass"
```

| フィールド | 必須 | 注記 |
|---|---|---|
| `image` | ✅ | コンテナイメージ参照。訪問者は `docker run <image>` を実行する。デフォルト CMD はレシピの再現スクリプト。終了コード 0 = バグが再現される（`pass`）。 |
| `dockerfile` | ⏳ | ソース Dockerfile へのリポジトリ相対パス。情報提供のみ——Vivarium はここからビルドしない。 |
| `expected_verdict` | ⏳ | デフォルト `"pass"`。 |

### `[layer3]` — Record-replay カタログ

```toml
layer = 3

[layer3]
image = "ghcr.io/example-org/example-recipe-with-trace:latest"
dockerfile = "./Dockerfile"
expected_verdict = "pass"
```

| フィールド | 必須 | 注記 |
|---|---|---|
| `image` | ✅ | コンテナイメージ参照。イメージは**録音済みの `rr` トレースを焼き込んで**出荷することが期待される。エントリポイントはピン留めされたトレースに対して `rr replay` を実行する。 |
| `dockerfile` | ⏳ | 情報提供のみ。 |
| `expected_verdict` | ⏳ | デフォルト `"pass"`。 |

> ⚠️ Layer 3 replay は訪問者の CPU が録音 CPU と異なる場合に
> **CPUID フォールティングサポート**を持つホストが必要。
> GitHub Actions ホスト型 Ubuntu ランナーはこの機能を**公開しない**——
> [ADR-0011](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0011-phase4-first-vertical-rr.md)
>（プライベートメモ）参照。Layer 3 マニフェストは、
> セルフホストランナーまたは最新の Intel（Ivy Bridge 以降）/ 最新 AMD シリコンを持つ
> 訪問者のデスクトップで消費するのが最適だ。

## Verdict セマンティクス

`expected_verdict` の値は [Contract v1](./contract-v1.md#verdict-セマンティクス) で
ロックされた「典型的な CI の逆」フレームに従う:

- `"pass"` ⇒ アップストリームバグが**再現される**。
- `"fail"` ⇒ アップストリームバグが**再現されない**。

`expected_verdict = "pass"` を宣言するページが一般的なケースだ——
レシピはアップストリームレポートが記述した失敗を実証する。
`expected_verdict = "fail"` を宣言するページはアップストリームの修正を
意図的に追跡するセンチネルだ。バグが再びリグレッションした瞬間に赤くなる。

## バージョニング

バージョンはひとつの場所に記載される:

- ドキュメントのトップの `manifest = "v1"`。

フィールドの追加、削除、セマンティクスの変更には v2 マニフェスト仕様ページ、
v2 JSON Schema の兄弟ファイル、別の ADR が必要。
コンシューマーは `manifest` リテラルによるディスパッチで v1 と v2 を
同時サポートできるようにすべきだ。

現在 v2 は存在しない。

## コンフォーマンス

マニフェストが Vivarium Manifest v1 に準拠するのは:

1. 消費リポジトリの `.vivarium/manifest.toml` に配置された有効な TOML 1.0 ドキュメントである。
2. TOML→JSON 変換後に
   [`manifest.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/manifest.schema.json)
   を検証パスする。
3. `[layer1]` / `[layer2]` / `[layer3]` のうちちょうど一つが存在し、
   トップレベルの `layer` 整数と一致する。
4. 指定されたアーティファクト（ページまたはイメージ）が実際に存在し、
   実行時に Contract-v1 準拠の verdict を生成する。

条項 1〜3 はスキーマバリデーションで機械的に強制できる。条項 4 はレシピごとの検証だ。

## リファレンス実装

`aletheia-works/vivarium` リポジトリは
[`src/external_examples/`](https://github.com/aletheia-works/vivarium/tree/main/src/external_examples)
以下にレイヤーごとに 3 つのサンプルマニフェストを出荷している——すべて Vivarium 自身の
公開デプロイページと GHCR イメージを指しているため、形だけ有効なのではなく実際に
実行可能なものとして書かれている。

`repro-regression.yml` の CI は、毎回のプッシュとプルリクエストで
`src/external_examples/*/.vivarium/manifest.toml` をすべてこのスキーマに対して検証する。

## 関連情報

- [Contract v1](./contract-v1.md) — このマニフェストが指すアーティファクトが公開しなければならないランタイム verdict サーフェス。
- [`manifest.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/manifest.schema.json)
  — TOML→JSON 変換後のマニフェスト用 JSON Schema（draft 2020-12）。
- [Consumer workflow](./consumer-workflow.md) — コンシューマーが自身の CI でマニフェストで宣言されたイメージを検証するための再利用可能 GitHub Actions ワークフロー。
