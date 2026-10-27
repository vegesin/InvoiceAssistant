const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture } = require('./helpers.cjs');
const { createDb } = require('../electron/store/db');
const { contentHash, saveContentFile } = require('../electron/services/files');
const { createScreenshotIngestor } = require('../electron/services/watcher');

test('相同发票内容不同文件名不重复入库，重启后去重仍有效', async t => {
  const { store, directory, databasePath } = await fixture(t);
  const first = path.join(directory, 'a.pdf');
  const second = path.join(directory, 'b.pdf');
  fs.writeFileSync(first, 'synthetic-invoice'); fs.copyFileSync(first, second);
  const id = store.addInvoice({ file_path: first, amount: 285 });
  assert.equal(store.addInvoice({ file_path: second, amount: 285 }), id);
  store.db.close(); store.db = null;
  store.db = await createDb(databasePath);
  assert.equal(store.addInvoice({ file_path: second }), id);
  assert.equal(store.listInvoices().length, 1);
});
test('事务失败回滚数据，持久化不暴露中间结果且无残留临时文件', async t => {
  const { store, directory, databasePath } = await fixture(t);
  const before = fs.readFileSync(databasePath);
  const beforeFiles = fs.readdirSync(path.dirname(databasePath));
  assert.throws(() => store.db.transaction(() => {
    store.addInvoice({ file_path: 'synthetic.pdf', amount: 10 });
    assert.deepEqual(fs.readFileSync(databasePath), before);
    throw new Error('synthetic failure');
  }), /synthetic failure/);
  assert.equal(store.listInvoices().length, 0);
  assert.deepEqual(fs.readFileSync(databasePath), before);
  assert.deepEqual(fs.readdirSync(path.dirname(databasePath)), beforeFiles);
});
test('迁移保留历史重复记录、状态和 ID，同时为未来导入建立去重指纹', async t => {
  const { store, directory } = await fixture(t);
  const file = path.join(directory, 'legacy.pdf'); fs.writeFileSync(file, 'legacy');
  store.db.prepare('INSERT INTO invoices (file_path, status) VALUES (?, ?)').run(file, 'archived');
  store.db.prepare('INSERT INTO invoices (file_path, status) VALUES (?, ?)').run(file, 'new');
  store.db.transaction(() => store._migrate());
  assert.equal(store.listInvoices().length, 2);
  assert.equal(store.listInvoices().find(r=>r.id===1).status, 'archived');
  assert.equal(store.addInvoice({ file_path: file }), 1);
  assert.equal(store.findInvoiceByHash(contentHash(Buffer.from('legacy'))).id, 1);
});
test('截图并发重复导入只识别和保存一次，文件名不相同时也去重', async t => {
  const { store, directory } = await fixture(t);
  const first = path.join(directory, '支付.png'); const second = path.join(directory, '副本.png');
  fs.writeFileSync(first, 'synthetic-image'); fs.copyFileSync(first, second);
  let calls = 0;
  const ingestor = createScreenshotIngestor(store, { recognizeAmount: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return { amount: 10 }; } }, {}, path.join(directory, 'inbox'));
  const results = await Promise.all([ingestor.ingest(first), ingestor.ingest(second)]);
  assert.equal(calls, 1);
  assert.equal(results[1].duplicate, true);
  assert.equal(results[0].id, results[1].id);
  assert.equal(store.listScreenshots().length, 1);
});
test('同名截图内容变化会保留两份独立原件', async t => {
  const { store, directory } = await fixture(t);
  const source = path.join(directory, '支付.png');
  const ingestor = createScreenshotIngestor(store, null, {}, path.join(directory, 'inbox'));
  fs.writeFileSync(source, 'first-image'); const first = await ingestor.ingest(source);
  fs.writeFileSync(source, 'second-image'); const second = await ingestor.ingest(source);
  assert.notEqual(first.file_path, second.file_path);
  assert.equal(fs.readFileSync(first.file_path, 'utf8'), 'first-image');
  assert.equal(fs.readFileSync(second.file_path, 'utf8'), 'second-image');
  assert.equal(store.listScreenshots().length, 2);
});
test('导入失败不阻断队列；OCR 失败保留图片且通知用户', async t => {
  const { store, directory } = await fixture(t);
  const source = path.join(directory, '微信_16元.png'); fs.writeFileSync(source, 'image');
  const errors = [];
  const ingestor = createScreenshotIngestor(store, { recognizeAmount: async () => { throw new Error('unavailable'); } }, { onError: error => errors.push(error) }, path.join(directory, 'inbox'));
  await assert.rejects(ingestor.ingest(path.join(directory, 'missing.png')));
  const result = await ingestor.ingest(source);
  assert.equal(result.amount, null); // 文件名不能冒充真实识别结果。
  assert.ok(fs.existsSync(result.file_path));
  assert.equal(errors[0].message, 'unavailable');
});
test('内容文件重复保存不覆盖，同名不同内容保存独立原件', async t => {
  const { directory } = await fixture(t);
  const data = Buffer.from('content');
  const saved = saveContentFile(directory, '同名.pdf', data);
  assert.equal(saveContentFile(directory, '同名.pdf', data).filePath, saved.filePath);
  const other = saveContentFile(directory, '同名.pdf', Buffer.from('different'));
  assert.notEqual(other.filePath, saved.filePath);
  fs.writeFileSync(saved.filePath, 'damaged');
  const restored=saveContentFile(directory,'同名.pdf',data);
  assert.equal(fs.readFileSync(restored.filePath,'utf8'),'content');
  assert.equal(fs.readFileSync(saved.filePath,'utf8'),'damaged');
});
