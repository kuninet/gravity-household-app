# 家計簿アプリ E2Eテスト実行用Makefile

.PHONY: help install test-e2e test-e2e-headed test-e2e-debug clean

help: ## このヘルプを表示
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## 依存関係をインストール
	@echo "📦 Installing dependencies..."
	npm install
	npx playwright install

setup-servers: ## サーバーを起動
	@echo "🚀 Starting servers..."
	cd server && npm start &
	cd client && npm run dev &
	@echo "⏳ Waiting for servers to start..."
	sleep 5

test-e2e: ## E2Eテストを実行（ヘッドレス）
	@echo "🧪 Running E2E tests (headless)..."
	npm run test:e2e

test-e2e-headed: ## E2Eテストを実行（ブラウザ表示）
	@echo "🧪 Running E2E tests (headed)..."
	npm run test:e2e:headed

test-e2e-debug: ## E2Eテストをデバッグモードで実行
	@echo "🐛 Running E2E tests (debug mode)..."
	npm run test:e2e:debug

test-mcp: ## MCPクライアント経由でテスト実行
	@echo "🔧 Running tests via MCP client..."
	node scripts/mcp-e2e-client.js

clean: ## 一時ファイルを削除
	@echo "🧹 Cleaning up..."
	rm -rf playwright-report/
	rm -rf test-results/

ci: install test-e2e ## CI環境での実行

dev-test: setup-servers test-e2e-headed ## 開発環境でのテスト実行