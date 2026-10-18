# トラブルシューティングガイド

エラーが発生した場合の調査ポイントと対応方法です。

## 1. サーバーエラー / APIエラー (500 Internal Server Error)

### 症状

- 画面上に「エラーが発生しました」と表示される。
- コンソールに `POST /api/xxx 500` のようなエラーが出る。

### 調査方法

1. **サーバーログの確認**:
   ターミナル（`npm run dev` を実行している画面）を確認してください。バックエンドの詳細なエラースタックトレースが出力されています。

   ```bash
   [0] Reset Error: Error: SQLITE_ERROR: ...
   ```

2. **よくある原因**:
   - **DBロック**: SQLiteファイルが別のプロセスで開かれている、または処理が競合している。
   - **構文エラー**: 直近で修正したサーバーサイドコード (`server/routes/*.js`) に文法ミスがある。

## 2. Gemini OCR が動かない / 失敗する

### 症状

- 「解析に失敗しました」と表示される。
- ローディングがずっと終わらない。

### チェックポイント

1. **APIキーの設定**:
   `server/.env` ファイルに `GEMINI_API_KEY` が正しく設定されているか確認してください。

2. **モデルの可用性**:
   `server/routes/ocr.js` では以下の順序でモデル利用を試みます。すべてのモデルで404やエラーが返る場合、APIキーの権限不足や、無料枠の制限到達が考えられます。
   1. `gemini-2.0-flash`
   2. `gemini-flash-latest`
   3. `gemini-2.0-flash-lite`
   4. `gemini-1.5-flash`
   5. `gemini-1.5-pro`
   6. `gemini-pro-vision`

3. **画像サイズ/形式**:
   極端に大きな画像や、対応していない形式の場合、Gemini APIがエラーを返すことがあります。

## 3. バックアップ・CSV関連エラー

### 症状

- ダウンロードしたCSVが文字化けする。
- リストア時にエラーになる。

### 対応

- **文字コード**: 本システムは **Shift_JIS** を標準としています。UTF-8のCSVをインポートしようとすると文字化けや解析エラーになります。
- **Excelでの確認**: インポート用ファイルはExcelで一度開いて保存しなおすと、フォーマットが整うことがあります。

## 4. 起動しない / 画面が表示されない

### 症状

- `npm run dev` しても `localhost:5173` に繋がらない。
- プロキシエラー (`ECONNREFUSED`) が出る。

### 対応

- **ポート競合**: ポート 3001 (Server) や 5173 (Client) が既に使用されていないか確認してください。
  - `lsof -i :3001` 等で確認し、プロセスをキルして再起動してください。
  - ポートを変更したい場合は `.env` ファイルで設定できます:
    - `server/.env` → `PORT=4000`
    - `client/.env` → `VITE_DEV_PORT=3000` / `VITE_API_PORT=4000`
    - ⚠️ `PORT` と `VITE_API_PORT` は同じ値にしてください。
- サーバー側 (`[0]`) がエラーでクラッシュして落ちている場合があります。ターミナルのログを確認し、エラーを取り除いてください。

## 5. リモート MCP 接続のエラー

外部 AI クライアント（Claude Code、Cursor など）から `/mcp` エンドポイントへ接続する際に発生するエラーの調査と対処方法です。

### 切り分けの順番

MCP 接続に失敗した場合は、以下の順番で原因を狭めていきます。

1. **サーバー自体の生存確認**:
   Express サーバーが起動し、ヘルスチェックが通るか確認します。
   ```bash
   curl -s http://localhost:3001/api/health
   # 期待される応答: {"status":"ok",...}
   ```
2. **ローカルからの MCP 疎通確認**:
   ローカルホスト上で正しいヘッダーを付与して `tools/list` が返るか確認します（`$MCP_AUTH_TOKEN` に設定したトークンを使用）。
   ```bash
   curl -s -X POST http://localhost:3001/mcp \
     -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
3. **トンネル・リバースプロキシ経由の疎通確認**:
   ngrok や Cloudflare Tunnel を使用している場合、公開 URL に対して同様の curl を実行します。
4. **クライアント側の設定確認**:
   上記 curl が成功する場合は、AI クライアント（`.mcp.json` や `claude.json`）の URL、トランスポート種別（`http`）、ヘッダー設定、環境変数の展開状況を確認します。

---

### 5.1 HTTP 503 (MCP is disabled)

- **症状**:
  クライアント接続時や curl 実行時にステータス `503 Service Unavailable` とボディ `{"error":"MCP is disabled"}` が返る。
- **原因**:
  - `server/.env` に `MCP_AUTH_TOKEN` が設定されていない。
  - トークンの長さが 16 文字未満である（安全のため 16 文字未満は無効化されます）。
  - `.env` ファイルの配置場所が `server/.env` ではなくプロジェクトルートなど別の場所になっている。
  - `.env` を編集した後にサーバーを再起動していない。
- **対応**:
  1. `server/.env` を開き、`MCP_AUTH_TOKEN` に 16 文字以上（推奨: 64 文字のランダム 16 進数文字列）を設定します。
  2. サーバープロセスを再起動します。

---

### 5.2 HTTP 401 (Unauthorized)

- **症状**:
  ステータス `401 Unauthorized` とボディ `{"error":"Unauthorized"}`、およびレスポンスヘッダー `WWW-Authenticate: Bearer realm="gravity-mcp"` が返る。
- **原因**:
  - `Authorization` リクエストヘッダーが欠落している、またはプレフィックス `Bearer `（末尾スペース含む）が抜けている。
  - 設定したトークン文字列とリクエスト内のトークンが一致していない。
  - トークンの前後に改行コードや余分なクォート（`"` や `'`）が含まれている。
  - AI クライアント設定（例: `.mcp.json`）で環境変数プレースホルダー（`${GRAVITY_MCP_TOKEN}` など）が適切に展開されていない。
  - クエリパラメータ認証（`?token=...`）を使用しているが、サーバー側で `MCP_ALLOW_QUERY_TOKEN=true` が有効化されていない。
- **対応**:
  1. サーバーログを確認します。トークン不一致の場合のみ `[MCP] auth failed <IP>` が出力されます（ヘッダー自体が未指定の場合はログは出力されません）。
  2. リクエストヘッダーが `Authorization: Bearer <TOKEN>` の形式になっているか確認します。
  3. AI クライアント側の環境変数設定（シェルの `export` や `.mcp.json`）を確認します。

---

### 5.3 HTTP 429 (Too Many Requests)

- **症状**:
  ステータス `429 Too Many Requests` が返り、リクエストが一時的にブロックされる。
- **原因**:
  2 種類のエラーメッセージ（原因）が存在します：
  1. `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Too many authentication failures"},"id":null}`:
     - 同一 IP アドレスから 15 分間に 10 回以上認証に失敗したため、一時的にロックされています。
  2. `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Too many requests"},"id":null}`:
     - 同一 IP アドレスからのリクエスト数が全体制限（1 分間に 120 回）を超過しました。
  - **トンネル環境の注意点**: ngrok や Cloudflare Tunnel 等のリバースプロキシを経由している場合、すべてのアクセス元がトンネルのローカルループバック IP（例: `127.0.0.1`）に見えるため、IP 単位のカウンタがクライアント間で共有されて制限に達しやすくなります。
- **対応**:
  - 認証失敗制限は 15 分、全体レート制限は 1 分待機すると自動解除されます。
  - レートリミットのカウンタはサーバープロセスのメモリ上に保持されているため、Express サーバーを再起動することで直ちにリセットされます。

---

### 5.4 HTTP 403 (Host not allowed)

- **症状**:
  ステータス `403 Forbidden` とボディ `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Host not allowed"},"id":null}` が返る。
- **原因**:
  リクエストの `Host` ヘッダーが、サーバーが許可しているホスト一覧に含まれていません（DNS Rebinding 攻撃対策）。
- **対応**:
  1. ngrok や Cloudflare Tunnel などの外部公開ホストを経由している場合、そのホスト名（例: `xxxx.ngrok-free.app`）を `server/.env` の `MCP_ALLOWED_HOSTS` にカンマ区切りで追加します。
     ```dotenv
     MCP_ALLOWED_HOSTS=localhost,127.0.0.1,xxxx.ngrok-free.app
     ```
  2. サーバーを再起動します。

---

### 5.5 HTTP 405 (Method Not Allowed)

- **症状**:
  ステータス `405 Method Not Allowed`、レスポンスヘッダー `Allow: POST`、およびボディ `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method Not Allowed"},"id":null}` が返る。
- **原因**:
  - Web ブラウザで直接 `http://localhost:3001/mcp` を開いた（GET リクエストが送信された）。
  - AI クライアント側で SSE（Server-Sent Events）方式のトランスポート（GET ベース）が指定されている。
- **対応**:
  - 本サーバーの MCP 実装は **Streamable HTTP (POST)** 専用です。
  - クライアントの設定でトランスポート方式に `http`（Streamable HTTP）を指定してください。

---

### 5.6 HTTP 413 (Payload Too Large)

- **症状**:
  ステータス `413 Payload Too Large` とボディ `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Payload Too Large"},"id":null}` が返る。
- **原因**:
  リクエストボディのサイズが 1MB の上限を超過しています。
- **対応**:
  - `create_transactions_batch` ツールなどで一度に大量の明細を送信している場合は、リクエストを 200 件程度以下のバッチに分割して送信してください。

---

### 5.7 HTTP 400 (Parse error)

- **症状**:
  ステータス `400 Bad Request` とボディ `{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}` が返る。
- **原因**:
  リクエストボディが有効な JSON 形式になっていません。
- **対応**:
  - curl やスクリプトで呼び出す際、JSON のエスケープ（特に Windows の PowerShell や cmd 環境での引用符の扱い）に誤りがないか確認してください。

---

### 5.8 HTTP 406 (Not Acceptable) / HTTP 415 (Unsupported Media Type)

- **症状**:
  - 406 の場合: ステータス `406 Not Acceptable` とボディ `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}` が返る。
  - 415 の場合: ステータス `415 Unsupported Media Type` とボディ `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}` が返る。
- **原因**:
  - 406: リクエストヘッダー `Accept` に `application/json` と `text/event-stream` の双方が含まれていない。
  - 415: リクエストヘッダー `Content-Type` が `application/json` でない。
- **対応**:
  - リクエスト送信時に次の 2 つのヘッダーを必ず明示してください。
    - `Content-Type: application/json`
    - `Accept: application/json, text/event-stream`

---

### 5.9 ツール実行時エラー (isError: true)

- **症状**:
  HTTP ステータスは `200 OK` だが、JSON-RPC レスポンスの `result.isError` が `true` になり、`result.content[0].text` にエラーメッセージが含まれる。
- **原因と対応**:
  ツール実行時のエラーは以下のカテゴリに分類されます。

| エラー種別               | 原因                                                                               | エラーメッセージの例                                                                                                                                                                                                                                                                                     | 対処方法                                                                                                                         |
| :----------------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **入力スキーマ違反**     | 必須パラメータの欠落、型不一致、フォーマット違反（日付・金額等）                   | `Input validation error: Invalid arguments for tool <名前>: ...`                                                                                                                                                                                                                                         | ツールの入力仕様（`docs/specifications.md` §7）を確認し、正しい形式で指定する                                                    |
| **固定費・給与保護**     | 更新系ツールで保護対象の費目コード（固定費 601〜608/901、給与 700）を指定した      | 登録時: `固定費・給与の登録は固定入力画面を使ってください`<br>更新・削除時: `固定費・給与の明細は更新できません（固定入力画面を使ってください）`<br>`固定費・給与のカテゴリへの変更はできません（固定入力画面を使ってください）`<br>`固定費・給与の明細は削除できません（固定入力画面を使ってください）` | 固定費・給与は Web UI（固定入力画面）から操作する                                                                                |
| **対象データ不在**       | 更新・削除・単件取得対象の取引 ID が存在しない                                     | 更新・削除時: `指定された取引IDが見つかりません: <id>`<br>単件取得時: `取引ID <id> の取引明細は見つかりませんでした。`                                                                                                                                                                                   | `get_transactions` 等で事前に存在する取引 ID を確認する                                                                          |
| **一括登録の検証エラー** | 配列内の 1 件でも検証に失敗した（バリデーション、上限件数 200 件超過、固定費保護） | `バッチ明細の検証エラー (2件):`<br>`[2行目] items[1].category_code: 固定費・給与の登録は固定入力画面を使ってください`                                                                                                                                                                                    | エラーメッセージに記載された行番号（`[n行目]`）の明細を修正する。**原子性が保証されているため、エラー時は 1 件も登録されません** |
| **dry_run 実行**         | `create_transactions_batch` で `dry_run: true` を指定した                          | （正常な検証完了レポート）                                                                                                                                                                                                                                                                               | エラーではありません。内容を確認後、`dry_run: false` で再実行して本登録を行います                                                |

---

## 開発時のデバッグ

- **フロントエンド**: ブラウザの DevTools > Network タブで、APIリクエストの Payload と Response を確認するのが最も早道です。
- **バックエンド**: `console.log` をコードに埋め込むと、ターミナルに出力されます。
