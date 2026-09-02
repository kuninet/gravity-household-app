# AGENTS.md

このリポジトリで作業するエージェント向けのガイドです。回答と作業報告は常に日本語で行ってください。
PR のタイトル・本文、Issue、コミットメッセージ、AGENTS.md、README、docs 配下の文書は原則として日本語で記述してください。

## 作業フロー

- GitHub 管理下の作業では、原則として Issue を作成し、対応ブランチを切ってから変更します。
- ブランチ名は特別な指定がなければ `feature/issue-<番号>-<短い説明>` を使います。
- 修正後は PR を作成します。マージは人間が行うため、エージェントはマージしません。
- PR 本文は、背景、対応内容、コミット構成、確認内容、レビュー指摘への対応、残リスク・補足を含め、後から判断できる粒度で詳しく記述してください。
- 作業は必ずチームで進めます。計画者、実装者、批判的レビュー者の役割を置き、調査や実装補助は軽量モデルのサブエージェントに任せ、主担当が結果を統合します。
- 実装前に Issue に紐づく細かい作業計画を立て、実装中も小さな意味単位でコミットしてください。
- 既存の未コミット変更を見つけた場合は、ユーザー作業として扱い、勝手に戻さないでください。

## プロジェクト概要

家計簿アプリ Gravity は、Excel での家計管理から移行するための Web アプリです。

- フロントエンド: `client/` の Vue 3 + Vite SPA
- バックエンド: `server/` の Node.js + Express API
- データベース: `server/household.db` の SQLite
- 開発時の通信: Vite の `/api` プロキシ経由で Express に転送
- 主要ドキュメント: `README.md`, `docs/architecture.md`, `docs/specifications.md`, `docs/user_manual.md`, `docs/troubleshooting.md`

## 主要ディレクトリ

- `client/src/App.vue`: 画面全体の状態管理と主要コンポーネントの接続
- `client/src/api.js`: フロントエンドからバックエンド API への呼び出し
- `client/src/utils.js`: 会計月などの共通ユーティリティ
- `client/src/components/TransactionForm.vue`: 日々の収支入力、履歴コピー、OCR、内訳入力の起点
- `client/src/components/FixedCostManager.vue`: 毎月の固定入力（収入・支出）マトリクスと Excel ペースト。支出（固定費・公共料金）と収入（給与）を横並びで扱う
- `client/src/components/ExcelImport.vue`: バックアップ、リストア、Excel 取込
- `server/app.js`: Express アプリと API ルート登録
- `server/db.js`: SQLite 接続と基本スキーマ作成
- `server/routes/`: API エンドポイント群
- `server/lib/`: レシート照合ロジック（`receiptMatcher.js`）。`scripts/check-receipts.js`（CLI）と `server/routes/receipts.js`（API）が共有する
- `tests/e2e/`: Playwright E2E テスト

## 重要な仕様

- 家計簿の会計月は「毎月 23 日から翌月 22 日まで」です。
- `fiscal_month` は `YYYY-MM` 形式で保存します。23 日以降の日付は翌月の会計月になります。
- 会計月ロジックはフロントエンドとバックエンドの双方に存在するため、変更時は両側の整合を確認してください。
- 支出と収入は `transactions.type` の `EXPENSE` / `INCOME` で区別します。
- カテゴリは `categories.code` と `categories.group_name` に依存して集計されます。
- 「毎月の固定入力」画面の収入は現状「給与」（`category_code=700`）のみを扱います。拡張時は `FixedCostManager.vue` と `server/routes/fixed_costs.js` の双方に定義されている `INCOME_FIXED_CODES` に対象コードを追加してください（既知の二重管理箇所）。
- 給与（`type=INCOME` / `category_code=700`）は同一 `fiscal_month` に**複数明細**を登録できます。追加・更新・削除は専用エンドポイントの `POST /api/fixed_costs/salary`、`PUT /api/fixed_costs/salary/:id`、`DELETE /api/fixed_costs/salary/:id` を使用します。
- 既存の `POST /api/fixed_costs/update_cell` と `POST /api/fixed_costs/batch_update` は `(fiscal_month, category_code, type)` の一意化を前提としており、`type=INCOME && category_code=700` の書き込みは **400 で拒否**します。給与の書き込みは必ず salary 専用エンドポイント経由で行ってください。Excel ペーストも給与列は v1 では skip します。
- 固定入力で登録する給与レコードの `date` は、その `fiscal_month` に必ず含まれる日付（前月 25 日）を `resolveInsertDate` で決定して保存します。`fiscal_month` と `getFiscalMonth(date)` が整合する側の日付を採用してください。`PUT /api/fixed_costs/salary/:id` では金額と摘要のみ更新し、`date` / `fiscal_month` は保持します（月の付け替えは削除＋追加で行う想定）。
- レシート OCR は Gemini API を使います。OCR 関連の動作確認には `server/.env` の `GEMINI_API_KEY` が必要です。
- 割引、値引き、クーポンなどのマイナス金額は有効な支出明細として保存し、常に税込扱いにしてください。税抜モードでもマイナス金額に税率を掛けないでください。
- バックアップ CSV は Excel で扱いやすいよう Shift_JIS で出力されます。
- Excel インポートやリストアは既存データを削除・上書きする経路があります。実データで試す前に必ずバックアップを取ってください。

## セットアップと起動

初回セットアップ:

```bash
npm run setup
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run seed
```

開発サーバー起動:

```bash
npm run dev
```

標準ポート:

- フロントエンド: `http://localhost:5173`
- バックエンド API: `http://localhost:3001`

`server/.env` の `PORT` と `client/.env` の `VITE_API_PORT` は一致させてください。

## 検証コマンド

変更内容に応じて、必要な範囲で実行してください。

```bash
npm run test:e2e
npm run test:e2e:discount
npm run test:e2e:headed
npm run client -- --host 0.0.0.0
npm run server
```

E2E を追加・変更するときは、`tests/e2e/` 配下に再実行可能なテストを置き、必要に応じて `package.json` に専用スクリプトを追加してください。OCR の E2E は外部 API に依存しないよう、Playwright のルートモックなどで固定レスポンスを使うことを優先してください。

フロントエンド単体のビルド確認:

```bash
npm run build --prefix client
```

バックエンドには専用の自動テストがまだ薄いため、API 変更時は該当ルートの手動確認や E2E 追加を検討してください。

## 実行生成物と秘密情報

- `.env` はローカル設定です。API キーや秘密情報をコミットしないでください。
- `server/household.db`、SQLite の WAL/SHM ファイル、`uploads/`、Playwright のレポート類は実行生成物として扱います。
- 実データを含む CSV、Excel、DB ファイルを追加しないでください。

## 変更時の注意

- UI 変更では、`client/src/App.vue` と関連コンポーネントの状態更新が崩れていないか確認してください。
- API 変更では、`client/src/api.js` の呼び出し側と `server/routes/` のレスポンス形を合わせてください。
- DB スキーマを変える場合は、既存の SQLite ファイル、シード、バックアップ/リストア、Excel インポートへの影響を確認してください。
- 破壊的操作を含む機能は、ユーザーに確認を求める UI とバックアップ導線を維持してください。
- README や `docs/` と実装が食い違う変更をした場合は、同じ PR でドキュメントも更新してください。
