# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

このリポジトリには [`AGENTS.md`](AGENTS.md) に詳細なエージェント向けガイドがあります。作業フロー・PR 運用・重要仕様・秘密情報の扱いはそちらを一次情報として扱い、以下は Claude Code で作業する際の要点のみをまとめます。

## 言語

回答・コミットメッセージ・PR・Issue・`docs/` 配下の文書はすべて日本語で書きます（`.cursorrules` の指示に準拠）。

## よく使うコマンド

```bash
# 初回セットアップ（ルート・client・server の依存関係を一括インストール）
npm run setup
cp server/.env.example server/.env
cp client/.env.example client/.env
npm run seed                     # SQLite 初期化＋シード投入

# 開発サーバー起動（client:5173 と server:3001 を同時起動）
npm run dev
npm run client                   # フロントのみ
npm run server                   # バックのみ

# E2E テスト（Playwright、`webServer` 経由で自動起動される）
npm run test:e2e                 # 全テスト（chromium / firefox / webkit）
npm run test:e2e:headed          # ブラウザ表示
npm run test:e2e:debug           # デバッグモード
npm run test:e2e:discount        # 割引テストのみ（seed 後 chromium で実行）

# 単一テスト・特定プロジェクト指定（scripts/run-e2e.js は残り引数を playwright test にそのまま渡す）
node scripts/run-e2e.js tests/e2e/transaction-form.test.js --project=chromium
node scripts/run-e2e.js -g "テスト名の部分一致"

# フロントエンドのビルド確認
npm run build --prefix client
```

サーバー単体の自動テストは薄いため、API 変更時は該当ルートの手動確認か E2E 追加を検討します。

## アーキテクチャの要点

**構成**: Vue 3 (Vite) の SPA `client/` と、Express の API `server/` を SQLite (`server/household.db`) が支える 2 プロセス構成。開発時は Vite の `/api` プロキシ経由で Express に転送されます。

**フロントエンド状態管理**: グローバルストアは持たず、`client/src/App.vue` が画面全体の状態を保持し、主要コンポーネントに props/emit で流します。API 呼び出しは `client/src/api.js` に集約。`client/src/utils.js` に会計月などの共通ロジック。

**バックエンド**: `server/app.js` が dotenv 読込とルート登録を行い、実装は `server/routes/` に分割（`transactions` / `fixed_costs` / `categories` / `analysis` / `summary` / `ocr` / `import` / `backup`）。ORM は使わず `sqlite3` で生 SQL。DB スキーマ初期化は `server/db.js`。

**会計月ロジック（最重要）**: 家計簿の 1 会計月は「毎月 23 日から翌月 22 日」。`fiscal_month` は `YYYY-MM` 形式で `transactions` テーブルに保存されます。**この会計月変換ロジックはフロントとバックの両方に存在するため、変更時は必ず両側の整合を確認**してください（`client/src/utils.js` とサーバー側の関連ルート）。

**主要テーブル `transactions`**: 支出/収入は `type` の `EXPENSE` / `INCOME` で区別。カテゴリは `categories.code` / `categories.group_name` に依存して集計されます。

**マイナス金額の扱い**: 割引・値引き・クーポンは有効な支出明細として保存し、常に税込扱いにします。税抜モードでもマイナス金額には税率を掛けません。

**外部連携**: レシート OCR は Gemini API (`@google/generative-ai`)。動作確認には `server/.env` の `GEMINI_API_KEY` が必要です。E2E での OCR は Playwright のルートモックで固定レスポンスを使うことを優先します。

**バックアップ/インポート**: バックアップ CSV は Excel 互換のため Shift_JIS 出力（`iconv-lite`）。Excel インポートとリストアは既存データを削除・上書きする経路があるため、UI 確認導線とバックアップ動線を維持してください。

## 変更時のチェックポイント

- UI 変更: `App.vue` の状態と props 流しが崩れていないか
- API 変更: `client/src/api.js` の呼び出し側と `server/routes/` のレスポンス形が一致しているか
- DB スキーマ変更: 既存 SQLite ファイル、シード、バックアップ/リストア、Excel インポートへの影響
- 会計月ロジック変更: フロント・バック双方
- 破壊的操作を含む機能: 確認 UI とバックアップ導線を残す
- 給与セル関連の変更: `FixedCostManager.vue` の `salaryEntries` state と `POST/PUT/DELETE /api/fixed_costs/salary` の整合、`INCOME_FIXED_CODES` の client (`FixedCostManager.vue`) / server (`server/routes/fixed_costs.js`) 二重管理箇所の同期
- README / `docs/` と実装が食い違う変更: 同じ PR でドキュメントも更新

## 実行生成物（コミットしない）

`server/household.db` と WAL/SHM、`server/uploads/`、`playwright-report/`、`test-results/`、`.env` 各種。実データを含む CSV/Excel/DB もコミット禁止です。

## PR 運用

Issue → `feature/issue-<番号>-<短い説明>` ブランチ → PR → **人間がマージ**（エージェントはマージしない）。PR 本文は背景・対応内容・コミット構成・確認内容・レビュー指摘対応・残リスクを後から判断できる粒度で日本語で記述します。
