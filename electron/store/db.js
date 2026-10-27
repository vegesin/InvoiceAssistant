'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

// 每次调用都释放 WASM statement；同步事务内不导出未提交状态。
async function createDb(filename) {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = fs.existsSync(filename) ? new SQL.Database(fs.readFileSync(filename)) : new SQL.Database();
  let dirty = false;
  let inTransaction = false;

  function persist() {
    if (!dirty || inTransaction) return;
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx');
      fs.writeFileSync(fd, Buffer.from(db.export()));
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, filename);
      dirty = false;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  function query(sql, params, mode) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
      if (mode === 'all') {
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      }
      if (mode === 'get') return stmt.step() ? stmt.getAsObject() : undefined;
      stmt.step();
      const changes = db.getRowsModified();
      const id = changes && /^\s*(insert|replace)\b/i.test(sql)
        ? db.exec('SELECT last_insert_rowid()')[0].values[0][0] : 0;
      if (changes) dirty = true;
      return { lastInsertRowid: id, changes };
    } finally { stmt.free(); }
  }

  return {
    exec(sql) { db.exec(sql); dirty = true; },
    prepare(sql) {
      return {
        run: (...params) => query(sql, params, 'run'),
        get: (...params) => query(sql, params, 'get'),
        all: (...params) => query(sql, params, 'all'),
      };
    },
    transaction(fn) {
      if (inTransaction) throw new Error('不支持嵌套事务');
      const wasDirty = dirty;
      db.exec('BEGIN IMMEDIATE');
      inTransaction = true;
      let result;
      try {
        result = fn();
        if (result && typeof result.then === 'function') throw new Error('数据库事务必须同步执行');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        dirty = wasDirty;
        throw error;
      } finally { inTransaction = false; }
      persist();
      return result;
    },
    persist,
    flush: persist,
    close() { persist(); db.close(); },
  };
}

module.exports = { createDb };
