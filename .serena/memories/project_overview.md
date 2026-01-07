# 家計簿アプリGravity - プロジェクト概要

## プロジェクトの目的
Excelでの家計管理から移行するために開発された、Webベースの家計簿アプリケーション。
シンプルで直感的な操作性を重視し、日々の収支入力や月ごとの収支確認、グラフによる可視化を容易に行える。

## 主要機能
- **収支入力**: 日々の取引を簡単に入力
- **履歴からコピー**: 過去の入力履歴からコピーして素早く入力
- **月次一覧**: 月ごとの収支を一覧で確認
- **集計・可視化**: カテゴリ別の支出や月次推移をグラフ（Chart.js）や集計表で確認
- **家計簿期間**: 毎月23日から翌月22日を1ヶ月として集計
- **Excelインポート**: 既存のExcelデータの読み込み機能
- **OCR機能**: レシート読み取り機能（Google Generative AI使用）
- **固定費管理**: 家賃・光熱費などの固定費管理

## 技術スタック

### フロントエンド (client/)
- Vue.js 3 (Composition API使用)
- Vite (開発サーバー・ビルドツール)
- Tailwind CSS (スタイリング)
- Chart.js / vue-chartjs (グラフ表示)

### バックエンド (server/)
- Node.js
- Express (Webフレームワーク)
- SQLite3 (データベース)
- Google Generative AI (OCR機能)
- Multer (ファイルアップロード)
- CORS対応

## データベース構造
- **transactions**: 取引データ（日付、金額、カテゴリ、説明など）
- **categories**: カテゴリマスタ（コード、名前、グループ名）

## プロジェクト構造
```
家計簿アプリGravity/
├── client/          # Vue.js フロントエンド
│   ├── src/
│   │   ├── components/  # Vueコンポーネント
│   │   ├── api.js      # API通信
│   │   └── utils.js    # ユーティリティ関数
│   └── package.json
├── server/          # Express バックエンド
│   ├── routes/      # APIルート
│   ├── db.js        # データベース設定
│   ├── app.js       # メインアプリケーション
│   └── package.json
└── package.json     # ルートレベルスクリプト
```

## 開発環境
- プログラミング言語: JavaScript (Vue.js), Node.js
- ファイルエンコーディング: UTF-8
- プラットフォーム: macOS (Darwin)