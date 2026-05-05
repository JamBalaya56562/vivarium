# Vivarium recipes index (v1)

> このリポジトリがホストするすべての再現の機械的に生成されたカタログインデックス。
> [Vivarium MCP サーバ](https://github.com/aletheia-works/vivarium/tree/main/packages/mcp-server)
> および、レシピの一覧取得・フィルタリング・検索を行うその他のプログラマティックなツールが利用する。

## 概要

URL: <https://aletheia-works.github.io/vivarium/api/recipes.json>

```json
{
  "index": "v1",
  "contract": "v1",
  "recipes": [
    {
      "slug": "pandas-56679",
      "layer": 1,
      "project": "pandas",
      "issue": 56679,
      "title": "pandas-dev/pandas#56679",
      "page_url": "https://aletheia-works.github.io/vivarium/repro/pandas/56679/",
      "source_url": "https://github.com/aletheia-works/vivarium/tree/main/src/layer1_wasm/pandas-56679"
    },
    {
      "slug": "bash-local-shadows-exit",
      "layer": 2,
      "project": "bash",
      "issue": 0,
      "title": "bash `local` shadows command-substitution exit code",
      "page_url": "https://aletheia-works.github.io/vivarium/repro/bash/local-shadows-exit/",
      "verdict_url": "https://aletheia-works.github.io/vivarium/repro/bash/local-shadows-exit/verdict.json",
      "source_url": "https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker/bash-local-shadows-exit"
    }
  ]
}
```

## トップレベルフィールド

| フィールド | 型 | 必須 | 注記 |
|---|---|---|---|
| `index` | `"v1"` リテラル | ✅ | フォーマットバージョン。新しいオプションフィールドは同 v1 リビジョンとして出荷。破壊的変更は v2。 |
| `contract` | `"v1"` リテラル | ✅ | レシピのページが公開する [Contract v1](./contract-v1.md) のバージョン。 |
| `recipes` | [レシピエントリ](#レシピエントリフィールド)の配列 | ✅ | このリポジトリがホストするすべての再現。レイヤー順、次に slug 順にソート。 |

## レシピエントリフィールド

| フィールド | 型 | 必須 | 注記 |
|---|---|---|---|
| `slug` | 文字列（ケバブケース） | ✅ | `src/layer{N}_*/` 以下のレシピディレクトリ名。Manifest v1 の `slug` と同じ規約。 |
| `layer` | 整数（`1` \| `2` \| `3`） | ✅ | Layer 1 = ブラウザ内 WASM。Layer 2 = Docker。Layer 3 = record-replay。 |
| `project` | 文字列 | ✅ | アップストリームプロジェクト名（例: `"pandas"`、`"bash"`）。 |
| `issue` | 整数 | ✅ | アップストリーム Issue 番号。アップストリームトラッカーのエントリが存在しない場合は `0`。 |
| `title` | 文字列 | ✅ | レシピ README の最初の H1 から取得した人間可読なタイトル。 |
| `page_url` | URI | ✅ | ライブ再現ページ（Layer 1: WASM ページ。Layer 2 / 3: docker-run 手順ページ）。 |
| `verdict_url` | URI | ⏳ | Layer 2 / 3 のみ——デプロイ済みの `verdict.json` スナップショット。Layer 1 の verdict はページ内でライブ生成されるため静的スナップショットを持たない。 |
| `source_url` | URI | ✅ | レシピディレクトリへの GitHub リンク。 |
| `language` | 文字列 | ⏳ | オプション。主要な実装言語の小文字表記（例: `"python"`、`"rust"`、`"shell"`）。[`docs/data/recipe-facets.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/data/recipe-facets.json) のオーバーレイから供給される。2026-05-03 リビジョンで追加。 |
| `symptom` | 文字列（ケバブケース） | ⏳ | オプション。エラー → レシピマッチャーが利用する短い症状スラッグ（例: `"dtype-mismatch"`、`"ordering-non-transitive"`）。ファセットオーバーレイから供給。2026-05-03 追加。 |
| `severity` | 文字列 | ⏳ | オプション。自由形式の重大度バケット（例: `"bug"`、`"regression"`、`"spec-violation"`、`"footgun"`）。ファセットオーバーレイから供給。2026-05-03 追加。 |
| `tags` | 文字列の配列 | ⏳ | オプション。マッチャーがスコア計算に使う自由形式タグリスト（例: `["sqlite3", "pragma", "foreign-keys"]`）。ファセットオーバーレイから供給。2026-05-03 追加。 |

## バージョニング

バージョンはトップレベルオブジェクトの `index = "v1"` として記載される。

- **オプションの追加的フィールド**は v1 リビジョンとして出荷される。
  コンシューマーはフィーチャーデテクトする。
- **破壊的変更**（フィールド名変更、型変更、オプション → 必須）には
  v2 スキーマの兄弟ファイルが必要。

現在 v2 は存在しない。

## リビジョン履歴

| 日付 | 変更内容 |
|---|---|
| 2026-05-03 | レシピエントリにオプションの `language` / `symptom` / `severity` / `tags` フィールドを追加。レシピごとのフロントマタではなく、集中型ファセットオーバーレイ（`docs/data/recipe-facets.json`）から供給される。後方互換 — v1 コンシューマーは無視できる。 |

## 生成方法

インデックスは
[`docs/scripts/generate-recipes-index.ts`](https://github.com/aletheia-works/vivarium/blob/main/docs/scripts/generate-recipes-index.ts)
によってビルドされ、`docs/package.json` の rspress `dev` と `build` スクリプトに組み込まれている。
スクリプトはレシピディレクトリを走査し、各レシピ README の最初の H1 からタイトルを取得し、
slug パターン（末尾に Issue 番号を持つ slug の場合は `<project>-<digits>`。
それ以外は最初のダッシュセグメント。形が異なるレシピには小さなオーバーライドマップ）から
`project` / `issue` を導出する。

出力は git でトラッキングされるため、レシピを追加する PR の diff にインデックス更新も表示される。
オプションのファセットフィールド（`language` / `symptom` / `severity` / `tags`）は
[`docs/data/recipe-facets.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/data/recipe-facets.json)
から merge される。これは手作業で維持され PR 差分でレビューされる集中型オーバーレイだ。
v1 では `project` フィールドは引き続き slug 由来のままにしている。

## コンフォーマンス

`recipes.json` ドキュメントが v1 に準拠するのは:

1. [`recipes.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/api/recipes.schema.json)
   を検証パスする。
2. `index === "v1"` かつ `contract === "v1"`。
3. すべてのエントリの `slug` が `^[a-z0-9]+(-[a-z0-9]+)*$` に一致する。
4. すべての Layer 2 / 3 エントリが `verdict_url` を含む。Layer 1 エントリはこれを省略する。

条項 1〜3 はスキーマバリデーションで機械的に強制できる。条項 4 はスキーマの `oneOf`
に意図的に組み込まれていない導出ルール制約だ（MCP サーバは Layer 2 / 3 エントリに
`verdict_url` がない場合と、`verdict_url` が 404 を返す場合を同じように扱う——
両方とも「スナップショットなし」としてコンシューマーに通知する）。

## 関連情報

- [Contract v1](./contract-v1.md) — 各レシピページが公開するランタイム verdict サーフェス。
- [Manifest v1](./manifest-v1.md) — 外部リポジトリが `.vivarium/manifest.toml` に置く
  アップストリーム側マニフェスト形式。このインデックスのレシピエントリは内部レシピに対応する。
  外部リポジトリはここにリストされる代わりに自身のリポジトリのマニフェストを公開する。
