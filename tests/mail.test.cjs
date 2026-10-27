const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fixture, seedAccount } = require('./helpers.cjs');
const { fetchInvoices } = require('../electron/services/mail');

function clientFor(messages, validity = 1) {
  return {
    mailbox: { uidValidity: BigInt(validity) }, released: false, loggedOut: false,
    async connect() {},
    async getMailboxLock() { return { release: () => { this.released = true; } }; },
    async *fetch(range, query) {
      if (!query.source) {
        for (const message of messages) yield { uid: message.uid, bodyStructure: message.attachments?.length ? { dispositionParameters: { filename: 'invoice.pdf' } } : null };
      } else {
        const message = messages.find(entry => entry.uid === Number(range));
        if (message.error) throw new Error(message.error);
        yield { uid: message.uid, source: message, envelope: { subject: 'Synthetic' } };
      }
    },
    async logout() { this.loggedOut = true; },
  };
}
const attachment = (text, filename = '同名.pdf') => ({ filename, content: Buffer.from(text) });
function deps(client, directory) { return { client, decrypt: () => 'synthetic', parse: async source => source, dirs: { inbox: path.join(directory, 'inbox') } }; }

test('排除旧 UID 并推进无发票邮件游标，重复拉取不新增', async t => {
  const { store, directory } = await fixture(t);
  const account = seedAccount(store, { last_uid: 10 });
  account.last_range_key=JSON.stringify([store.getSettings().mailReceivedFrom,null,require('../electron/services/mail').RULE_VERSION]);
  const messages = [{ uid: 10, attachments: [attachment('old')] }, { uid: 12, attachments: [] }, { uid: 11, attachments: [attachment('new')] }];
  const client = clientFor(messages);
  const result = await fetchInvoices(account, store, {}, deps(client, directory));
  assert.equal(result.downloaded, 1);
  assert.equal(store.getAccount(1).last_uid, 12);
  assert.equal(client.released, true); assert.equal(client.loggedOut, true);
  assert.equal((await fetchInvoices(store.getAccount(1), store, {}, deps(clientFor(messages), directory))).downloaded, 0);
  assert.equal(store.listInvoices().length, 1);
});
test('邮件中途失败保留已完成进度，重试不重复导入部分成功附件', async t => {
  const { store, directory } = await fixture(t);
  const account = seedAccount(store);
  const messages = [{ uid: 1, attachments: [attachment('one')] }, { uid: 2, attachments: [attachment('two-a'), attachment('two-b')] }];
  const add = store.addInvoice.bind(store);
  let fail = true;
  store.addInvoice = rec => {
    if (fail && rec.mail_uid === 2 && store.listInvoices().length === 2) { fail = false; throw new Error('disk failure'); }
    return add(rec);
  };
  await assert.rejects(fetchInvoices(account, store, {}, deps(clientFor(messages), directory)), /disk failure/);
  assert.equal(store.getAccount(1).last_uid, 1);
  assert.equal(store.listInvoices().length, 2);
  const result = await fetchInvoices(store.getAccount(1), store, {}, deps(clientFor(messages), directory));
  assert.equal(result.downloaded, 1); assert.equal(result.skipped, 2);
  assert.equal(store.getAccount(1).last_uid, 2);
  assert.equal(store.listInvoices().length, 3);
  const paths = store.listInvoices().map(invoice => invoice.file_path);
  assert.equal(new Set(paths).size, 3);
  assert.equal(fs.readFileSync(paths[1], 'utf8'), 'two-a');
});
test('UIDVALIDITY 变化或旧账号无该字段时重扫，并按内容跳过历史材料', async t => {
  const { store, directory } = await fixture(t);
  const account = seedAccount(store, { last_uid: 900, uid_validity: '99' });
  const old = path.join(directory, 'old.pdf'); fs.writeFileSync(old, 'old-content');
  store.addInvoice({ file_path: old });
  const result = await fetchInvoices(account, store, {}, deps(clientFor([{ uid: 1, attachments: [attachment('old-content'), attachment('fresh')] }], 100), directory));
  assert.equal(result.skipped, 1); assert.equal(result.downloaded, 1);
  assert.equal(store.getAccount(1).uid_validity, '100');
  assert.equal(store.getAccount(1).last_uid, 1);
  assert.ok(store.listInvoices().some(i=>i.file_path.startsWith(store.dirs.inbox)&&fs.readFileSync(i.file_path,'utf8')==='fresh'));
  store.updateAccount(1, { uid_validity: null, last_uid: 500 });
  assert.equal((await fetchInvoices(store.getAccount(1), store, {}, deps(clientFor([{ uid: 1, attachments: [attachment('fresh')] }], 100), directory))).downloaded, 0);
});
test('同一邮箱禁止并发收取，失败后锁可释放', async t => {
  const { store, directory } = await fixture(t);
  const account = seedAccount(store);
  const client = clientFor([]);
  let finish;
  client.connect = () => new Promise(resolve => { finish = resolve; });
  const first = fetchInvoices(account, store, {}, deps(client, directory));
  await assert.rejects(fetchInvoices(account, store, {}, deps(clientFor([]), directory)), /正在收取/);
  finish(); await first;
  const broken = clientFor([]); broken.connect = async () => { throw new Error('offline'); };
  await assert.rejects(fetchInvoices(account, store, {}, deps(broken, directory)), /offline/);
  await fetchInvoices(account, store, {}, deps(clientFor([]), directory));
});

test('邮件按收到日期包含首尾当天；修改范围会越过旧 UID 补收，重复内容只保存一次',async t=>{
 const {store,directory}=await fixture(t);store.setSettings({mailReceivedFrom:'2026-10-10',mailReceivedTo:'2026-10-12'});
 const messages=[{uid:1,internalDate:new Date('2026-10-09T12:00:00+08:00'),attachments:[attachment('before')]},{uid:2,internalDate:new Date('2026-10-10T00:00:00+08:00'),attachments:[attachment('start')]},{uid:3,internalDate:new Date('2026-10-12T23:59:59+08:00'),attachments:[attachment('end')]},{uid:4,internalDate:new Date('2026-10-13T00:00:00+08:00'),attachments:[attachment('after')]}];
 function client(){const c=clientFor(messages);c.search=async query=>{c.query=query;return messages.map(m=>m.uid);};const fetch=c.fetch.bind(c);c.fetch=async function*(range,query){for await(const m of fetch(range,query)){yield {...m,internalDate:messages.find(x=>x.uid===m.uid).internalDate};}};return c;}
 const account=seedAccount(store,{last_uid:999});const first=await fetchInvoices(account,store,{},deps(client(),directory));assert.equal(first.downloaded,2);assert.deepEqual(store.listInvoices().map(r=>fs.readFileSync(r.file_path,'utf8')).sort(),['end','start']);
 store.setSettings({mailReceivedFrom:'2026-10-09'});const second=await fetchInvoices(store.getAccount(1),store,{},deps(client(),directory));assert.equal(second.downloaded,1);assert.equal(second.skipped,2);assert.equal(store.listInvoices().length,3);assert.ok(store.getAccount(1).last_range_key.includes('2026-10-09'));
});
