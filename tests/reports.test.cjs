const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const {fixture}=require('./helpers.cjs');
const {Store}=require('../electron/store');
const {encrypt}=require('../electron/store/private-config');
const materials=require('../electron/services/materials');
const reports=require('../electron/services/reports');

async function setup(t){
  const context=await fixture(t);
  const invoices=[];const screenshots=[];
  for(let index=0;index<2;index++){
    const pdf=path.join(context.directory,'invoice_'+(index+1)+'0.00.pdf');
    fs.writeFileSync(pdf,'synthetic invoice '+index);
    invoices.push(materials.importInvoices(context.store,[pdf])[0]);
    const image=path.join(context.directory,'payment'+index+'.png');
    await sharp({create:{width:108,height:240,channels:3,background:index?'#eeeeee':'white'}}).png().toFile(image);
    screenshots.push({id:context.store.addScreenshot({file_path:image,file_name:path.basename(image),amount:(index+1)*10,purpose:'payment'})});
  }
  const expense=path.join(context.directory,'expense.png');
  await sharp({create:{width:108,height:600,channels:3,background:'#dddddd'}}).png().toFile(expense);
  const expenseId=context.store.addScreenshot({file_path:expense,file_name:'日常开销长截图.png',purpose:'expense'});
  return {...context,invoices,screenshots,expenseId};
}
test('付款配对持久化，一张截图不可复用，日常开销不能进入发票配对',async t=>{
  const {store,invoices,screenshots,expenseId}=await setup(t);
  materials.bindPayment(store,invoices[0].id,screenshots[0].id);
  assert.equal(materials.listMaterials(store).invoices.find(r=>r.id===invoices[0].id).screenshot_id,screenshots[0].id);
  assert.throws(()=>materials.bindPayment(store,invoices[1].id,screenshots[0].id),/其他发票/);
  assert.throws(()=>materials.bindPayment(store,invoices[1].id,expenseId),/日常开销/);
  assert.throws(()=>materials.updateMaterial(store,'screenshot',screenshots[0].id,{purpose:'expense'}),/解除/);
});
test('报销单计算与状态流转，已提交材料锁定，到账差额可核对',async t=>{
  const {store,invoices,screenshots}=await setup(t);
  for(let index=0;index<2;index++)materials.bindPayment(store,invoices[index].id,screenshots[index].id);
  const report=reports.saveReport(store,{title:'差旅测试',invoiceIds:invoices.map(invoice=>invoice.id),subsidyPerDay:100,subsidyDays:2});
  assert.equal(report.grand_total,230);
  reports.setStatus(store,report.id,'submitted');
  assert.throws(()=>materials.updateMaterial(store,'invoice',invoices[0].id,{amount:50}),/已提交/);
  assert.throws(()=>reports.removeReport(store,report.id),/未提交/);
  const paid=reports.setStatus(store,report.id,'paid',{actualReceived:229.5,paidDate:'2026-10-27'});
  assert.equal(paid.difference,-0.5);
  assert.equal(paid.status,'paid');
  assert.throws(()=>reports.setStatus(store,report.id,'unsubmitted'),/状态/);
});
test('提交前需补齐金额和付款截图，草稿允许人工修改并重新核算',async t=>{
  const {store,invoices,screenshots}=await setup(t);
  materials.updateMaterial(store,'invoice',invoices[0].id,{amount:null});
  const report=reports.saveReport(store,{title:'不完整草稿',invoiceIds:[invoices[0].id],subsidyPerDay:0});
  assert.throws(()=>reports.setStatus(store,report.id,'submitted'),/补齐/);
  materials.updateMaterial(store,'invoice',invoices[0].id,{amount:25.5});
  materials.bindPayment(store,invoices[0].id,screenshots[0].id);
  assert.equal(reports.getReport(store,report.id).grand_total,25.5);
  assert.equal(reports.getReport(store,report.id).screenshots.length,1);
  reports.setStatus(store,report.id,'submitted');
  reports.setStatus(store,report.id,'unsubmitted');
  materials.bindPayment(store,invoices[0].id,null);
  assert.equal(reports.getReport(store,report.id).screenshots.length,0);
});
test('同一材料不能进入两张报销单，删除草稿保留原件与付款配对',async t=>{
  const {store,invoices,screenshots}=await setup(t);
  materials.bindPayment(store,invoices[0].id,screenshots[0].id);
  const first=reports.saveReport(store,{title:'第一份',invoiceIds:[invoices[0].id],subsidyPerDay:0});
  assert.throws(()=>reports.saveReport(store,{title:'重复',invoiceIds:[invoices[0].id],subsidyPerDay:0}),/重复报销/);
  reports.removeReport(store,first.id);
  assert.ok(fs.existsSync(invoices[0].file_path));
  assert.equal(materials.listMaterials(store).invoices.find(r=>r.id===invoices[0].id).reports.length,0);
  assert.equal(materials.listMaterials(store).invoices.find(r=>r.id===invoices[0].id).screenshot_id,screenshots[0].id);
});
test('材料包使用发票顺序编号，付款截图与发票一一对应，保留原件',async t=>{
  const {store,invoices,screenshots}=await setup(t);
  for(let index=0;index<2;index++)materials.bindPayment(store,invoices[index].id,screenshots[index].id);
  const report=reports.saveReport(store,{title:'材料包',invoiceIds:[invoices[1].id,invoices[0].id],subsidyPerDay:0});
  const directory=await reports.exportPackage(store,report.id,3);
  assert.ok(fs.existsSync(path.join(directory,'支付记录.docx')));
  assert.equal(fs.existsSync(path.join(directory,'导出未完成.txt')),false);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'材料清单.json'),'utf8'));
  assert.equal(manifest.files[0].sourceId,invoices[1].id);
  assert.ok(manifest.files[0].file.includes('01_'));
  assert.ok(manifest.files[1].file.includes('01_'));
  assert.equal(fs.readFileSync(invoices[0].file_path,'utf8'),'synthetic invoice 0');
});
test('日常开销长截图只统计和留底，导出没有 Word，强制 Word 请求会拒绝',async t=>{
  const {store,expenseId}=await setup(t);
  const report=reports.saveReport(store,{title:'日常开销',kind:'no_invoice',screenshotIds:[expenseId],expenseTotal:18.5,subsidyPerDay:0});
  assert.equal(report.grand_total,18.5);
  await assert.rejects(reports.generateReportWord(store,report.id,3),/不导出/);
  const directory=await reports.exportPackage(store,report.id,3);
  assert.equal(fs.existsSync(path.join(directory,'支付记录.docx')),false);
  assert.equal(fs.readdirSync(path.join(directory,'日常开销原图')).length,1);
  reports.setStatus(store,report.id,'submitted');
});
test('邮箱独立配置加密保存，业务数据库不保存邮箱或凭据，重启后恢复',async t=>{
  const {store,directory,databasePath}=await fixture(t);
  store.addAccount({email:'private@example.invalid',name:'私人测试',imap_host:'localhost',auth_token:'synthetic-private-secret'});
  const text=fs.readFileSync(store.accounts.file,'utf8');
  assert.ok(text.includes('private@example.invalid'));
  assert.equal(text.includes('synthetic-private-secret'),false);
  assert.equal(store.decryptToken(store.getAccount(1).auth_token),'synthetic-private-secret');
  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from('private@example.invalid')),false);
  assert.equal(store.listAccounts()[0].auth_token,undefined);
  store.db.close();store.db=null;
  const reopened=await Store.create({root:directory});
  try{assert.equal(reopened.decryptToken(reopened.getAccount(1).auth_token),'synthetic-private-secret');}finally{reopened.db.close();}
});
test('旧版邮箱迁移保留账号编号和同步进度，凭据移出数据库并清理旧表',async t=>{
  const {store,databasePath}=await fixture(t);
  const token=encrypt('legacy-synthetic',store.accounts.keyFile);
  store.db.exec('CREATE TABLE mail_accounts (id INTEGER PRIMARY KEY,name TEXT,email TEXT,imap_host TEXT,imap_port INTEGER,imap_secure INTEGER,enabled INTEGER,auth_token TEXT,last_uid INTEGER,uid_validity TEXT)');
  store.db.prepare('INSERT INTO mail_accounts VALUES (?,?,?,?,?,?,?,?,?,?)').run(42,'旧版','legacy@example.invalid','localhost',993,1,1,token,123,'99');
  store._migrateAccounts();
  const account=store.getAccount(42);
  assert.equal(account.last_uid,123);assert.equal(account.uid_validity,'99');
  assert.equal(store.decryptToken(account.auth_token),'legacy-synthetic');
  assert.equal(store.db.prepare("SELECT name FROM sqlite_master WHERE name='mail_accounts'").get(),undefined);
  assert.equal(fs.readFileSync(databasePath).includes(Buffer.from('legacy@example.invalid')),false);
  assert.equal(store.addAccount({email:'next@example.invalid',imap_host:'localhost',auth_token:'next-synthetic'}),43);
});
test('材料只允许有限字段和合法金额，设置限制每页图片数量',async t=>{
  const {store,invoices}=await setup(t);
  assert.throws(()=>materials.updateMaterial(store,'invoice',invoices[0].id,{amount:-1}),/非负/);
  assert.throws(()=>materials.updateMaterial(store,'invoice',invoices[0].id,{amount:1.001}),/两位/);
  assert.throws(()=>store.setSettings({wordPerPage:4}),/2 或 3/);
  materials.updateMaterial(store,'invoice',invoices[0].id,{file_path:'tampered.pdf',amount:50});
  assert.equal(materials.getMaterial(store,'invoice',invoices[0].id).file_path,invoices[0].file_path);
});
test('编辑邮箱不清空原授权码，更换服务器时重置增量游标',async t=>{
  const {store}=await fixture(t);
  const id=store.addAccount({email:'edit@example.invalid',imap_host:'localhost',auth_token:'synthetic-secret'});
  store.updateAccount(id,{last_uid:123,uid_validity:'99'});
  store.updateAccount(id,{name:'新名称',auth_token:''});
  assert.equal(store.decryptToken(store.getAccount(id).auth_token),'synthetic-secret');
  assert.equal(store.getAccount(id).last_uid,123);
  store.updateAccount(id,{imap_host:'imap.example.invalid'});
  assert.equal(store.getAccount(id).last_uid,0);
  assert.equal(store.getAccount(id).uid_validity,null);
});

