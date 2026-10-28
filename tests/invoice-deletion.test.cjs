const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {fixture,seedAccount}=require('./helpers.cjs');
const {Store}=require('../electron/store');
const materials=require('../electron/services/materials');
const {ingestInvoice,reanalyze}=require('../electron/services/documents/ingest');
const {invoice,payment}=require('./doc-fixtures.cjs');
const batch=require('../electron/services/print/batch');
async function seed(t){
 const f=await fixture(t),file=await invoice(path.join(f.directory,'invoice.pdf'));
 const record=await ingestInvoice(f.store,file,null,{account_id:1,mail_uid:12});
 const image=await payment(path.join(f.directory,'payment.png'));
 const sid=f.store.addScreenshot({file_path:image,amount:10,purpose:'payment'});
 materials.bindPayment(f.store,record.id,sid);
 return {...f,record,sid,file,image};
}
test('删除隐藏发票并释放截图，保留原件、人工字段和打印历史，恢复不抢占截图',async t=>{
 const {store,record,sid,image}=await seed(t);materials.updateMaterial(store,'invoice',record.id,{seller:'人工商户'});
 const printed=await batch.createBatch(store,[record.id],'QA',{mode:'invoices',executor:async()=>{}});
 materials.deleteInvoices(store,[record.id]);
 const data=materials.listMaterials(store);assert.equal(data.invoices.length,0);assert.equal(data.deletedInvoices.length,1);assert.ok(data.deletedInvoices[0].deleted_at);
 assert.equal(data.screenshots[0].invoice_id,null);assert.equal(data.screenshots[0].status,'new');assert.ok(fs.existsSync(record.file_path));assert.ok(fs.existsSync(image));
 assert.equal(store.findInvoiceByHash(record.content_hash).id,record.id);assert.equal(batch.listBatches(store)[0].jobs[0].id,printed.jobs[0].id);
 assert.throws(()=>materials.bindPayment(store,record.id,sid),/已删除/);assert.throws(()=>materials.updateMaterial(store,'invoice',record.id,{amount:99}),/已删除/);
 await assert.rejects(batch.createBatch(store,[record.id],'QA',{mode:'invoices',executor:async()=>{}}),/已删除/);
 assert.throws(()=>require('../electron/services/reports').saveReport(store,{title:'拒绝已删除',invoiceIds:[record.id]}),/已删除/);
 materials.restoreInvoices(store,[record.id]);assert.equal(materials.listMaterials(store).invoices[0].seller,'人工商户');assert.equal(materials.listMaterials(store).invoices[0].screenshot_id,null);assert.ok(materials.listMaterials(store).invoices[0].printed_at);
 materials.bindPayment(store,record.id,sid);assert.equal(materials.listMaterials(store).invoices[0].screenshot_id,sid);
});
test('批量删除先验证全部项目，阻止打印中、状态不确定和报销单引用，拒绝无效参数',async t=>{
 const {store,record,directory}=await seed(t);const second=await ingestInvoice(store,await invoice(path.join(directory,'second.pdf'),{number:'22345678901234567890'}));
 store.printingIds=new Set([second.id]);assert.throws(()=>materials.deleteInvoices(store,[record.id,second.id]),/打印/);assert.equal(materials.listMaterials(store).invoices.length,2);assert.ok(materials.listMaterials(store).invoices.find(i=>i.id===record.id).screenshot_id);store.printingIds=null;
 const failed=await batch.createBatch(store,[second.id],'QA',{mode:'invoices',executor:async()=>{throw Object.assign(new Error('timeout'),{uncertain:true});}});
 assert.throws(()=>materials.deleteInvoices(store,[second.id]),/状态不确定/);batch.resolveUncertain(store,failed.jobs[0].id,true);
 const report=require('../electron/services/reports').saveReport(store,{title:'引用测试',invoiceIds:[second.id]});assert.throws(()=>materials.deleteInvoices(store,[record.id,second.id]),/报销单/);assert.equal(materials.listMaterials(store).invoices.length,2);
 require('../electron/services/reports').removeReport(store,report.id);
 for(const ids of [[],[0],['bad'],[record.id,record.id],Array.from({length:201},(_,i)=>i+1)])assert.throws(()=>materials.deleteInvoices(store,ids));
 assert.throws(()=>materials.deleteInvoices(store,[record.id,999999]),/不存在/);assert.equal(materials.listMaterials(store).invoices.length,2);
 materials.deleteInvoices(store,[record.id,second.id]);assert.equal(materials.listMaterials(store).invoices.length,0);assert.equal(materials.listMaterials(store).deletedInvoices.length,2);
 assert.throws(()=>materials.restoreInvoices(store,[record.id,999999]),/不存在/);assert.equal(materials.listMaterials(store).invoices.length,0);materials.restoreInvoices(store,[record.id,second.id]);assert.equal(materials.listMaterials(store).invoices.length,2);
});
test('删除跨重启保留，同内容重导、邮箱补扫和同票新格式均不重新出现',async t=>{
 const {store,record,file,directory}=await seed(t);materials.deleteInvoices(store,[record.id]);
 const again=await ingestInvoice(store,file);assert.equal(again.id,record.id);assert.ok(again.deleted_at);
 const account=seedAccount(store);store.setSettings({mailReceivedFrom:'2020-01-01'});
 const client={mailbox:{uidValidity:2n},async connect(){},async getMailboxLock(){return {release(){}};},async *fetch(range,query){if(!query.source)yield {uid:1,internalDate:new Date('2026-10-27'),bodyStructure:{filename:'invoice.pdf'}};else yield {uid:1,source:{attachments:[{filename:'invoice.pdf',content:fs.readFileSync(file)}]}};},async logout(){}};
 const fetched=await require('../electron/services/mail').fetchInvoices(account,store,{}, {client,decrypt:()=> 'synthetic',parse:async source=>source});assert.equal(fetched.downloaded,0);assert.equal(fetched.skipped,1);assert.equal(materials.listMaterials(store).invoices.length,0);
 const changed=await invoice(path.join(directory,'changed.pdf'),{seller:'Different bytes'});const variant=await ingestInvoice(store,changed);assert.equal(variant.id,record.id);assert.ok(variant.deleted_at);assert.equal(materials.listMaterials(store).invoices.length,0);
 await reanalyze(store,null);assert.equal(materials.listMaterials(store).invoices.length,0);
 const reopened=await Store.create({root:directory});try{assert.equal(reopened.listInvoices().length,0);assert.equal(materials.listMaterials(reopened).deletedInvoices.length,1);materials.restoreInvoices(reopened,[record.id]);assert.equal(reopened.listInvoices().length,1);}finally{reopened.db.close();}
});
test('历史重复行一起隐藏，PDF/OFD 变体与内容指纹在恢复后继续保留',async t=>{
 const {store,record,directory}=await seed(t);const alias=store.addInvoice({file_path:path.join(directory,'old-alias.pdf')});store.db.prepare('UPDATE invoices SET duplicate_of=? WHERE id=?').run(record.id,alias);
 const zip=new(require('jszip'))();zip.file('Content.xml','<ofd:TextCode>发票号码：12345678901234567890</ofd:TextCode><ofd:TextCode>小写：¥10.00</ofd:TextCode>');const ofd=path.join(directory,'invoice.ofd');fs.writeFileSync(ofd,await zip.generateAsync({type:'nodebuffer'}));const variant=await ingestInvoice(store,ofd);assert.equal(variant.id,record.id);
 materials.deleteInvoices(store,[record.id]);assert.equal(store.listInvoices().length,0);assert.ok(store.findInvoiceByHash(require('../electron/services/files').contentHash(fs.readFileSync(ofd))).deleted_at);assert.ok(store.db.prepare('SELECT deleted_at FROM invoices WHERE id=?').get(alias).deleted_at);
 materials.restoreInvoices(store,[record.id]);assert.equal(materials.listMaterials(store).invoices.length,1);assert.equal(store.db.prepare('SELECT deleted_at FROM invoices WHERE id=?').get(alias).deleted_at,null);assert.ok(fs.existsSync(variant.file_path));
});
test('包含已删除发票的历史失败批次在恢复前不能续打任何任务',async t=>{
 const {store,record}=await seed(t);const failed=await batch.createBatch(store,[record.id],'QA',{executor:async()=>{throw new Error('offline');}});
 materials.deleteInvoices(store,[record.id]);let calls=0;await assert.rejects(batch.runBatch(store,failed.id,{executor:async()=>{calls++;}}),/已删除/);assert.equal(calls,0);
 materials.restoreInvoices(store,[record.id]);const done=await batch.runBatch(store,failed.id,{executor:async()=>{calls++;}});assert.equal(done.status,'submitted');assert.equal(calls,2);
});
test('旧版数据库增加删除字段时保留邮箱配置、密钥、设置和既有发票',async t=>{
 const {store,record,directory}=await seed(t);seedAccount(store);store.setSettings({mailReceivedFrom:'2024-01-01'});
 const names=['accounts.private.json','.key','settings.json'];const before=names.map(name=>fs.readFileSync(path.join(store.dirs.config,name)));
 store.db.exec('ALTER TABLE invoices DROP COLUMN deleted_at; PRAGMA user_version=3');store.db.close();store.db=null;
 const upgraded=await Store.create({root:directory});try{
  assert.equal(upgraded.listInvoices()[0].id,record.id);assert.equal(upgraded.listInvoices()[0].deleted_at,null);assert.equal(upgraded.getAccount(1).email,'test@example.invalid');assert.equal(upgraded.getSettings().mailReceivedFrom,'2024-01-01');
  for(let i=0;i<names.length;i++)assert.deepEqual(fs.readFileSync(path.join(upgraded.dirs.config,names[i])),before[i]);
  materials.deleteInvoices(upgraded,[record.id]);assert.equal(materials.listMaterials(upgraded).deletedInvoices.length,1);
 }finally{upgraded.db.close();}
});
