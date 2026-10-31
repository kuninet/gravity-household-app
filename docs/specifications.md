# 機能仕様書

## 1. レシートOCR機能 (`ReceiptOCR.vue`)

Gemini API (AI) を使用して、レシート画像やPDFから品目と金額を自動抽出します。

### 仕様詳細

- **利用モデル**: `gemini-2.0-flash`, `gemini-flash-latest`, `gemini-2.0-flash-lite` を優先利用し、失敗時は `gemini-1.5-pro` 等へフォールバックします。
- **税区分設定**:
  - ユーザーは解析前に「税込」「税抜」を選択可能。
  - **税抜モード**の場合:
    - 食費カテゴリ (コード100-199): **税抜8%** として扱われ、合計計算時に `amount * 1.08` されます。
    - その他カテゴリ: **税抜10%** として扱われ、合計計算時に `amount * 1.10` されます。
    - これにより、内訳画面へ渡される合計額は常に**税込**となります。
- **ドラッグ＆ドロップ対応**: ファイル選択ボタンに加え、枠内へのドロップでもアップロード可能です。

## 2. レシート内訳計算 (`ReceiptSplitter.vue`)

レシートの「支払合計（税込）」から、個別の明細を差し引いて「残額（主に食費など）」を算出します。複数品目の登録を支援します。

### 計算ロジック

- **入力**: 支払合計 (A)
- **明細行**: 各行の金額 (b1, b2...) と税区分
  - 税区分が「税抜8%」なら `b * 1.08` (端数切り捨て)
  - 税区分が「税抜10%」なら `b * 1.10` (端数切り捨て)
- **残額**: `A - Σ(b_tax_included)`

### 自動入力機能

- カテゴリを選択した際、コードが 100番台（食費）なら自動的に「税抜8%」、それ以外なら「税抜10%」がデフォルトセットされます。

## 3. 毎月の固定入力（収入・支出） (`FixedCostManager.vue`)

年間の固定費（家賃、光熱費など）と固定収入（給与）をマトリクス形式で並べて表示・編集します。

### 扱うカテゴリ

- **支出 (`type=EXPENSE`)**: `category_code` が `601`〜`608`（電気・水道・ガス・家賃・電話などの固定費・公共料金）と `901`（小遣い）。
- **収入 (`type=INCOME`)**: `category_code=700`（給与）。現状は給与のみで、拡張時は `FixedCostManager.vue` と `server/routes/fixed_costs.js` の双方に定義されている `INCOME_FIXED_CODES` に対象コードを追加します（既知の二重管理箇所）。

### 給与セルの複数明細対応

- 給与（`type=INCOME` / `category_code=700`）は 1 会計月に**複数明細**を持てます。他の固定費セルとは異なり、マトリクス上のセルは合計値の表示のみを行い、直接編集はできません。
- 給与セルをクリックすると **給与明細モーダル (`SalaryDetailModal.vue`)** が開き、対象月の明細を追加・金額編集・摘要編集・削除できます。
- 既存明細の削除は保存時に不可逆となるため、確認ダイアログを挟みます。未保存の変更があるままモーダルを閉じようとした場合は破棄確認ダイアログを表示します。
- カテゴリ別合計・月別収入合計は、matrix 側の単一値と `salaryEntries` 側の複数明細の両方を合算して算出します。

### 保存レコードの仕様

- 支出は現行踏襲で、`description` は「固定費入力」。
- 収入（給与）は `description` を「給与(固定入力)」（未指定時）とし、`date` はその `fiscal_month` に必ず含まれる **前月 25 日** を格納します（例: `fiscal_month=2026-09` なら `date=2026-08-25`）。`getFiscalMonth(date)` と `fiscal_month` が整合する側の日付を採用しています。日付決定はサーバー側 `resolveInsertDate`（`server/services/fixedCostService.js`）に集約されています。

### API

- セル単体更新 `POST /api/fixed_costs/update_cell` と一括更新 `POST /api/fixed_costs/batch_update` は `type` 引数を受け取り、INCOME/EXPENSE を混在させて Upsert できます。`type` 省略時は `EXPENSE` として扱い、後方互換を保ちます。
- ただし `type=INCOME` かつ `category_code` が `INCOME_FIXED_CODES` に含まれる場合（現状は給与 = 700）は、`(fiscal_month, category_code, type)` の一意化前提と両立しないため **HTTP 400** で拒否します。給与の書き込みは以下の給与専用エンドポイントを利用してください。
- `POST /api/fixed_costs/salary`: 給与明細を 1 件追加。body は `{ year, month, amount, description? }`。`date` は `resolveInsertDate` により「前月 25 日」に固定されます。
- `PUT /api/fixed_costs/salary/:id`: 給与明細の `amount` と `description` を更新。`date` / `fiscal_month` は保持され、月の付け替えは削除＋追加で行う想定です。対象が給与行でなければ 404。
- `DELETE /api/fixed_costs/salary/:id`: 給与明細を削除。対象が給与行でなければ 404。
- `update_cell` と給与専用エンドポイントの書き込みロジックは `server/services/fixedCostService.js`（`setFixedCostCell` / `addSalaryItem` / `updateSalaryItem` / `deleteSalaryItem`）に集約され、リモート MCP の固定費・給与専用ツール（§7.5 の 5〜8）と共有しています。`update_cell` のセル upsert は直列化キュー＋専用接続＋`BEGIN IMMEDIATE` で実行され、同時実行でも同じセルに重複行を作りません。

### Excelペースト機能

- Excelからコピーしたデータを、画面上の任意のセルで `Ctrl+V` (Cmd+V) することで貼り付け可能です。
- クリップボードのTSVデータを解析し、セル位置を起点として右・下方向にデータを一括更新します (`/api/fixed_costs/batch_update`)。
- 貼り付け範囲は「収入」「支出」いずれかのセクション内に限定されます。**給与列（`category_code=700`）は v1 では skip** し、貼り付けの上書き対象外です。給与の一括入力はモーダルから明細を追加してください。

## 4. データ管理: エクスポート・バックアップ (`ExcelImport.vue`, `backup.js`)

データの保全と外部連携のための機能群です。

### フルバックアップ

- **形式**: CSV
- **文字コード**: Shift_JIS (Excelでの直接閲覧を考慮)
- **対象**: `transactions` テーブルの全データ
- **ダウンロード**: `/api/backup/export` より直接配信

### リストア (復元)

- アップロードされたCSV (Shift_JIS) を解析し、データベースを**全消去**した上でインサートします。
- 一貫性を保つため、トランザクション内で処理されます。

### データ全削除

- 「危険な操作」エリアから実行。
- 二重の確認ダイアログを経て、`transactions` テーブルを `TRUNCATE` (SQLiteでは `DELETE`) します。
- `sqlite_sequence` もリセットされ、IDは1から再番されます。

## 5. Excelインポート (テンプレート読込) (`import.js`)

特定のフォーマットのExcelファイルを取り込みます。

### 対応フォーマット

1. **日々の記録シート**: シート名 `yyyy年m月`
   - A列: 日付, B列: カテゴリコード, C列: 金額, E列: 品名, F列: 備考
2. **固定費シート (標準)**: シート名 `yyyy年公共料金等`
3. **固定費シート (代替)**: シート名 `yyyy合計`
   - G列: 家賃, H列: 電気, I+J列: ガス, K列: 水道...
   - 3行目がヘッダー、4行目からデータ開始

### 動作

- 指定された期間（年、または全期間）のデータについて、該当する `fiscal_month` の既存データを削除し、Excelの内容で上書きします（洗い替え方式）。

## 6. 品名キーワード価格推移分析 (`PriceTrendView.vue`, `price_trend.js`, `jevService.js`)

品名キーワード（例：「納豆」「牛乳」「卵」「ビール」など）で支出明細を横断抽出し、過去の購入価格の推移と物価変動を表とグラフで可視化・分析します。

### 仕様詳細

- **AI判定（TypeSafe AI「Jev」）**:
  - `TYPESAFE_API_KEY` が設定されている場合、TypeSafe AI の System One モデル「Jev」を用いて、取引明細の品名（`description`）が指定キーワードに該当するかを超高速・低コストに判定（`noul` による二値判定・確信度取得）します。
  - ユニーク品名単位でバッチ判定し、インメモリキャッシュ（`judgmentCache`）を活用して無駄な API 呼び出しとトークン消費を最小化します。
- **フォールバック**:
  - `TYPESAFE_API_KEY` 未設定時、または通常部分一致モード選択時、または API エラー時は、全角半角正規化・ひらがな/カタカナ相互変換を含む部分一致ロジックで安全に自動フォールバックします。
- **UI機能**:
  - **クイック検索**: 「納豆」「卵」「牛乳」「豆腐」「ビール」「弁当」「食パン」などのワンクリック検索。
  - **マッチ品名バリエーション調整（微調整チップ）**: 抽出されたユニーク品名一覧をタグ表示。不要な品名（例: 「納豆巻」など）をクリックで即座に除外/復元でき、グラフとサマリーが連動更新されます。
  - **統計サマリー**: 平均購入単価、最安値、最高値、直近購入価格、前回購入時との価格差。
  - **価格推移チャート**: Chart.js の折れ線グラフ（ダークモード対応）。平均価格の補助線や詳細ツールチップ（日付、価格、品名、店舗メモ）を表示。
  - **購入明細一覧**: 日付昇降順、金額昇降順でソート可能な一覧テーブル。

## 7. リモート MCP サーバー (`server/mcp/`)

外部の AI クライアント（Claude Code や Cursor 等）から家計簿データを直接・安全に操作するための MCP (Model Context Protocol) サーバーです。

### 7.1 概要

- **エンドポイント**: `POST /mcp`（Express ポート `3001` で待ち受け。Vite 開発プロキシは経由せず直接接続）
- **プロトコル方式**: Streamable HTTP（ステートレス。セッション ID なし、POST メソッドのみ、レスポンスは常に JSON 形式）
- **サーバーメタ情報**:
  - `name`: `gravity-household-app`
  - `version`: `1.0.0`
- **公開ツール**: 参照系 7 ツール、更新系 8 ツール（汎用 4 ツール＋固定費・給与の専用 4 ツール、計 15 ツール）

### 7.2 認証とアクセス制御

1. **認証モード（`MCP_AUTH_MODE`）**:
   - `server/.env` の `MCP_AUTH_MODE` で認証方式を切り替えます。値は前後の空白を除去し小文字化して判定し、`none` のときだけ認証なし、それ以外（未設定・空・`token`・不正値）はすべて `token`（Bearer トークン認証）として扱います（fail-closed 設計）。
   - `token`（既定）: 以降の 2・3 に示す Bearer トークン認証（および任意でクエリ認証）を行います。
   - `none`: 認証を行わず、`MCP_AUTH_TOKEN` の有無・`Authorization` ヘッダー・`?token` の内容にかかわらず **503 / 401 を返しません**。claude.ai のカスタムコネクタなど、ヘッダーを付与できないクライアント向けの明示オプトインです。
   - `none` でも Host ヘッダー検証（`MCP_ALLOWED_HOSTS`）・全体レート制限・405 応答・エラーハンドラは通常どおり有効です。認証なしで参照・更新ツールが実行できるため、外部公開時は Cloudflare Access / Tailscale 等で接続元を制限してください。起動時に警告ログ（`[MCP] 警告: MCP_AUTH_MODE=none のため …`）を出力します。また `MCP_AUTH_MODE` が `token` / `none` 以外の不正値のときは、`[MCP] 警告: MCP_AUTH_MODE の値が不正なため token モードとして扱います。` を出力します（値自体はログに出しません）。
   - 環境変数はリクエスト毎に参照します。
2. **Bearer トークン認証（`MCP_AUTH_MODE=token`）**:
   - `Authorization: Bearer <token>` ヘッダーによる認証（`Bearer` スキームは大文字小文字を区別しません）。
   - SHA-256 ダイジェストを計算し、`crypto.timingSafeEqual` による定数時間比較を行うことでタイミング攻撃を防止します。トークン文字列はログに出力されません。
   - `server/.env` の `MCP_AUTH_TOKEN` が未設定または 16 文字未満の場合、エンドポイントは完全に無効化され **HTTP 503** を返します（fail-closed 設計）。
3. **クエリパラメータ認証（オプトイン、`MCP_AUTH_MODE=token` 時）**:
   - `MCP_ALLOW_QUERY_TOKEN=true` が設定されている場合のみ、URL クエリ `?token=<token>` による認証を許可します。Authorization ヘッダーが同時に指定されている場合はヘッダーを優先します。URL にトークンが含まれるとログに残るリスクがあるため、通常は `false` を推奨します。
4. **Host ヘッダー検証**:
   - `server/.env` の `MCP_ALLOWED_HOSTS` にカンマ区切りで許可ホスト名（例: `localhost,gravity.example.com`）が設定されている場合、リクエストの Host ヘッダー（ポート番号有無無視、大文字小文字無視）を照合し、不一致時は **HTTP 403** で拒否します（DNS リバインディング攻撃対策）。未設定時は Host 検証を行いません。
5. **レート制限 (Rate Limiting)**:
   - **全体リクエスト制限**: 同一 IP から 1 分間に最大 120 リクエスト。超過時は **HTTP 429**。
   - **認証失敗レート制限**: 同一 IP から 15 分間に認証失敗（HTTP 401）が 10 回発生した場合、以降 15 分間は正しいトークンであっても **HTTP 429** で即時遮断します。
   - `MCP_AUTH_MODE=none` では 401 が発生しないため、認証失敗レート制限は作動しません（全体リクエスト制限は有効）。
   - ※ レート制限カウンタはインメモリ保持のため、サーバー再起動で即座にリセットされます。

### 7.3 共通仕様

#### レスポンス構造

MCP プロトコル仕様に準拠し、すべてのツール実行結果は以下の構造で返却されます。

- **成功時 (HTTP 200)**:
  ```json
  {
    "content": [
      {
        "type": "text",
        "text": "{\"...JSON文字列...\"}"
      }
    ],
    "structuredContent": { "...オブジェクト..." }
  }
  ```
- **ツールエラー時 (HTTP 200)**:
  ```json
  {
    "isError": true,
    "content": [
      {
        "type": "text",
        "text": "エラーメッセージ（日本語）"
      }
    ]
  }
  ```

#### 入力バリデーション規則

すべての入力引数は Zod スキーマにより検証されます。

- **日付 (`date`, `from`, `to`)**: `YYYY-MM-DD` 形式（月: 01〜12、日: 01〜31）。さらにカレンダー上の実在日チェック（2月30日やうるう年以外の2月29日などを拒否）を実施。
- **会計月 (`fiscal_month`)**: `YYYY-MM` 形式（01〜12月）。家計簿の締め日ルールに基づき、**毎月 23 日から翌月 22 日** が同一会計月となります（例: 2026-03-23 の支出は会計月 `2026-04`）。汎用の更新系ツール（`create_transaction` 等）では日付からサーバー側で自動計算されるため、リクエスト引数としては指定できません。固定費・給与の専用ツール（`set_fixed_cost_cell` / `add_salary_item`）は会計月を直接指定し、年は REST の固定入力 API と同じ 2000〜2999 年に限定されます（`2000-01` の給与日付は `1999-12-25`）。詳細は §7.5 の 5〜8 を参照してください。
- **収支区分 (`type`)**: `'EXPENSE'` (支出) または `'INCOME'` (収入)。
- **金額 (`amount`)**: 整数必須（小数不可）。`0` 円は指定不可。絶対値は最大 `10,000,000`（1,000万円）以内。
  - **固定費・給与の専用ツールの例外**: `set_fixed_cost_cell` は 0 以上（`0` はセル削除）、給与ツール（`add_salary_item` / `update_salary_item`）は 1 以上で、いずれも負数は指定できません（上限は同じ 1,000 万円）。
  - **負数の扱い**: 割引・値引き・クーポン等のマイナス金額は `type: 'EXPENSE'` のみ許可されます。`type: 'INCOME'` で負数を指定した場合はエラーとなります。
- **品名・内容 (`description`)**: 1〜200 文字の文字列。
- **メモ (`memo`)**: 最大 500 文字（任意）。

---

### 7.4 参照系ツール (7ツール)

すべての参照系ツールは `annotations: { readOnlyHint: true }` を持ちます。

#### 1. `get_categories`

家計簿の全費目（カテゴリ）一覧を取得します。固定費・給与の判定フラグ（`fixed: boolean`）が含まれます。

- **入力パラメータ**: なし
- **出力形式**:
  ```json
  {
    "categories": [
      {
        "code": 100,
        "name": "食費",
        "group_name": "食費",
        "fixed": false
      },
      {
        "code": 604,
        "name": "家賃",
        "group_name": "固定費",
        "fixed": true
      }
    ]
  }
  ```
- **エラー条件**: 内部 DB エラー時
- **呼び出し例**:
  ```json
  {}
  ```

#### 2. `get_transactions`

条件を指定して取引明細一覧を検索・取得します。

- **入力パラメータ**:
  | 引数名          | 型      | 必須 | 既定値 | 制約・説明                                  |
  | --------------- | ------- | ---- | ------ | ------------------------------------------- |
  | `fiscal_month`  | string  | 任意 | -      | 会計月 (`YYYY-MM`)                          |
  | `from`          | string  | 任意 | -      | 開始日 (`YYYY-MM-DD` 実在日)                |
  | `to`            | string  | 任意 | -      | 終了日 (`YYYY-MM-DD` 実在日)                |
  | `type`          | string  | 任意 | -      | `'EXPENSE'` または `'INCOME'`               |
  | `category_code` | integer | 任意 | -      | カテゴリコード                              |
  | `keyword`       | string  | 任意 | -      | 品名またはメモの部分一致検索 (最大100文字)  |
  | `include_fixed` | boolean | 任意 | `true` | 固定費・給与明細を含めるか (`false` で除外) |
  | `limit`         | integer | 任意 | `100`  | 取得件数上限 (1〜500)                       |
  | `offset`        | integer | 任意 | `0`    | オフセット件数 (0以上)                      |
- **出力形式**:
  ```json
  {
    "total": 150,
    "count": 2,
    "items": [
      {
        "id": 12,
        "date": "2026-03-20",
        "fiscal_month": "2026-03",
        "amount": 1200,
        "type": "EXPENSE",
        "category_code": 100,
        "category_name": "食費",
        "description": "スーパーマーケット",
        "memo": "夕食食材"
      }
    ]
  }
  ```
  ※ 並び順は `date DESC, id DESC`。
- **エラー条件**: `from > to` の不正期間指定、実在しない日付、不正な会計月書式、limit 範囲外。
- **呼び出し例**:
  ```json
  {
    "fiscal_month": "2026-04",
    "type": "EXPENSE",
    "limit": 50
  }
  ```

#### 3. `get_transaction`

指定された取引 ID の単一明細を取得します。

- **入力パラメータ**:
  | 引数名 | 型      | 必須 | 既定値 | 制約・説明        |
  | ------ | ------- | ---- | ------ | ----------------- |
  | `id`   | integer | 必須 | -      | 取引ID (正の整数) |
- **出力形式**: `get_transactions` の `items` の 1 件と同等（`category_name` 含む）。
- **エラー条件**: 存在しない取引 ID（`isError: true` となり、`取引ID <id> の取引明細は見つかりませんでした。` が返却されます）。
- **呼び出し例**:
  ```json
  {
    "id": 42
  }
  ```

#### 4. `get_summary`

指定会計月の収支サマリ、カテゴリ別内訳、前月比較データを取得します（Web 画面の月次集計ビューと同一ロジック）。

- **入力パラメータ**:
  | 引数名         | 型     | 必須 | 既定値     | 制約・説明         |
  | -------------- | ------ | ---- | ---------- | ------------------ |
  | `fiscal_month` | string | 任意 | 現在会計月 | 会計月 (`YYYY-MM`) |
- **出力形式**:
  ```json
  {
    "month": "2026-04",
    "prev_month": "2026-03",
    "by_category": [
      {
        "fiscal_month": "2026-04",
        "group_name": "食費",
        "total": 45000
      }
    ],
    "comparison": [
      {
        "group": "食費",
        "current": 45000,
        "prev": 42000,
        "diff": 3000
      }
    ],
    "total": {
      "income": 300000,
      "expense": 180000,
      "balance": 120000
    }
  }
  ```
- **エラー条件**: 不正な会計月書式。
- **呼び出し例**:
  ```json
  {
    "fiscal_month": "2026-04"
  }
  ```

#### 5. `get_fixed_costs`

指定年の固定費・固定収入マトリクス元データを取得します（Web 画面の固定入力ビューと同一ロジック）。

- **入力パラメータ**:
  | 引数名 | 型      | 必須 | 既定値 | 制約・説明          |
  | ------ | ------- | ---- | ------ | ------------------- |
  | `year` | integer | 任意 | 現在年 | 対象年 (2000〜2999) |
- **出力形式**:
  ```json
  {
    "data": [
      {
        "id": 5,
        "fiscal_month": "2026-01",
        "category_code": 604,
        "amount": 80000,
        "description": "固定費入力",
        "type": "EXPENSE"
      }
    ]
  }
  ```
- **エラー条件**: 2000 未満または 2999 を超える年指定。
- **呼び出し例**:
  ```json
  {
    "year": 2026
  }
  ```

#### 6. `get_price_trends`

品名キーワードによる過去の購入価格推移と統計分析サマリを取得します（Web 画面の物価分析ビューと同一ロジック）。

- **入力パラメータ**:
  | 引数名           | 型           | 必須 | 既定値  | 制約・説明                                             |
  | ---------------- | ------------ | ---- | ------- | ------------------------------------------------------ |
  | `keyword`        | string       | 必須 | -       | 検索キーワード (1〜100文字)                            |
  | `mode`           | string       | 任意 | `'jev'` | `'jev'` (AI スマート抽出) または `'simple'` (部分一致) |
  | `from`           | string       | 任意 | -       | 開始日 (`YYYY-MM-DD` 実在日)                           |
  | `to`             | string       | 任意 | -       | 終了日 (`YYYY-MM-DD` 実在日)                           |
  | `selected_items` | array/string | 任意 | -       | 抽出対象品名のホワイトリスト絞り込み                   |
- **出力形式**:
  ```json
  {
    "keyword": "牛乳",
    "jev_configured": true,
    "mode_used": "jev",
    "summary": {
      "count": 15,
      "average_price": 218,
      "min_price": 198,
      "max_price": 248,
      "latest_price": 228,
      "latest_date": "2026-04-10",
      "price_diff": 10
    },
    "matched_items": [
      {
        "name": "成分無調整牛乳 1000ml",
        "count": 10,
        "confidence": 0.95,
        "source": "jev"
      }
    ],
    "data": [
      {
        "id": 101,
        "date": "2026-04-10",
        "fiscal_month": "2026-04",
        "amount": 228,
        "description": "成分無調整牛乳 1000ml",
        "memo": "スーパー",
        "category_code": 100,
        "category_name": "食費"
      }
    ]
  }
  ```
- **エラー条件**: 空のキーワード、100文字超、不正な日付形式。
- **注意**: `mode: 'jev'` の利用には `server/.env` に `TYPESAFE_API_KEY` の設定が必要です（未設定時は自動的に `fallback` として通常部分一致が適用されます）。
- **呼び出し例**:
  ```json
  {
    "keyword": "納豆",
    "mode": "jev"
  }
  ```

#### 7. `get_fiscal_month`

指定された日付から、家計簿の23日締めルールに基づく会計月と期間範囲を算出する純関数ツールです。

- **入力パラメータ**:
  | 引数名 | 型     | 必須 | 既定値 | 制約・説明                   |
  | ------ | ------ | ---- | ------ | ---------------------------- |
  | `date` | string | 必須 | -      | 対象日 (`YYYY-MM-DD` 実在日) |
- **出力形式**:
  ```json
  {
    "date": "2026-03-23",
    "fiscal_month": "2026-04",
    "range": {
      "start": "2026-03-23",
      "end": "2026-04-22"
    }
  }
  ```
- **エラー条件**: 不正な日付形式、実在しない日付。
- **呼び出し例**:
  ```json
  {
    "date": "2026-03-23"
  }
  ```

---

### 7.5 更新系ツール (8ツール)

更新系ツールはデータベースの取引明細レコードを作成・更新・削除します。1〜4 は通常の取引明細を扱う汎用ツールで、固定費・給与の書き込みは拒否します（§7.6）。5〜8 は固定費・給与の専用ツールで、固定入力画面（[3. 毎月の固定入力](#3-毎月の固定入力収入支出-fixedcostmanagervue)）と同じ前提で書き込み、REST の `/api/fixed_costs` と同じサービス層（`server/services/fixedCostService.js`）を使います。

#### 1. `create_transaction`

家計簿に新しい取引明細を 1 件登録します。

- **アノテーション**: `destructiveHint: false`
- **入力パラメータ**:
  | 引数名          | 型      | 必須 | 既定値 | 制約・説明                                   |
  | --------------- | ------- | ---- | ------ | -------------------------------------------- |
  | `date`          | string  | 必須 | -      | 取引日 (`YYYY-MM-DD` 実在日)                 |
  | `amount`        | integer | 必須 | -      | 金額 (0円不可、1000万円以内、負数は支出のみ) |
  | `type`          | string  | 必須 | -      | `'EXPENSE'` または `'INCOME'`                |
  | `category_code` | integer | 必須 | -      | カテゴリコード (正の整数)                    |
  | `description`   | string  | 必須 | -      | 品名・内容 (1〜200文字)                      |
  | `memo`          | string  | 任意 | -      | メモ・店舗名等 (最大500文字)                 |
- **出力形式**: 作成された明細（`id`, `fiscal_month`, `category_name` を含む）。
- **エラー条件**:
  - 固定費・給与コードの指定（§7.6 参照）
  - 収入区分での負数指定
  - 存在しない費目コード
  - 実在しない日付、金額0円
- **呼び出し例**:
  ```json
  {
    "date": "2026-04-15",
    "amount": 2980,
    "type": "EXPENSE",
    "category_code": 100,
    "description": "夕食食材まとめ買い",
    "memo": "スーパーライフ"
  }
  ```

#### 2. `create_transactions_batch`

レシートの複数明細を一括でアトミックに登録します（最大 200 件）。

- **アノテーション**: `destructiveHint: false`
- **入力パラメータ**:
  | 引数名    | 型      | 必須 | 既定値  | 制約・説明                                                      |
  | --------- | ------- | ---- | ------- | --------------------------------------------------------------- |
  | `date`    | string  | 任意 | -       | 全体取引日（各明細の `date` 未指定時に適用）                    |
  | `store`   | string  | 任意 | -       | 全体店舗名（各明細の `memo` 未指定時に適用、最大200文字）       |
  | `items`   | array   | 必須 | -       | 取引明細リスト（1〜200件）                                      |
  | `dry_run` | boolean | 任意 | `false` | ドライランフラグ（`true` の場合 DB に保存せず計算結果のみ返却） |
- **明細アイテム (`items[]`) のパラメータ**:
  | 引数名          | 型      | 必須 | 既定値       | 制約・説明                               |
  | --------------- | ------- | ---- | ------------ | ---------------------------------------- |
  | `date`          | string  | 任意 | 全体 `date`  | 取引日 (`YYYY-MM-DD` 実在日)             |
  | `amount`        | integer | 必須 | -            | 金額 (0円不可、1000万円以内、割引は負数) |
  | `type`          | string  | 任意 | `'EXPENSE'`  | `'EXPENSE'` または `'INCOME'`            |
  | `category_code` | integer | 必須 | -            | カテゴリコード                           |
  | `description`   | string  | 必須 | -            | 品名・内容 (1〜200文字)                  |
  | `memo`          | string  | 任意 | 全体 `store` | メモ (最大500文字)                       |
- **推奨実行フロー (Dry Run)**:
  1. まず `dry_run: true` を指定して呼び出し、事前計算された `count`、`total_amount`、`fiscal_months`、各明細の展開結果を確認します。
  2. 検証結果に問題がなければ、同一データで `dry_run: false`（省略可）を指定して本登録を実行します。
- **原子性保証 (All or Nothing)**:
  - 全明細を事前に検証し、1 行でもエラー（不正日付、存在しない費目、固定費コード等）がある場合は 1 件も登録せず、行番号付きのエラー一覧（例: `[2行目] items[1].category_code: ...`）を返却します。
  - DB 登録時は専用の独立 SQLite 接続で `BEGIN IMMEDIATE` を発行し、全件の INSERT が成功した時のみ `COMMIT` します。途中で障害が発生した場合は即座に `ROLLBACK` され、部分コミットは発生しません。
- **出力形式**:
  ```json
  {
    "count": 2,
    "total_amount": 750,
    "fiscal_months": ["2026-04"],
    "items": [
      {
        "id": 105,
        "date": "2026-04-15",
        "fiscal_month": "2026-04",
        "amount": 500,
        "type": "EXPENSE",
        "category_code": 100,
        "category_name": "食費",
        "description": "牛乳とパン",
        "memo": "スーパーライフ"
      },
      {
        "id": 106,
        "date": "2026-04-15",
        "fiscal_month": "2026-04",
        "amount": 250,
        "type": "EXPENSE",
        "category_code": 200,
        "category_name": "日用品・雑費",
        "description": "スポンジ",
        "memo": "スーパーライフ"
      }
    ]
  }
  ```
- **呼び出し例**:
  ```json
  {
    "date": "2026-04-15",
    "store": "スーパーライフ",
    "dry_run": false,
    "items": [
      { "amount": 500, "category_code": 100, "description": "牛乳とパン" },
      { "amount": 250, "category_code": 200, "description": "スポンジ" }
    ]
  }
  ```

#### 3. `update_transaction`

指定された取引 ID の明細内容を部分更新します。

- **アノテーション**: `destructiveHint: true, idempotentHint: true`
- **入力パラメータ**:
  | 引数名          | 型      | 必須 | 既定値 | 制約・説明                    |
  | --------------- | ------- | ---- | ------ | ----------------------------- |
  | `id`            | integer | 必須 | -      | 更新対象の取引ID (正の整数)   |
  | `date`          | string  | 任意 | -      | 取引日 (`YYYY-MM-DD` 実在日)  |
  | `amount`        | integer | 任意 | -      | 金額 (0円不可、1000万円以内)  |
  | `type`          | string  | 任意 | -      | `'EXPENSE'` または `'INCOME'` |
  | `category_code` | integer | 任意 | -      | カテゴリコード                |
  | `description`   | string  | 任意 | -      | 品名・内容 (1〜200文字)       |
  | `memo`          | string  | 任意 | -      | メモ・店舗名等 (最大500文字)  |
- **更新規則**:
  - `id` 以外の更新フィールドが 1 つも指定されていない場合はエラーになります。
  - `date` を変更した場合、23日締めルールに従い `fiscal_month` が自動再計算されます。
- **出力形式**:
  ```json
  {
    "before": { "...更新前の取引データ..." },
    "after": { "...更新後の取引データ..." }
  }
  ```
- **エラー条件**:
  - 存在しない取引 ID
  - 固定費・給与明細の更新試行、または固定費カテゴリへの変更試行（§7.6 参照）
  - 更新項目の未指定（`更新項目が指定されていません`）
- **呼び出し例**:
  ```json
  {
    "id": 105,
    "amount": 520,
    "memo": "特売シール付き"
  }
  ```

#### 4. `delete_transaction`

指定された取引 ID の明細を削除します。誤削除防止のため確認フラグが必須です。

- **アノテーション**: `destructiveHint: true`
- **入力パラメータ**:
  | 引数名    | 型      | 必須 | 既定値 | 制約・説明                               |
  | --------- | ------- | ---- | ------ | ---------------------------------------- |
  | `id`      | integer | 必須 | -      | 削除対象の取引ID (正の整数)              |
  | `confirm` | boolean | 必須 | -      | 削除確認フラグ。リテラル `true` のみ許可 |
- **出力形式**:
  ```json
  {
    "deleted_transaction": { "...削除された取引データ..." }
  }
  ```
- **エラー条件**:
  - `confirm: true` が指定されていない場合
  - 存在しない取引 ID
  - 固定費・給与明細の削除試行（§7.6 参照）
- **呼び出し例**:
  ```json
  {
    "id": 105,
    "confirm": true
  }
  ```

#### 5. `set_fixed_cost_cell`

固定入力画面の固定費（支出）セル 1 つの金額を設定します。固定費は `(fiscal_month, category_code, type=EXPENSE)` ごとに 1 明細として管理され、既存行があれば更新、なければ作成し、金額 `0` でセルを削除します。現在値は `get_fixed_costs` で確認できます。

- **アノテーション**: `destructiveHint: true, idempotentHint: true`
- **入力パラメータ**:
  | 引数名          | 型      | 必須 | 既定値 | 制約・説明                                            |
  | --------------- | ------- | ---- | ------ | ----------------------------------------------------- |
  | `fiscal_month`  | string  | 必須 | -      | 会計月 (`YYYY-MM`、2000〜2999 年)                     |
  | `category_code` | integer | 必須 | -      | 固定費の費目コード（`601`〜`608`, `901`）             |
  | `amount`        | integer | 必須 | -      | 金額（0 以上の整数、1,000万円以内）。`0` はセルの削除 |
- **保存規則**:
  - 収支区分は常に `EXPENSE` で、引数では指定しません。
  - 作成・更新時の `date` は会計月の 1 日（`YYYY-MM-01`）、`description` は `固定費入力` に設定します（固定入力画面と同じ）。
  - 対象セルの読み取りから書き込みまでを直列化キュー＋専用接続＋`BEGIN IMMEDIATE` で実行するため、同じセルへ同時に呼び出しても重複行はできません。
  - 対象セルに既存行が複数ある場合（Excel インポート由来など）は更新せずエラーにします。固定入力画面で整理してから再実行してください。
- **出力形式**:
  ```json
  {
    "status": "updated",
    "fiscal_month": "2026-04",
    "category_code": 604,
    "amount": 85000,
    "previous_amount": 80000,
    "id": 120,
    "transaction": {
      "id": 120,
      "date": "2026-04-01",
      "fiscal_month": "2026-04",
      "amount": 85000,
      "type": "EXPENSE",
      "category_code": 604,
      "category_name": "家賃",
      "description": "固定費入力",
      "memo": null
    }
  }
  ```
  - `status`: `created`（新規作成）/ `updated`（既存行を更新）/ `deleted`（金額 0 で削除）/ `ignored`（金額 0 で対象行なし）
  - `previous_amount`: 変更前の金額（対象行がなかった場合は `null`）
  - `id`: 作成・更新・削除した明細の ID（`ignored` のときは含まれません）
  - `transaction`: 作成・更新後の明細（`deleted` / `ignored` のときは含まれません）
- **エラー条件**:
  - 給与コード `700` の指定（`給与は add_salary_item / update_salary_item / delete_salary_item を使ってください`）
  - 固定費コード以外の指定（`固定費コードではありません（601〜608, 901）。通常の明細は create_transaction を使ってください: <code>`）
  - 費目がカテゴリマスタに存在しない（`存在しない費目コードです: <code>`）
  - 対象セルに既存行が複数ある（`同じ会計月・費目の固定費明細が複数あります（ID: <id>, <id>）。固定入力画面で整理してください`）
  - 負数・小数・上限超過の金額、不正な会計月形式、2000〜2999 年以外の会計月（入力スキーマ違反）
- **呼び出し例**:
  ```json
  {
    "fiscal_month": "2026-04",
    "category_code": 604,
    "amount": 85000
  }
  ```

#### 6. `add_salary_item`

給与（`type=INCOME` / `category_code=700`）の明細を 1 件追加します。同じ会計月に複数の明細を登録できます。

- **アノテーション**: `destructiveHint: false`
- **入力パラメータ**:
  | 引数名         | 型      | 必須 | 既定値           | 制約・説明                          |
  | -------------- | ------- | ---- | ---------------- | ----------------------------------- |
  | `fiscal_month` | string  | 必須 | -                | 会計月 (`YYYY-MM`、2000〜2999 年)   |
  | `amount`       | integer | 必須 | -                | 金額（1 以上の整数、1,000万円以内） |
  | `description`  | string  | 任意 | `給与(固定入力)` | 摘要（1〜200文字）                  |
- **保存規則**: `date` は対象会計月の前月 25 日（例: `2026-05` → `2026-04-25`、`2027-01` → `2026-12-25`）に自動設定します。25 日は会計月の切替（23 日）より後なので、`date` から算出される会計月は指定した `fiscal_month` と一致します。
- **出力形式**: 作成された明細（`id`, `date`, `fiscal_month`, `amount`, `type`, `category_code`, `category_name`, `description`, `memo`）。
- **エラー条件**: 0 以下・小数・上限超過の金額、空文字または 201 文字以上の摘要、不正な会計月形式、2000〜2999 年以外の会計月（入力スキーマ違反）。
- **呼び出し例**:
  ```json
  {
    "fiscal_month": "2026-05",
    "amount": 300000,
    "description": "本給"
  }
  ```

#### 7. `update_salary_item`

指定された ID の給与明細の金額・摘要を部分更新します。

- **アノテーション**: `destructiveHint: true, idempotentHint: true`
- **入力パラメータ**:
  | 引数名        | 型      | 必須 | 既定値 | 制約・説明                          |
  | ------------- | ------- | ---- | ------ | ----------------------------------- |
  | `id`          | integer | 必須 | -      | 更新対象の給与明細 ID（正の整数）   |
  | `amount`      | integer | 任意 | -      | 金額（1 以上の整数、1,000万円以内） |
  | `description` | string  | 任意 | -      | 摘要（1〜200文字）                  |
- **更新規則**:
  - `amount` と `description` の少なくとも一方が必要です。指定しなかった項目は既存値のまま保持します（REST の `PUT /api/fixed_costs/salary/:id` は `amount` 必須で、摘要の省略時は既定値で上書きします）。
  - 会計月・日付は変更できません。月を付け替える場合は `delete_salary_item` で削除してから `add_salary_item` で追加し直します。
- **出力形式**: 更新後の明細（`add_salary_item` と同じ形）。
- **エラー条件**:
  - 更新項目の未指定（`更新項目が指定されていません（amount または description を指定してください）`）
  - 存在しない ID、または給与以外の明細の ID（`指定された給与明細が見つかりません: <id>`）
- **呼び出し例**:
  ```json
  {
    "id": 130,
    "amount": 310000
  }
  ```

#### 8. `delete_salary_item`

指定された ID の給与明細を削除します。誤削除防止のため確認フラグが必須です。

- **アノテーション**: `destructiveHint: true`
- **入力パラメータ**:
  | 引数名    | 型      | 必須 | 既定値 | 制約・説明                               |
  | --------- | ------- | ---- | ------ | ---------------------------------------- |
  | `id`      | integer | 必須 | -      | 削除対象の給与明細 ID（正の整数）        |
  | `confirm` | boolean | 必須 | -      | 削除確認フラグ。リテラル `true` のみ許可 |
- **出力形式**:
  ```json
  {
    "deleted_transaction": { "...削除された給与明細..." }
  }
  ```
- **エラー条件**:
  - `confirm: true` が指定されていない場合
  - 存在しない ID、または給与以外の明細の ID（`指定された給与明細が見つかりません: <id>`）
- **呼び出し例**:
  ```json
  {
    "id": 130,
    "confirm": true
  }
  ```

---

### 7.6 固定費・給与の保護ルール

家計簿アプリ Gravity では、毎月の固定費（公共料金や家賃）および固定収入（給与）をマトリクス画面（[3. 毎月の固定入力](#3-毎月の固定入力収入支出-fixedcostmanagervue)）で一括管理しています。マトリクスは「固定費は会計月・費目ごとに 1 明細」「給与は 1 会計月に複数明細、日付は前月 25 日」という前提で動くため、汎用の更新系ツール（`create_transaction` / `create_transactions_batch` / `update_transaction` / `delete_transaction`）では固定費・給与の書き込みを拒否し、エラーメッセージで専用ツール（固定費: `set_fixed_cost_cell`、給与: `add_salary_item` / `update_salary_item` / `delete_salary_item`）へ誘導します。専用ツールはこの前提を守って書き込みます（§7.5 の 5〜8）。

#### 対象費目コード

- **支出固定費 (`type=EXPENSE`)**: `601`（電気）、`602`（水道）、`603`（ガス一般）、`604`（家賃）、`605`（固定電話・フレッツ）、`606`（食洗機）、`607`（携帯電話）、`608`（保険）、`901`（小遣い）
- **固定収入 (`type=INCOME`)**: `700`（給与）
- ※ コード判定は `server/lib/fixedCostCodes.js` の `isFixedCost(code, type)` を正典として適用します。

> **費目コード定義の同期について**:
> 給与コード（`700`）は、画面コンポーネント（`FixedCostManager.vue`）、REST API（`server/routes/fixed_costs.js`）、MCP サーバー（`server/lib/fixedCostCodes.js`）の 3 箇所で定義・参照されています。費目を追加・変更する場合は、これらすべての定義元を整合させてください。

#### ガード動作と返却メッセージ一覧

汎用ツールのエラーメッセージは、いずれも末尾に専用ツールの案内（`固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）`）を含みます。

| 操作                                   | 条件                                 | 返却エラーメッセージ                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 単件登録 (`create_transaction`)        | 固定費または給与コードを指定         | `固定費・給与の登録はできません。固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）`                                 |
| 一括登録 (`create_transactions_batch`) | 明細内に固定費または給与コードを含む | `[N行目] items[i].category_code: 固定費・給与の登録はできません。固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）` |
| 明細更新 (`update_transaction`)        | 既存レコードが固定費または給与明細   | `固定費・給与の明細は更新できません。固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）`                             |
| 明細更新 (`update_transaction`)        | 通常明細を固定費・給与コードへ変更   | `固定費・給与のカテゴリへの変更はできません。固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）`                     |
| 明細削除 (`delete_transaction`)        | 既存レコードが固定費または給与明細   | `固定費・給与の明細は削除できません。固定費・給与は専用ツールを使ってください（固定費: set_fixed_cost_cell、給与: add_salary_item / update_salary_item / delete_salary_item）`                             |

※ なお、参照系ツール（`get_transactions` 等）での固定費データの閲覧は許可されています（`include_fixed: false` を指定すれば除外可能です）。

---

### 7.7 エラーレスポンス仕様

#### 1. HTTP / トランスポート層エラー

MCP ツールが実行される前のリクエスト検証・トランスポート段階で返却される HTTP エラーです。

| HTTP ステータス                | レスポンスボディ                                                                                                                                 | 発生条件                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **503 Service Unavailable**    | `{"error":"MCP is disabled"}`                                                                                                                    | `MCP_AUTH_MODE=token` 時に `MCP_AUTH_TOKEN` が未設定、または16文字未満       |
| **401 Unauthorized**           | `{"error":"Unauthorized"}`（`WWW-Authenticate: Bearer realm="gravity-mcp"` ヘッダー付与）                                                        | `MCP_AUTH_MODE=token` 時にトークン未指定、または不一致                       |
| **403 Forbidden**              | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Host not allowed"},"id":null}`                                                               | `MCP_ALLOWED_HOSTS` の不一致                                                 |
| **429 Too Many Requests**      | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Too many requests"},"id":null}`                                                              | 全体レート制限（120 req/分）超過                                             |
| **429 Too Many Requests**      | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Too many authentication failures"},"id":null}`                                               | 認証失敗レート制限（15分間に10回失敗）超過                                   |
| **405 Method Not Allowed**     | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method Not Allowed"},"id":null}`（`Allow: POST` ヘッダー付与）                               | GET, DELETE など POST 以外のメソッドでのアクセス                             |
| **413 Payload Too Large**      | `{"jsonrpc":"2.0","error":{"code":-32600,"message":"Payload Too Large"},"id":null}`                                                              | リクエストボディが 1MB を超過                                                |
| **400 Bad Request**            | `{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}`                                                                    | JSON 構文エラー                                                              |
| **406 Not Acceptable**         | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Not Acceptable: Client must accept both application/json and text/event-stream"},"id":null}` | Accept ヘッダーに `application/json` と `text/event-stream` が含まれていない |
| **415 Unsupported Media Type** | `{"jsonrpc":"2.0","error":{"code":-32000,"message":"Unsupported Media Type: Content-Type must be application/json"},"id":null}`                  | Content-Type が `application/json` でない                                    |
| **500 Internal Server Error**  | `{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error"},"id":null}`                                                                 | 予期せぬサーバー内部例外                                                     |

> **注意**: HTTP 503 と HTTP 401 は Express ルーター直下で返却されるため、JSON-RPC 形式ではなく標準 JSON オブジェクト `{"error":"..."}` となります。

#### 2. ツール実行時エラー文言一覧 (isError: true)

HTTP 200 レスポンス内の `result.isError: true` と共に返却される業務エラーメッセージの一覧です。

- `存在しない費目コードです: <code>`（単件登録・更新時）
- `[N行目] items[i].category_code: 存在しない費目コードです (<code>)`（一括登録時）
- `取引ID <id> の取引明細は見つかりませんでした。`（単件取得 `get_transaction` で対象不在時）
- `指定された取引IDが見つかりません: <id>`（明細更新 `update_transaction` または削除 `delete_transaction` で対象不在時）
- `更新項目が指定されていません`（`update_transaction` で更新フィールド未指定時）
- `削除を実行するには confirm: true を指定してください`（`delete_transaction` / `delete_salary_item` で確認未指定時）
- `給与は add_salary_item / update_salary_item / delete_salary_item を使ってください`（`set_fixed_cost_cell` で給与コード 700 指定時）
- `固定費コードではありません（601〜608, 901）。通常の明細は create_transaction を使ってください: <code>`（`set_fixed_cost_cell` で固定費以外のコード指定時）
- `同じ会計月・費目の固定費明細が複数あります（ID: <id>, <id>）。固定入力画面で整理してください`（`set_fixed_cost_cell` で対象セルに既存行が複数ある場合）
- `指定された給与明細が見つかりません: <id>`（`update_salary_item` / `delete_salary_item` で対象不在、または給与以外の明細を指定した場合）
- `更新項目が指定されていません（amount または description を指定してください）`（`update_salary_item` で更新項目未指定時）
- `収入に負の金額は指定できません（割引は支出のみ対応しています）`（収入でのマイナス金額指定時）
- `金額に0は指定できません`（0円指定時）
- `金額は絶対値1,000万円以内で指定してください`（上限超過時）
- `Input validation error: Invalid arguments for tool <名前>: ... 実在する有効な日付を指定してください`（入力スキーマでの実在しない日付や形式不正時）
- `[N行目] items[i].date: 有効な日付（YYYY-MM-DD）が指定されていません`（一括登録での日付不正時）
- `明細リスト（items）は1件以上指定してください` / `一度に登録できる明細は最大200件です`（一括登録件数制約）
