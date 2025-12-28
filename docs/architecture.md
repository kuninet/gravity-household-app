# システムアーキテクチャ

## 概要
家計簿アプリ「Gravity」は、モダンなWeb技術スタックを用いたSPA (Single Page Application) です。
フロントエンドは **Vue 3 (Vite)**、バックエンドは **Node.js (Express)**、データベースは **SQLite** を採用しています。

## 技術スタック

### フロントエンド (`/client`)
- **フレームワーク**: Vue.js 3 (Composition API, `<script setup>`)
- **ビルドツール**: Vite
- **UIスタイリング**: Tailwind CSS
- **HTTPクライアント**: Fetch API (一部 `api.js` でラップ)
- **主なコンポーネント**:
  - `TransactionForm.vue`: 家計簿入力、レシートOCR、内訳計算
  - `ReceiptOCR.vue`: Gemini APIを用いたレシート解析 (Drag & Drop, 税区分選択)
  - `ReceiptSplitter.vue`: 支払総額からの内訳計算、税額自動計算
  - `ExcelImport.vue`: バックアップ、リストア、Excel一括取込
  - `FixedCostManager.vue`: 固定費のマトリクス入力、Excelペースト対応
  - `YearlyAnalysis.vue`: 年次収支のグラフ・表表示

### バックエンド (`/server`)
- **ランタイム**: Node.js
- **フレームワーク**: Express.js
- **データベース**: SQLite3 (`household.db`)
- **ORM/クエリビルダ**: なし (生SQL `sqlite3` ライブラリ使用)
- **外部API**: Google Gemini API (`@google/generative-ai`) - レシートOCR用
- **依存ライブラリ**:
  - `multer`: ファイルアップロード処理
  - `csv-stringify` / `csv-parse`: CSVバックアップ・復元
  - `iconv-lite`: Shift_JIS エンコーディング対応
  - `xlsx`: Excelファイル解析

## ディレクトリ構成
```
/
├── client/                 # フロントエンド・ソースコード
│   ├── src/
│   │   ├── components/     # Vueコンポーネント
│   │   ├── api.js          # API呼び出し関数群
│   │   ├── App.vue         # メインアプリケーション
│   │   └── main.js         # エントリーポイント
│   └── vite.config.js      # Vite設定 (プロキシ設定含む)
│
├── server/                 # バックエンド・ソースコード
│   ├── routes/             # APIエンドポイント定義
│   │   ├── transactions.js # 家計簿CRUD
│   │   ├── fixed_costs.js  # 固定費管理
│   │   ├── ocr.js          # Gemini OCR処理
│   │   ├── import.js       # Excelインポート
│   │   └── backup.js       # 全データバックアップ・復元・削除
│   ├── db.js               # SQLite接続・スキーマ定義
│   ├── app.js              # Expressアプリ設定・ルーティング登録
│   ├── household.db        # SQLiteデータベースファイル (自動生成)
│   └── uploads/            # 一時ファイル保存先
│
└── docs/                   # 開発・運用ドキュメント
```

## データフローとプロキシ
開発環境 (`npm run dev`) では、フロントエンド(Vite: 5173) とバックエンド(Express: 3001) が別ポートで動作します。
CORS問題を回避するため、`vite.config.js` の `server.proxy` 設定により、`/api` へのリクエストはバックエンドへ転送されます。

**リクエストフロー:**
User -> Vue App (Current View) -> `api.js` / `fetch` -> Vite Proxy -> Express Server -> SQLite DB

## データベーススキーマ (`server/db.js`)
主なテーブルは `transactions` 一つに集約されています。

### `transactions` テーブル
| カラム名 | 型 | 説明 |
| --- | --- | --- |
| `id` | INTEGER | PK, Auto Increment |
| `date` | TEXT | 取引日 (YYYY-MM-DD) |
| `fiscal_month` | TEXT | 会計月 (YYYY-MM) |
| `amount` | INTEGER | 金額 |
| `type` | TEXT | 'EXPENSE' (支出) または 'INCOME' (収入) |
| `category_code` | INTEGER | カテゴリコード (例: 100=食費) |
| `description` | TEXT | 品名、店名など |
| `memo` | TEXT | 備考 |
| `created_at` | TEXT | 作成日時 |

categoriesテーブルは初期シードデータとして存在しますが、主要なデータは全て `transactions` に保存されます。
