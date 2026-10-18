const defaultDb = require('../db')

function createDbAsync(db = defaultDb) {
  return {
    all: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err)
          else resolve(rows)
        })
      }),
    get: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
          if (err) reject(err)
          else resolve(row)
        })
      }),
    run: (sql, params = []) =>
      new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
          if (err) reject(err)
          else resolve({ lastID: this.lastID, changes: this.changes })
        })
      }),
    exec: (sql) =>
      new Promise((resolve, reject) => {
        db.exec(sql, (err) => {
          if (err) reject(err)
          else resolve()
        })
      }),
  }
}

const defaultAsync = createDbAsync(defaultDb)

module.exports = {
  ...defaultAsync,
  createDbAsync,
  dbAll: defaultAsync.all,
  dbGet: defaultAsync.get,
  dbRun: defaultAsync.run,
  dbExec: defaultAsync.exec,
}
