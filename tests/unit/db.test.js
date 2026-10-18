const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { spawnSync } = require('child_process')
const os = require('os')
const fs = require('fs')

test('db.js: DB_PATH 未設定時はデフォルトの server/household.db を開く', () => {
  const script = `
    const db = require('./server/db');
    db.get('PRAGMA database_list', (err, row) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log(JSON.stringify({ file: row.file }));
      db.close();
    });
  `
  const env = { ...process.env }
  delete env.DB_PATH

  const res = spawnSync('node', ['-e', script], {
    cwd: path.resolve(__dirname, '../..'),
    env,
    encoding: 'utf-8',
  })

  assert.equal(res.status, 0, `Script failed: ${res.stderr}`)
  const lines = res.stdout.trim().split('\n')
  const jsonLine = lines.find((l) => l.startsWith('{') && l.endsWith('}'))
  assert.ok(jsonLine, 'Should output JSON database_list')
  const data = JSON.parse(jsonLine)
  const expectedPath = path.resolve(__dirname, '../../server/household.db')
  assert.equal(fs.realpathSync(data.file), fs.realpathSync(expectedPath))
})

test('db.js: DB_PATH 設定時は指定されたパスを開く', () => {
  const tempDb = path.join(os.tmpdir(), `test-db-${Date.now()}.db`)
  const script = `
    const db = require('./server/db');
    db.get('PRAGMA database_list', (err, row) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log(JSON.stringify({ file: row.file }));
      db.close();
    });
  `
  const env = { ...process.env, DB_PATH: tempDb }

  try {
    const res = spawnSync('node', ['-e', script], {
      cwd: path.resolve(__dirname, '../..'),
      env,
      encoding: 'utf-8',
    })

    assert.equal(res.status, 0, `Script failed: ${res.stderr}`)
    const lines = res.stdout.trim().split('\n')
    const jsonLine = lines.find((l) => l.startsWith('{') && l.endsWith('}'))
    assert.ok(jsonLine, 'Should output JSON database_list')
    const data = JSON.parse(jsonLine)
    assert.equal(fs.realpathSync(data.file), fs.realpathSync(tempDb))
  } finally {
    try {
      if (fs.existsSync(tempDb)) fs.unlinkSync(tempDb)
      if (fs.existsSync(`${tempDb}-wal`)) fs.unlinkSync(`${tempDb}-wal`)
      if (fs.existsSync(`${tempDb}-shm`)) fs.unlinkSync(`${tempDb}-shm`)
    } catch {
      // ignore
    }
  }
})
