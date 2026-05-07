# Vivarium Contract v1

> すべての Vivarium 互換再現ページが出力する再現 verdict サーフェス。
> 現在 **リビジョン 3**——ページ末尾の[リビジョン履歴](#リビジョン履歴)を参照。

## 概要

Vivarium Contract v1 に準拠するページは以下を公開する:

- 定数バージョン宣言:
  - `<head>` 内の `<meta name="vivarium-contract" content="v1">`。
  - 出力する JSON エンベロープ（ページ内 `__VIVARIUM_RESULT__` グローバル、または `verdict.json` ファイル）内の `"contract": "v1"`。
- **verdict** — `"reproduced"`（アップストリームバグが再現された）、`"unreproduced"`（再現されなかった）、`"pending"`（実行未完了）のいずれか。
- バグ、ランタイム、ページ固有の出力を記述する **result エンベロープ**。

公開方法はレイヤーによって異なる:

| レイヤー | ライブなページ内サーフェス | ファイルスナップショット |
|---|---|---|
| **Layer 1** (WASM) | DOM + JS グローバル。再現コードが実行しながらページによって設定される | なし——verdict はライブ |
| **Layer 2** (Docker) | DOM + JS グローバル。ページ読み込み時に `verdict.json` からリフト | レシピと同梱される `verdict.json` |
| **Layer 3** (record-replay) | DOM + JS グローバル。ページ読み込み時に `verdict.json` からリフト | メンテナーがコミットする `verdict.json` |

DOM/グローバルサーフェスは三つのレイヤー全体で同じだ。ファイルスナップショットは Layer 2 と Layer 3 にのみ存在する。

## Verdict セマンティクス

`reproduced` はこの実行で**アップストリームバグが再現された**ことを意味する。ページは
アップストリームレポートが記述した失敗を実証している。再現が機能している。

`unreproduced` はバグが**再現されない**ことを意味する。ランタイムがページが取り込んだ修正を
出荷したか（例: Pyodide がバンドルする pandas をバグのあるリリース以降に更新した）、
または verdict を出力する前にランタイムが別の方法でリグレッションしたかのいずれかだ。
どちらの読み方も調査する価値がある——ページはもはや README が主張することを実証していない。

`pending` は再現コード（Layer 1）または verdict スナップショットのフェッチ
（Layer 2 / 3）が確定するまでのデフォルト状態だ。

## ページ内サーフェス（全レイヤー）

### HTML meta タグ

```html
<meta name="vivarium-contract" content="v1">
```

すべての再現ページの `<head>` に必須。

### DOM verdict 要素

```html
<div id="verdict" data-verdict="pending" class="pending">
  Reproduction pending — loading runtime…
</div>
```

`id="verdict"` を持つ要素は以下を持つ:

| 属性 / コンテンツ | 値 | 目的 |
|---|---|---|
| `data-verdict` | `"pending"` \| `"reproduced"` \| `"unreproduced"` | 機械可読な verdict |
| `class` | `"pending"` \| `"reproduced"` \| `"unreproduced"` のいずれか | CSS フック |
| テキストコンテンツ | 人間可読な verdict ライン | 訪問者向けメッセージ |

再現コードはページロードごとに要素を `"pending"` から `"reproduced"` または `"unreproduced"` に
一度だけ遷移させる。

### JavaScript グローバル

```ts
globalThis.__VIVARIUM_VERDICT__: "pending" | "reproduced" | "unreproduced";
globalThis.__VIVARIUM_RESULT__: VivariumResultV1;  // 以下のエンベロープ参照
```

`__VIVARIUM_VERDICT__` は `#verdict[data-verdict]` をミラーする——両者は
[`src/layer1_wasm/_shared/verdict.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/_shared/verdict.ts)
のヘルパーによって一緒に書き込まれる。
両者の間に乖離があればページが壊れているサイン。テストは両方をクロスチェックする。

`__VIVARIUM_RESULT__` は構造化エンベロープ（次のセクション）。
ページが（Layer 1 の場合）verdict を生成するか、（Layer 2 / 3 の場合）フェッチしたときに設定される。

### DOM evidence 要素（オプション、リビジョン 2+）

```html
<div id="evidence" hidden>
  <pre data-evidence="stdout">…キャプチャされた stdout…</pre>
  <pre data-evidence="stderr">…キャプチャされた stderr…</pre>
  <span data-evidence="exit-code">0</span>
  <span data-evidence="duration-ms">123</span>
</div>
```

`#evidence` コンテナは**オプション**だ。リビジョン 2 以前のページはこれを省略する。
v1 コンシューマーは不在を無視する。存在する場合、再現比較 UI がサイドバイサイドパネルを
レンダリングするようなツールが使う機械可読な実行エビデンスを持つ。

| `[data-evidence]` 値 | コンテンツ | 典型的な出所 |
|---|---|---|
| `stdout` | キャプチャされた標準出力 | Layer 1: 再現が出力するアサーション関連テキスト。Layer 2 / 3: `verdict.json#stdout` からリフト。 |
| `stderr` | キャプチャされた標準エラー（末尾切り詰めの場合あり） | Layer 1: 再現が出力。Layer 2 / 3: `verdict.json#stderr_tail` からリフト（リフト境界でリネーム）。 |
| `exit-code` | 整数の終了コード、または空 | Layer 2 / 3: `verdict.json#exit_code`。Layer 1: 省略（ブラウザ側にプロセス終了コードなし）。 |
| `duration-ms` | ウォールクロック所要時間（ミリ秒） | `__VIVARIUM_RESULT__.timing.duration_ms` をミラー。 |

ページはこれらの子要素の一部のみを出力してよい。コンシューマーは欠損した
`[data-evidence="<key>"]` を `null` / 不在として扱わなければならない（エラーではない）。
`hidden` 属性でデフォルトレンダリングでは非表示になる。

`stdout` / `stderr` テキストはページサイズを制限するために切り詰める場合がある。
規約では Layer 1 ヘルパーは各々を 4 KiB に制限し、既存の Layer 2 / 3
`verdict.json#stderr_tail` の切り詰めルールに合わせている。

## Result エンベロープ (`VivariumResultV1`)

TypeScript で表現した型:

```ts
interface VivariumResultV1 {
  contract: "v1";
  bug: {
    project: string;       // 例: "pandas"
    issue: number;         // 例: 56679 — `#` プレフィックスなし
    upstream_url: string;  // アップストリームの Issue または PR への URL
  };
  runtime: {
    name: string;          // 下記の runtime.name テーブル参照
    version: string;       // 例: "0.29.3"
    extras: Record<string, string>;  // 自由形式（python/pandas バージョンなど）
  };
  result: Record<string, unknown>;   // ページ固有の構造化出力
  timing: {
    started_at: string;    // ISO-8601
    finished_at: string;   // ISO-8601
    duration_ms: number;   // ウォールクロック、ミリ秒
  };

  // オプション、リビジョン 2+——上記「DOM evidence 要素」参照
  evidence?: {
    stdout?: string;       // 4 KiB に切り詰める場合あり
    stderr?: string;       // 4 KiB に切り詰める場合あり
    exit_code?: number | null;  // Layer 1 では null。Layer 2 / 3 では整数。
    // duration_ms はここには重複しない——`timing.duration_ms` 参照
  };
}
```

`runtime.name` は自由形式だが、ギャラリー全体で現在使用されている値は:

| 値 | 意味 |
|---|---|
| `"browser"` | スモークテスト、WASM ランタイムなし |
| `"pyodide"` | WebAssembly 上の Python |
| `"ruby.wasm"` | WebAssembly 上の Ruby |
| `"php-wasm"` | WebAssembly 上の PHP |
| `"rust-wasi"` | `wasm32-wasip1` にコンパイルされた Rust |
| `"docker-snapshot"` | CI またはメンテナーがキャプチャした `verdict.json` をレンダリングする Layer 2 / Layer 3 ページ |

外部再現は新しい値を自由に追加できる。ダウンストリームツールは `runtime.name` を
opaque として扱う。

`result` は意図的に `Record<string, unknown>` だ——その形はページごとに異なる
（例: pandas 再現は `{ wrong_value, expected_value }` を置くかもしれないし、
regex 再現は `{ matched, expected_match }` を置くかもしれない）。
ページは自身の `result` の形を README に文書化する。コントラクトはフィールドが
存在することのみを保証する。

`evidence` はオプションで、リビジョン 2 で追加された。コンシューマーは
フィーチャーデテクション（`if (result.evidence) …`）しなければならない——
リビジョン 2 以前のページはフィールドを完全に省略する。

## Verdict スナップショットファイル (`verdict.json`)

Layer 2 と Layer 3 では、ギャラリーページは再現をライブ実行しない——
CI（Layer 2）またはメンテナー（Layer 3）が最後の再現試行時に書いたスナップショットを
消費する。ファイルはページ読み込み時にフェッチされ、
[`src/layer2_docker/_layer2-shared/layer2.js`](https://github.com/aletheia-works/vivarium/blob/main/src/layer2_docker/_layer2-shared/layer2.js)
によってページ内サーフェス（`__VIVARIUM_RESULT__` など）にリフトされる。

スキーマ: [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json)（JSON Schema draft 2020-12）。

フィールド概要:

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `contract` | `"v1"`（リテラル） | ✅ | バージョンリテラル——この仕様では常に `"v1"` |
| `verdict` | `"reproduced"` \| `"unreproduced"` | ✅ | スナップショット verdict（`"pending"` はなし——スナップショットは実行後） |
| `exit_code` | 整数 | ✅ | 記録されたプログラム / replay の終了コード |
| `image_tag` | 文字列 | ✅ | スナップショットをキャプチャした docker イメージタグ |
| `image_digest` | 文字列 | ✅ | docker イメージ識別子。CI プッシュキャプチャはレジストリ RepoDigest を使用し、Layer 3 ローカルビルドキャプチャはローカルイメージ ID を使用する（`docker inspect --format='{{.Id}}'`）。どちらも利用不可の場合は空文字列を許可 |
| `captured_at` | ISO-8601 文字列 | ✅ | スナップショットのウォールクロックタイムスタンプ |
| `stdout` | 文字列 | ✅ | 完全な stdout、またはページ固有の JSON エンコード出力 |
| `stderr_tail` | 文字列 | ✅ | stderr の最後の 4 KiB、前後に切り詰め |

スキーマは v1 の不変条件を強制する: `contract === "v1"` かつ `verdict ∈ {"reproduced", "unreproduced"}`。
Layer 1 は `verdict.json` を出荷しない。その verdict はページ内でライブに生成される。

### ページ内 evidence サーフェスへのリフト（リビジョン 2+）

Layer 2 / Layer 3 ページは書き込み時にスナップショットの evidence フィールドを
自身の DOM に複製しない——スナップショットがソースだ。
ギャラリーローダーがページ読み込み時に [DOM evidence 要素](#dom-evidence-要素オプションリビジョン-2)
にリフトする:

| `verdict.json` ソース | ページ内サーフェス |
|---|---|
| `stdout` | `evidence.stdout` エンベロープフィールド + `[data-evidence="stdout"]` DOM 子要素 |
| `stderr_tail` | `evidence.stderr` エンベロープフィールド + `[data-evidence="stderr"]` DOM 子要素 |
| `exit_code` | `evidence.exit_code` エンベロープフィールド + `[data-evidence="exit-code"]` DOM 子要素 |

`stderr_tail` → `evidence.stderr` のリネームは、ページ内コントラクトサーフェスを
Layer 1（再現コードがキャプチャしたいテキストを直接出力し、「tail」フレームがない）と
均一に保つためのものだ。4 KiB 切り詰めルールはソースフィールドのプロパティであり、
ページ内サーフェスはソースが適用した制限を継承する。

スキーマはリビジョン 2 で**変更されない**——ソースフィールドは
スナップショットのトップレベルにすでに存在していたものをそのまま再利用している。

### ファイルに `"pending"` がない理由

スナップショットは記録されたプログラム / replay が完了した*後*に書き込まれる。
キャプチャされた `"pending"` スナップショットは存在しない——CI またはメンテナーが
ファイルを書き込む時点ですでに実行は完了している。`"pending"` 値はライターのバグを意味する。

## バージョニング

バージョンは二つの場所に記載される:

- `<meta name="vivarium-contract" content="v1">` — ページ内。
- `verdict.json#contract` — ファイルスナップショット。

両方を出荷するすべてのページで両者は一致しなければならない。
`v1` を宣言するページはこの仕様に準拠しなければならない。

コントラクトは二層のポリシーで進化する:

- **メジャーバンプ（v2）** — 既存の v1 フィールドへの変更（リネーム、削除、型変更、
  セマンティクス変更、オプション → 必須）に必要。v2 は新しい仕様ページと
  新しい JSON Schema の兄弟ファイルとして出荷される。
  コンシューマーはバージョンリテラルによるディスパッチで v1 と v2 を同時サポートできる。
- **マイナーリビジョン（v1 内）** — v1 コンシューマーが無視できる**オプションの追加的**
  サーフェスに使用する。バージョンリテラルは `"v1"` のまま（`meta` 変更なし、
  `verdict.json#contract` 変更なし）。同じ仕様ページが更新され、以下の
  [リビジョン履歴](#リビジョン履歴)が日付とともに追加を記録する。
  コンシューマーは新しいサーフェスをフィーチャーデテクトする（例: `if (result.evidence) …`）。

現在 v2 は存在しない。

## コンフォーマンス

再現ページが Vivarium Contract v1 に準拠するのは:

1. `<head>` に `<meta name="vivarium-contract" content="v1">` を含む。
2. `#verdict[data-verdict]` と `__VIVARIUM_VERDICT__` を通じて verdict を公開する（値は一致）。
3. `VivariumResultV1` 型に準拠した構造化エンベロープを `__VIVARIUM_RESULT__` 経由で公開する。
4. `verdict.json` を出荷する場合、ファイルが
   [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json)
   を検証パスする。

CI はこれらの条項を機械的に強制する——現在は
[`src/layer1_wasm/tests/repro.spec.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/tests/repro.spec.ts)
（条項 1〜3 に対する Playwright アサーション）と
[`.github/workflows/repro-regression.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/repro-regression.yml)
内の `jq -e '.contract == "v1" and …'` 述語（条項 4）による。

## リビジョン履歴

`<meta name="vivarium-contract">` と `verdict.json#contract` が持つバージョンリテラルは
`"v1"` だ。以下のリビジョンは v1 サーフェスの非破壊的・追加的な進化だ。
リビジョン 2 以前のページは変更なしでコンフォーマンスを維持する。

| リビジョン | 日付 | 変更内容 |
|---|---|---|
| 1 | 2026-04-28（ロック） | 初回公開サーフェス: `<meta>`、`#verdict[data-verdict]`、JS グローバル、`VivariumResultV1` エンベロープ、Layer 2/3 `verdict.json` スナップショット。 |
| 2 | 2026-04-30 | オプションの `#evidence` DOM コンテナ（`stdout`、`stderr`、`exit-code`、`duration-ms` の `[data-evidence]` 子要素）と対応する `__VIVARIUM_RESULT__.evidence` エンベロープフィールド。Layer 2/3 リフトはリフト境界で `verdict.json#stderr_tail` → `evidence.stderr` にリネーム。`verdict.schema.json` は変更なし。 |
| 3 | 2026-05-05 | Verdict enum 値をリネーム: `"pass"` → `"reproduced"`、`"fail"` → `"unreproduced"`（`"pending"` は不変）。Contract バージョンリテラルは `v1` のまま。`verdict.schema.json` の enum も更新され、旧値（`"pass"` / `"fail"`）を持つスナップショットはバリデーションを通らなくなる。`#verdict` の CSS クラス名と `data-verdict` 属性値も同じくリネーム。 |

## 参照

- [`src/layer1_wasm/_shared/verdict.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/_shared/verdict.ts)
  — ページ内サーフェス用 TypeScript ヘルパー。
- [`src/layer1_wasm/tests/repro.spec.ts`](https://github.com/aletheia-works/vivarium/blob/main/src/layer1_wasm/tests/repro.spec.ts)
  — サーフェスに対する Playwright アサーション。
- [`src/layer2_docker/_layer2-shared/layer2.js`](https://github.com/aletheia-works/vivarium/blob/main/src/layer2_docker/_layer2-shared/layer2.js)
  — ギャラリー側の `verdict.json` → ページ内サーフェスリフト。
- [`.github/workflows/repro-regression.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/repro-regression.yml)
  — 現在の `jq -e` バリデーター。
- [`.github/workflows/deploy-docs.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/deploy-docs.yml)
  — Layer 2 ビルド/実行/スナップショットワークフロー。
