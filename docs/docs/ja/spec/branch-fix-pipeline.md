# Branch-fix verdict パイプライン

> コントリビューターが提供したブランチフィックス Docker イメージの
> [Contract v1](./contract-v1.md) verdict をキャプチャし、
> デプロイ済みの元の verdict と並べてサイドバイサイド比較を提供する
> `workflow_dispatch` GitHub Actions ワークフロー。

ワークフローは
[`.github/workflows/branch-fix-verdict.yml`](https://github.com/aletheia-works/vivarium/blob/main/.github/workflows/branch-fix-verdict.yml)
に配置されている。Phase 6 サブストリーム R（再現比較）の**ビルド＆検証**ハーフだ。
比較ページ UI のハーフ（R.3）は別の成果物であり、このパイプラインが生成する
アーティファクトを消費する。

## なぜこれが必要か

Vivarium レシピは特定のランタイム（イメージ、パッケージバージョン、ツールチェーン）を
ピン留めするため、ギャラリーの verdict スナップショットは安定している。
コントリビューター——人間であれ AI エージェントであれ——がアップストリームバグの
候補修正を生み出したとき、PR を開く前に
**「自分の修正は実際にレシピの再現を止めるか？」**
を確認する方法が必要だ。

機械的な答えは: 修正を含むイメージに対してレシピを再実行し、新鮮な `verdict.json` を
キャプチャし、元のものと比較する。元の verdict が `"pass"`（バグが再現される）で
branch-fix の verdict が `"fail"`（バグが再現されない）なら、修正は機能している。

このパイプラインがその比較を CI で実行する。コントリビューターは自分でブランチフィックス
イメージをビルドして公開する。このワークフローは純粋に検証サーフェスだ。

## 5 行の呼び出し例

```bash
gh workflow run branch-fix-verdict.yml \
  --repo aletheia-works/vivarium \
  -f slug=bash-local-shadows-exit \
  -f branch_image=ghcr.io/contributor/bash-fix:branch-x \
  -f expected_verdict=fail
```

実行ページには Markdown 比較サマリーがレンダリングされ、キャプチャした verdict は
`branch-fix-verdict-<slug>-<run_id>` という名前のワークフローアーティファクトとして
ダウンロードまたはプログラム的なフェッチ用にアップロードされる。

## インプット

| インプット | 型 | 必須 | デフォルト | 目的 |
|---|---|---|---|---|
| `slug` | 文字列 | ✅ | — | [`src/layer2_docker/`](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker) 以下のレシピスラッグ（例: `bash-local-shadows-exit`）。スラッグはワークフローのチェックアウト時にツリー内に存在しなければならない。タイポがあればワークフローは早期に失敗する。 |
| `branch_image` | 文字列 | ✅ | — | 検証する Docker イメージ参照（例: `ghcr.io/contributor/foo-fix:branch-x`）。ランナーが認証なしにプルできなければならない。プライベートレジストリサポートは追加作業。 |
| `expected_verdict` | 選択肢（`pass`\|`fail`） | — | `fail` | branch-fix イメージに対してコントリビューターが期待する verdict。`fail`（バグが再現されない）が典型的な「修正が機能している」答えだ。ワークフローの最終ステップはキャプチャした verdict がこれと一致するかアサートし、一致しない場合はゼロ以外で終了する。 |
| `original_image` | 文字列 | — | （空） | オプションのオーバーライド。デフォルトではワークフローは GitHub Pages からデプロイ済みの元の verdict をフェッチする——イメージを再実行するより安価で、ギャラリーが提供するものと同一だ。`original_image` を指定すると代わりにそのイメージから再キャプチャする。特定のタグへの比較をアンカーしたいときやプライベートフォークのテストに有用。 |

## Verdict セマンティクス（リマインダー）

`pass` はこの実行で**アップストリームバグが再現された**ことを意味する。`fail` は
再現されないことを意味する。これは典型的な「green CI = good」フレームの逆だ。
完全な説明は [Contract v1: Verdict セマンティクス](./contract-v1.md#verdict-セマンティクス)
を参照。

元の verdict が `pass` のレシピに対して、成功した branch-fix は verdict を `fail` に
反転させることが期待される。元の verdict がすでに `fail`（アップストリームの修正検知
イベントを追跡するセンチネルページ）のレシピに対しては、コントリビューターは
このワークフローをほとんど必要としない。

## アーティファクト

ワークフローは 30 日保持のディレクトリアーティファクトを
`branch-fix-verdict-<slug>-<run_id>` という名前でアップロードする。
バンドルには以下が含まれる:

| ファイル | ソース | 注記 |
|---|---|---|
| `branch-fix-verdict.json` | `branch_image` からライブキャプチャ。 | 常に存在。[Contract v1](./contract-v1.md) に準拠し [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json) に対して検証パスする。 |
| `original-verdict.json` | デフォルト: `https://aletheia-works.github.io/vivarium/repro/<slug>/verdict.json` からフェッチ。`original_image` を指定した場合: そのイメージからキャプチャ。 | デプロイ済みの Pages スナップショットが 404 を返す場合（例: まだライブサイトにない新しいレシピ）は省略。 |

R.3 比較ページ UI はこのバンドル構造を正確に消費する。
このようにファイルに名前を付けることで、R.2 が R.3 のプログラミング対象となる
ワイヤーフォーマットにコミットする。

## 比較サマリー

ワークフローは `$GITHUB_STEP_SUMMARY` に Markdown テーブルを書き込む
（実行ページで確認できる）:

| | original | branch-fix |
|---|---|---|
| verdict | （例）`pass` | （例）`fail` |
| exit code | （例）0 | （例）1 |

続いて `expected_verdict` アサーションの「期待通り」/ 「期待と不一致」を
1 行で記述する。Markdown サマリーはワークフロー実行ページ上の at-a-glance
ビューだ。サイドバイサイド比較サーフェスが必要なら、ワークフローのアーティファクト
zip を [比較ページ](../repro/compare.mdx) に file-drop または paste で渡す。
どちらにしてもアーティファクトが真実のソースだ。

## このパイプラインがしないこと

- **branch-fix イメージのビルド。** コントリビューターはランナーがプルできるレジストリに
  自分でビルドして公開することが期待される。ソースビルドステップをバンドルすることは
  パイプラインをアップストリームツールチェーンの無限のセットと結合させる。
  イメージを入力境界とすることは Phase 3 のカタログモデルに一致する。
- **Layer 1 (WASM) 再現の検証。** Layer 1 の verdict はブラウザによってページ内で
  ライブ生成される。スワップできる Docker イメージは存在しない。
  Layer 1 の同等物はページソースをローカルで編集し、既存の Playwright スイートを
  再実行することだ。
- **ホスト型ランナーでの Layer 3 (rr replay) 再現の検証。**
  [Consumer workflow](./consumer-workflow.md) と同様に、GitHub ホスト型 Ubuntu ランナーは
  `rr replay` を駆動できない
  （[ADR-0011](https://github.com/aletheia-works/vivarium/blob/main/_context/decisions/0011-phase4-first-vertical-rr.md)、
  プライベートメモ）。Layer 3 branch-fix 検証には CPUID フォールティングを公開する
  セルフホストランナーが必要だ。
- **プライベートレジストリへの認証。** v1 では提供されたイメージ参照が
  匿名でプル可能であることを前提とする。プルシークレットの配管の追加は
  実際の需要に対するゲート付きの後続作業だ。

## 関連情報

- [比較ページ](../repro/compare.mdx) — このパイプラインのアーティファクトバンドルを
  消費する R.3 のサイドバイサイド UI（file-drop、URL パラメータ、JSON paste の
  3 経路）。
- [Contract v1](./contract-v1.md) — このパイプラインが出力・消費する verdict サーフェス。
- [`verdict.schema.json`](https://github.com/aletheia-works/vivarium/blob/main/docs/public/spec/verdict.schema.json) —
  バンドルの両エントリが検証に使用するスキーマ。
- [Consumer workflow](./consumer-workflow.md) — コンシューマーリポジトリの CI で
  Vivarium レシピを検証するための兄弟再利用可能ワークフロー。
  branch-fix パイプラインは内部的に同じ Layer 2 キャプチャヘルパーを再利用する。
- [Layer 2 カタログ](https://github.com/aletheia-works/vivarium/tree/main/src/layer2_docker)
  — `inputs.slug` に使用できるスラッグ。

Phase 6 サブストリーム R.2。
[ロードマップ](../roadmap.md#phase-6--ユーザビリティとビジュアルレイヤー)に従う。
