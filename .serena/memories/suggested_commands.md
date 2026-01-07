# 推奨コマンド一覧

## セットアップ・初期化
```bash
# 依存関係の一括インストール（初回のみ）
npm run setup

# データベースの初期化とサンプルデータ投入
npm run seed
```

## 開発用コマンド
```bash
# 開発サーバー起動（クライアント・サーバー同時起動）
npm run dev

# サーバーのみ起動
npm run server

# クライアントのみ起動
npm run client
```

## 個別ディレクトリでの作業
```bash
# クライアント側での作業
cd client
npm run dev        # 開発サーバー起動
npm run build      # プロダクションビルド
npm run preview    # ビルド結果のプレビュー

# サーバー側での作業
cd server
node app.js        # サーバー起動
node seed.js       # データベース初期化
```

## システムコマンド（macOS）
```bash
# ファイル操作
ls -la            # ファイル一覧表示
cp source dest    # ファイルコピー
rm file           # ファイル削除
mkdir dir         # ディレクトリ作成

# 検索
find . -name "*.js"     # JavaScriptファイル検索
grep -r "search" .      # テキスト検索

# Git操作
git status        # 状態確認
git add .         # 変更をステージング
git commit -m "message"  # コミット
git push          # プッシュ
```

## アクセスURL
- フロントエンド: http://localhost:5173 (Vite開発サーバー)
- バックエンドAPI: http://localhost:3000 (Express サーバー)
- ヘルスチェック: http://localhost:3000/api/health