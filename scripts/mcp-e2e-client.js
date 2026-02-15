#!/usr/bin/env node

/**
 * MCPサーバーと直接通信してE2Eテストを実行
 * 
 * 注意: これは概念的な例です。実際のMCPクライアント実装が必要です。
 */

class MCPPlaywrightClient {
  constructor(mcpServerUrl = 'http://localhost:3000/mcp') {
    this.serverUrl = mcpServerUrl;
  }

  async sendCommand(tool, params) {
    // 実際のMCPプロトコルでサーバーと通信
    const response = await fetch(`${this.serverUrl}/tools/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    return response.json();
  }

  async navigate(url) {
    return this.sendCommand('mcp_playwright_browser_navigate', { url });
  }

  async click(element, ref) {
    return this.sendCommand('mcp_playwright_browser_click', { element, ref });
  }

  async type(element, ref, text) {
    return this.sendCommand('mcp_playwright_browser_type', { element, ref, text });
  }

  async selectOption(element, ref, values) {
    return this.sendCommand('mcp_playwright_browser_select_option', { element, ref, values });
  }

  async snapshot() {
    return this.sendCommand('mcp_playwright_browser_snapshot', {});
  }
}

class E2ETestSuite {
  constructor() {
    this.client = new MCPPlaywrightClient();
    this.tests = [];
  }

  addTest(name, testFn) {
    this.tests.push({ name, testFn });
  }

  async runAll() {
    console.log(`🚀 Running ${this.tests.length} E2E tests...\n`);
    
    const results = [];
    
    for (const test of this.tests) {
      try {
        console.log(`🧪 ${test.name}...`);
        await test.testFn(this.client);
        console.log(`✅ ${test.name} - PASSED`);
        results.push({ name: test.name, status: 'PASSED' });
      } catch (error) {
        console.log(`❌ ${test.name} - FAILED: ${error.message}`);
        results.push({ name: test.name, status: 'FAILED', error: error.message });
      }
    }
    
    this.printResults(results);
    return results;
  }

  printResults(results) {
    const passed = results.filter(r => r.status === 'PASSED').length;
    const failed = results.filter(r => r.status === 'FAILED').length;
    
    console.log('\n📊 Test Results:');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    
    if (failed > 0) {
      process.exit(1);
    }
  }
}

// テストケースの定義
async function setupTests() {
  const suite = new E2ETestSuite();

  suite.addTest('Transaction Form - Basic Input', async (client) => {
    await client.navigate('http://localhost:5173');
    
    // スナップショットを取得してフォームの存在を確認
    const snapshot = await client.snapshot();
    if (!snapshot.includes('新規入力')) {
      throw new Error('Transaction form not found');
    }
    
    // フォーム入力をシミュレート
    await client.selectOption('費目選択', 'category-select', ['100']);
    await client.type('金額入力', 'amount-input', '1500');
    await client.type('品名入力', 'description-input', 'MCPテスト商品');
    await client.click('登録ボタン', 'submit-button');
    
    // 結果確認
    const resultSnapshot = await client.snapshot();
    if (!resultSnapshot.includes('MCPテスト商品')) {
      throw new Error('Transaction was not created successfully');
    }
  });

  suite.addTest('Transaction Form - Validation', async (client) => {
    await client.navigate('http://localhost:5173');
    
    // 必須フィールドを空のまま送信
    await client.click('登録ボタン', 'submit-button');
    
    // バリデーションエラーが表示されることを確認
    const snapshot = await client.snapshot();
    // ブラウザの標準バリデーションまたはカスタムエラーメッセージを確認
  });

  return suite;
}

// メイン実行
async function main() {
  try {
    const suite = await setupTests();
    await suite.runAll();
  } catch (error) {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { MCPPlaywrightClient, E2ETestSuite };