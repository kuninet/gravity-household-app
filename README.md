# 家計簿アプリ Gravity

Excelでの家計管理から移行するために開発された、Webベースの家計簿アプリケーションです。
シンプルで直感的な操作性を重視し、日々の収支入力や月ごとの収支確認、グラフによる可視化を容易に行えます。

## 機能特徴

- **収支入力**: 日々の取引を簡単に入力できます。
- **履歴からコピー**: 過去の入力履歴からコピーして素早く入力可能です。
- **月次一覧**: 月ごとの収支を一覧で確認できます。
- **集計・可視化**: カテゴリ別の支出や月次推移をグラフ（Chart.js）や集計表で確認できます。
- **品名価格推移（物価分析）**: 「納豆」「牛乳」「卵」などキーワードで過去の支出を横断抽出し、価格推移グラフとサマリーを表示。TypeSafe AIの「Jev」モデルと連携したAIスマート抽出（表記揺れ吸収）に対応。
- **固定入力（収入・支出）**: 家賃・光熱費などの固定支出と給与収入をマトリクスで一括管理できます。給与は 1 会計月に複数明細を登録でき、給与セルをクリックすると明細モーダルが開いて追加・編集・削除ができます。
- **リモート MCP サーバー**: 外部の AI クライアントから家計簿の参照・登録（参照 7 ツール / 更新 4 ツール）を行えます。
- **家計簿期間**: 毎月23日から翌月22日を1ヶ月として集計します。

## 技術スタック

本プロジェクトは以下の技術を使用しています。

### フロントエンド (Client)

- Vue.js 3
- Vite
- Tailwind CSS
- Chart.js / vue-chartjs

### バックエンド (Server)

- Node.js
- Express
- SQLite3
- @modelcontextprotocol/sdk: Model Context Protocol サーバー実装 (Streamable HTTP)
- express-rate-limit: API レート制限
- zod: 入出力バリデーションスキーマ

## セットアップ手順

プロジェクトを動かすには Node.js が必要です。

1.  **リポジトリのクローン**

    ```bash
    git clone <repository-url>
    cd 家計簿アプリGravity
    ```

2.  **依存関係のインストール**
    ルートディレクトリで以下のコマンドを実行し、クライアント・サーバー両方の依存関係を一括でインストールします。

    ```bash
    npm run setup
    ```

3.  **環境変数の設定**
    各ディレクトリの `.env.example` をコピーして `.env` を作成します。

    ```bash
    cp server/.env.example server/.env
    cp client/.env.example client/.env
    ```

    `server/.env` に Gemini API キーなど必要な値を設定してください。
    ポート番号を変更したい場合は、各 `.env` ファイルを編集します（後述）。

4.  **初期データの投入（シード）**
    データベース（SQLite）の初期設定とサンプルデータの投入を行います。

    ```bash
    npm run seed
    ```

5.  **アプリケーションの起動**
    以下のコマンドでサーバーとクライアントを同時に起動します。
    ```bash
    npm run dev
    ```
    - ブラウザで `http://localhost:5173` にアクセスして利用します。
    - バックエンドAPIは `http://localhost:3001` で動作します。

## Windows サービスとして常駐させる

Windows PC 上で Gravity を常時起動しておきたい場合、[NSSM](https://nssm.cc/) を使ってサービス化できます。

- **前提**: NSSM をダウンロードし、実行ファイルを PATH に追加しておいてください。
- **登録**: `household_service_install.bat` を管理者として実行すると、サービス `HouseholdGravity` が登録・起動されます。
- **更新**: `household_service_update.bat` を管理者として実行すると、`git pull` → 依存関係の変更があれば `npm run setup` → サービス再起動、を自動で行います。**未コミットのローカル変更があると更新は中断されます**。
- **削除**: `household_service_uninstall.bat` を管理者として実行すると、サービスを停止・削除します。
- **ログ**: サービスの標準出力・エラー出力はリポジトリ直下の `logs/` に出力されます。
- **実行ユーザー**: 各バッチはサービス登録時と同じユーザーで、管理者に昇格して実行してください。別ユーザーで実行すると、git のリポジトリ所有権チェックや資格情報が一致せず失敗することがあります。
- **更新時の再起動**: `household_service_update.bat` は `git pull` で更新が無かった場合（`Already up to date`）でも、サービスの再起動自体は必ず行います。プロセスを立ち上げ直したいだけのときにもそのまま実行できます。

## リモート MCP サーバー

外部の AI クライアント（Claude Code や Cursor 等）から家計簿データを安全に参照・更新できるリモート MCP (Model Context Protocol) サーバーを提供しています。

### 概要

- **エンドポイント**: `POST /mcp`（バックエンドの Express ポート `3001` へ直接接続。Vite 開発プロキシは経由しません）
- **プロトコル方式**: Streamable HTTP（ステートレス、セッション ID なし、POST メソッドのみ、レスポンスは常に JSON 形式）
- **公開ツール**: 参照系 7 ツール、更新系 4 ツール（計 11 ツール）。各ツールの引数仕様や固定費保護ルール等の詳細は [docs/specifications.md](docs/specifications.md#7-リモート-mcp-サーバーservermcp) を参照してください。

### 有効化手順

#### 1. 認証トークンの生成

16 文字以上の安全な乱数トークンを生成します（32 バイトの hex 文字列 = 64 文字を推奨）。

- **Node.js（推奨・全 OS 共通）**:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **OpenSSL（Mac / Linux / Git Bash）**:
  ```bash
  openssl rand -hex 32
  ```
- **PowerShell（Windows）**:
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') })
  ```

#### 2. 環境変数の設定

`server/.env` に生成したトークンを設定します。未設定または 16 文字未満の場合はエンドポイントが無効化（HTTP 503）されます。認証方式の既定は `MCP_AUTH_MODE=token`（Bearer トークン認証）です。トークンを使わずに運用する場合は後述の「[トークンなしで使う](#トークンなしで使うmcp_auth_modenone)」を参照してください。

```dotenv
MCP_AUTH_TOKEN=your_generated_token_here
```

#### 3. サーバーの再起動

- **開発時**: `npm run server`（または `npm run dev`）を再起動します。
- **Windows サービス時**: `household_service_update.bat` を実行してサービスを再起動します。

#### 4. 動作確認

curl または PowerShell でツール一覧の取得をテストします（実行前に `export MCP_AUTH_TOKEN=your_token` または `$env:MCP_AUTH_TOKEN="your_token"` で環境変数を設定するか、ヘッダーに直接トークン文字列を指定してください）。

- **bash / zsh**:
  ```bash
  curl -s -X POST http://localhost:3001/mcp \
    -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  ```
- **PowerShell**:
  ```powershell
  $headers = @{
    "Authorization" = "Bearer $env:MCP_AUTH_TOKEN"
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
  }
  $body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  Invoke-RestMethod -Uri "http://localhost:3001/mcp" -Method Post -Headers $headers -Body $body
  ```

正常に接続できると、11 種類のツール一覧（JSON 形式）が返却されます。`MCP_AUTH_MODE=none` で起動している場合は `Authorization` ヘッダーは不要です。

### クライアント接続設定

トークン文字列を設定ファイルに直接コミットしないよう、環境変数を参照する形式を推奨します。

> 💡 **推奨設定**: プロジェクト直下の `.mcp.json` に環境変数参照（`${GRAVITY_MCP_TOKEN}`）を記述する方法を推奨します。CLI コマンド（`claude mcp add`）を使用すると、シェルの変数展開によってグローバル設定ファイル（`~/.claude.json`）内にトークン平文が直接保存されてしまうため注意してください。

#### Claude Code (プロジェクト共有 `.mcp.json` 【推奨】)

```json
{
  "mcpServers": {
    "gravity": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer ${GRAVITY_MCP_TOKEN}"
      }
    }
  }
}
```

#### Claude Code (CLI)

```bash
# 注意: シェル展開により ~/.claude.json にトークン実値が保存されます
claude mcp add --transport http gravity http://localhost:3001/mcp \
  --header "Authorization: Bearer ${GRAVITY_MCP_TOKEN}"
```

#### Cursor (`~/.cursor/mcp.json` または `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "gravity": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer ${env:GRAVITY_MCP_TOKEN}"
      }
    }
  }
}
```

#### ヘッダーを設定できないクライアント（クエリ認証）

Authorization ヘッダーを指定できないクライアントを利用する場合は、`server/.env` で `MCP_ALLOW_QUERY_TOKEN=true` を設定し、`http://localhost:3001/mcp?token=<token>` 形式で接続できます。ただし URL 中のトークンはアクセスログ等に残るため、通常運用ではヘッダー認証（`false`）を推奨します。

### トークンなしで使う（MCP_AUTH_MODE=none）

claude.ai のカスタムコネクタなど、`Authorization` ヘッダーを付けられないクライアントから接続する場合は、`server/.env` で認証を明示的に無効化できます。既定は `MCP_AUTH_MODE=token`（トークン認証）で、`none` 以外の値（未設定・空・綴り誤り・`off` など）はすべてトークン必須として扱われます。

```dotenv
MCP_AUTH_MODE=none
# 外部公開する場合は必ず Host 検証も併用してください
MCP_ALLOWED_HOSTS=localhost,127.0.0.1,mcp.example.com
```

- `MCP_AUTH_MODE=none` のとき、`MCP_AUTH_TOKEN` の有無や `Authorization` ヘッダー・`?token` の内容にかかわらず、`/mcp` は 503 / 401 を返さず認証なしで処理します。Host 検証・全体レート制限・405 応答などは通常どおり有効です。
- 起動時に `[MCP] 警告: MCP_AUTH_MODE=none のため /mcp は認証なしで公開されています。…` という警告ログが出力されます。なお `MCP_AUTH_MODE` に `token` / `none` 以外の値（綴り誤りなど）を設定すると、起動時に `[MCP] 警告: MCP_AUTH_MODE の値が不正なため token モードとして扱います。` が出力され、トークン認証で動作します。

> [!CAUTION]
> **`/mcp` の URL を知っている人は誰でも、家計簿の参照・更新ツール（`delete_transaction` を含む）を実行できます。**
> 外部公開する場合は、Cloudflare Access や Tailscale 等の前段で接続元を必ず制限してください。あわせて、トンネルやリバースプロキシでは `/mcp` パスのみを転送し、`MCP_ALLOWED_HOSTS` を設定してください（詳細は次節）。接続元を制限できない環境では、既定のトークン認証を使用してください。

### 外部公開（トンネル）時の注意

> [!CAUTION]
> **重大なセキュリティリスク: ポート全体のトンネル公開は厳禁**
>
> `cloudflared tunnel --url http://localhost:3001` のようにポート全体をトンネル公開すると、認証のない既存 `/api/*`（`/api/backup/restore` などの破壊的 API や `/api/transactions` 等の個人データ API）までインターネット上に無防備に公開されてしまいます。データ漏洩・破壊・改ざんの重大な危険があるため、ポート全体の公開は絶対に行わないでください。外部公開する際は、必ずトンネルやリバースプロキシで **`/mcp` パスのみを転送対象** としてください。

- **`/mcp` のみ転送するトンネル設定例 (Cloudflare Tunnel)**:
  設定ファイル（`config.yml`）の ingress ルールで `/mcp` のみを転送し、それ以外のすべてのパスを 404 で遮断します。
  ```yaml
  tunnel: <YOUR-TUNNEL-ID>
  credentials-file: /path/to/<YOUR-TUNNEL-ID>.json

  ingress:
    # /mcp のみをローカルの Express サーバーへ転送
    - hostname: mcp.example.com
      path: ^/mcp$
      service: http://localhost:3001
    # それ以外のパス（/api/* や Web 画面など）はすべて 404 で遮断
    - service: http_status:404
  ```
- **リバースプロキシによる限定公開例 (nginx)**:
  nginx などを経由して `/mcp` のみを外部公開し、HTTPS 終端を行うことも可能です。
  ```nginx
  location = /mcp {
      proxy_pass http://localhost:3001/mcp;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
  }
  ```
- **一時トンネル（--url）の注意点**: `cloudflared tunnel --url ...` などのクイックトンネルは起動ごとにランダムなサブドメインが割り当てられるため、固定設定が必要な `server/.env` の `MCP_ALLOWED_HOSTS` と不整合になり `403 Host not allowed` が発生します。外部公開には固定ドメイン（上記 config.yml 形式）を使用してください。
- **Host 検証**: トンネル公開時は `server/.env` の `MCP_ALLOWED_HOSTS` に許可ホスト名（例: `localhost,127.0.0.1,mcp.example.com`）を指定し、DNS リバインディング攻撃を防止してください。
- **レート制限と共有 IP**: トンネル経由では全リクエストが同一のローカル IP として集約されます。誤設定のクライアントによる認証失敗（15分間に10回）が発生すると、同一 IP 全体に 429 レート制限が適用されます。サーバーを再起動するとカウンタはリセットされます。
- **更新系ツールの承認**: 更新系ツールは実データを変更・削除します。`delete_transaction` は `confirm: true` が必須ですが、クライアント側でもツール実行前の人間による承認確認を有効にしておくことを推奨します。

## ディレクトリ構成

- `client/`: フロントエンド (Vue.js) のソースコード
- `server/`: バックエンド (Express) のソースコードとデータベース関連
- `package.json`: プロジェクト全体のスクリプト管理

## 環境変数

各ポート番号は `.env` ファイルで変更可能です。

### `server/.env`

| 変数名                  | デフォルト値          | 説明                                                                                                 |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT`                  | `3001`                | バックエンド API サーバーのポート番号                                                                |
| `GEMINI_API_KEY`        | ―                     | Gemini API キー（レシート OCR 機能で使用）                                                           |
| `TYPESAFE_API_KEY`      | ―                     | TypeSafe AI API キー（Jev による品名判定・価格推移分析で使用）                                       |
| `MCP_AUTH_MODE`         | `token`               | リモート MCP の認証方式（`token`: Bearer 認証 / `none`: 認証なし。不正値は `token` 扱い）            |
| `MCP_AUTH_TOKEN`        | ―（無効）             | リモート MCP の Bearer 認証トークン（`MCP_AUTH_MODE=token` 時。未設定または 16 文字未満で MCP 無効） |
| `MCP_ALLOW_QUERY_TOKEN` | `false`               | `true` のとき `?token=<token>` クエリ認証を許可                                                      |
| `MCP_ALLOWED_HOSTS`     | ―（無制限）           | 許可する Host ヘッダー（カンマ区切り、DNS リバインディング対策）                                     |
| `DB_PATH`               | `server/household.db` | SQLite データベースファイルのパス（通常は変更不要）                                                  |

### `client/.env`

| 変数名          | デフォルト値 | 説明                                   |
| --------------- | ------------ | -------------------------------------- |
| `VITE_DEV_PORT` | `5173`       | フロントエンド開発サーバーのポート番号 |
| `VITE_API_PORT` | `3001`       | プロキシ先バックエンドのポート番号     |

> ⚠️ `server/.env` の `PORT` と `client/.env` の `VITE_API_PORT` は同じ値にしてください。

## 開発用コマンド

- `npm run dev`: サーバーとクライアントを同時に起動
- `npm run server`: サーバーのみを起動
- `npm run client`: クライアントのみを起動
- `npm run test:unit`: MCP サーバーやユーティリティを含む単体テストを実行
- `npm run test:e2e`: Playwright による E2E テストを実行

### レシート入れ忘れチェック

レシートファイル（PDF や画像など）を保存しているフォルダと家計簿 DB を突き合わせて、登録漏れの候補を検出するコマンドです。

**ファイル名の規約**: フォルダ直下のファイル名は `YYYYMMDD-店名[_連番].拡張子` の形式にしてください。店名の先頭に `レシート-` を付けても構いません（自動的に取り除かれます）。

```
20260715-スーパーアークス_027.pdf
20260723-トドック.pdf
20260729-レシート-ローソンユナイテッドシネマ.pdf
```

**コマンド例**:

```bash
npm run check:receipts -- ~/receipts --db ~/Downloads/household.db --month 2026-08
```

| オプション                     | 説明                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `<フォルダ>`（必須・位置引数） | レシートファイルを置いているフォルダのパス                                                 |
| `--db <path>`                  | 突合対象の DB ファイルパス（省略時は `server/household.db`）                               |
| `--month <YYYY-MM>`            | 対象の会計月（前月23日〜当月22日）。省略時はフォルダ内ファイルの日付範囲から自動判定します |
| `--aliases <path>`             | 店名別名表のパス（省略時は `server/lib/receipt-store-aliases.json`）                       |

`--month` を指定すると、会計月の範囲（前月23日〜当月22日）に入る日付のファイルだけを突合し、範囲外の日付のファイルは「対象外（別会計月）」として分けて表示します（入れ忘れ候補には含まれません）。フォルダに複数会計月分のファイルが混在している場合に便利です。

**突合のロジック**: まず全ファイルを同日・同店（正規化後）でグループ化し、(a) 日付が完全一致する DB 取引を優先的に割り当て、(b) 一致しなかったグループだけ ±1 日以内で再度探します（隣接日で一致した場合は警告欄に「隣接日の取引で一致」と表示）。一度割り当てた取引は他のファイルには使い回しません。同日同店のファイルが 2 枚以上あるグループは、1 枚のレシートに複数明細が付くため単純な件数比較ができず、常に「同日同店 N枚（DB明細 M件）要目視確認」の警告を付けます（目視で確認してください）。

**出力される分類**:

- **登録済み**: ファイルと DB の取引が日付・店名で一致したもの。
- **入れ忘れ候補**: ファイルはあるのに一致する取引が DB に見つからなかったもの。登録漏れの可能性があります。店名なし（メモが空）の取引は照合対象から除外しているため、実際には登録済みでも誤って候補に出ることがあります。
- **対象外（別会計月）**: `--month` で指定した会計月の範囲外の日付を持つファイル。
- **DB にのみ存在**: DB にはあるがどのファイルにも対応しなかった取引（メモが空の取引は対象外とし、件数のみサマリに表示します）。同日・同じ正規化メモの取引はまとめて件数と合計金額で表示します。
- **解析不能ファイル**: ファイル名がフォーマット（`YYYYMMDD-店名[_連番].拡張子`）に一致しなかったもの。

**終了コード**: 入れ忘れ候補が 1 件以上ある場合は `1`、引数や DB 関連のエラーの場合は `2`、問題がなければ `0` を返します。`npm run check:receipts -- ...` 経由で実行した場合、入れ忘れ候補あり（終了コード `1`）や引数・DB エラー（終了コード `2`）のときは npm 自体も同じ終了コードで終了します（npm のバージョンによっては `npm ERR!` 等の追加ログが出ることがありますが、これはエラーではなく正常な検出結果です）。終了コードだけを確認したい場合は `node scripts/check-receipts.js ...` を直接実行してください。

**別名表の編集**: `server/lib/receipt-store-aliases.json` にレシート上の店名と家計簿メモ上の店名の対応を追記すると、表記ゆれ（支店名の違いなど）を吸収できます。別名の置換はキー・値とも正規化（NFKC正規化・小文字化・空白/ハイフン類/中黒/括弧の除去）したうえで、長いキーから優先して 1 回だけ部分文字列置換します（置換結果が別のキーに再マッチして連鎖することはありません）。CLI は実行のたびに読み込みますが、画面版（API）はサーバー起動時に一度だけ読み込んで使い回すため、別名表を編集した場合は API サーバー（`npm run server`）の再起動が必要です。

**画面版（レシート照合タブ）**: 「レシート照合」タブから、上記と同じ突合ロジックをブラウザ上で実行できます。レシート画像・PDF ファイルを選択すると、送信されるのは `File.name`（ファイル名）のみで画像本体はサーバーに送られません。対象会計月を選ぶか「ファイルの日付から自動」のままにして「照合する」を押すと、CLI と同じ分類（登録済み／入れ忘れ候補／対象外／DB にのみ存在／解析不能）が表で表示されます。入れ忘れ候補の行にある「登録する」ボタンを押すと、日付と店名を入力済みの状態で「日々の記録」の取引登録フォームに切り替わります。CLI 版・画面版とも `server/lib/receiptMatcher.js` の同じロジックを共有しています。
