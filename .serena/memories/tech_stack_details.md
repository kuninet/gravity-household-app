# 技術スタック詳細

## フロントエンド技術

### Vue.js 3
- **バージョン**: 3.5.24
- **構文**: Composition API (`<script setup>`)
- **リアクティビティ**: `ref()`, `reactive()`, `computed()`, `watch()`
- **ライフサイクル**: `onMounted()`, `onUnmounted()`

### ビルドツール
- **Vite**: 7.2.4 (開発サーバー・ビルドツール)
- **プラグイン**: @vitejs/plugin-vue

### スタイリング
- **Tailwind CSS**: 4.1.18 (ユーティリティファーストCSS)
- **PostCSS**: 8.5.6 (CSS処理)
- **Autoprefixer**: 10.4.23 (ベンダープレフィックス自動付与)

### データ可視化
- **Chart.js**: 4.5.1 (グラフライブラリ)
- **vue-chartjs**: 5.3.3 (Vue.js用Chart.jsラッパー)

## バックエンド技術

### Node.js/Express
- **Express**: 5.2.1 (Webフレームワーク)
- **CORS**: 2.8.5 (クロスオリジン対応)
- **body-parser**: 2.2.1 (リクエストボディ解析)

### データベース
- **SQLite3**: 5.1.7 (軽量データベース)
- **設定**: WALモード、busyTimeout 5000ms

### ファイル処理
- **Multer**: 2.0.2 (ファイルアップロード)
- **XLSX**: 0.18.5 (Excelファイル処理)
- **csv-parse**: 6.1.0 (CSV解析)
- **csv-stringify**: 6.6.0 (CSV生成)
- **iconv-lite**: 0.7.1 (文字エンコーディング変換)

### AI機能
- **@google/generative-ai**: 0.24.1 (Google Gemini API)
- **dotenv**: 17.2.3 (環境変数管理)

## 開発ツール

### パッケージ管理
- **npm**: Node.js標準パッケージマネージャー
- **concurrently**: 8.2.2 (複数プロセス同時実行)

### 設定ファイル
- **Vite設定**: `vite.config.js`
- **Tailwind設定**: `tailwind.config.js`
- **PostCSS設定**: `postcss.config.js`

## API構造

### エンドポイント
- `/api/transactions` - 取引データ操作
- `/api/categories` - カテゴリマスタ操作
- `/api/summary` - 集計データ取得
- `/api/analysis` - 分析データ取得
- `/api/fixed_costs` - 固定費管理
- `/api/import` - データインポート
- `/api/ocr` - OCR機能
- `/api/backup` - バックアップ機能
- `/api/health` - ヘルスチェック

## データベーススキーマ

### transactions テーブル
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `date`: TEXT NOT NULL
- `fiscal_month`: TEXT NOT NULL
- `amount`: INTEGER NOT NULL
- `type`: TEXT NOT NULL
- `category_code`: INTEGER
- `description`: TEXT
- `memo`: TEXT
- `created_at`: TEXT DEFAULT CURRENT_TIMESTAMP

### categories テーブル
- `code`: INTEGER PRIMARY KEY
- `name`: TEXT NOT NULL
- `group_name`: TEXT NOT NULL