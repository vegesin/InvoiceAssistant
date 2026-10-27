const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {fixture}=require('./helpers.cjs');const {invoice,payment}=require('./doc-fixtures.cjs');
const {parseInvoice,parsePayment}=require('../electron/services/documents/parse');const {ingestInvoice}=require('../electron/services/documents/ingest');
const {recommendations}=require('../electron/services/match/recommend');const {OcrService,sumLongScreenshot}=require('../electron/services/ocr');
const {Store}=require('../electron/store');
const batch=require('../electron/services/print/batch');

test('发票读取正文金额与销售方，优先价税合计，不把金额来自文件名',async t=>{
 const {store,directory}=await fixture(t);const file=await invoice(path.join(directory,'乱码_999.00.pdf'),{amount:123.45});
 const r=await ingestInvoice(store,file);assert.equal(r.amount,123.45);assert.equal(r.seller,'Test Hotel');assert.equal(r.issue_date,'2026-10-27');assert.ok(fs.existsSync(r.thumbnail_path));assert.ok(!path.basename(r.file_path).includes('乱码'));
 const copy=path.join(directory,'another.pdf');fs.copyFileSync(file,copy);assert.equal((await ingestInvoice(store,copy)).id,r.id);assert.equal(store.listInvoices().length,1);
});
test('PDF/OFD 同票号归为一张，优先 PDF，保留两份原始文件',async t=>{
 const {store,directory}=await fixture(t);const zip=new(require('jszip'))();zip.file('Doc_0/Pages/Page_0/Content.xml','<ofd:TextCode>发票号码：12345678901234567890</ofd:TextCode><ofd:TextCode>开票日期：2026年10月27日</ofd:TextCode><ofd:TextCode>小写：¥10.00</ofd:TextCode>');const ofd=path.join(directory,'hash.ofd');fs.writeFileSync(ofd,await zip.generateAsync({type:'nodebuffer'}));
 const a=await ingestInvoice(store,ofd);const pdf=await invoice(path.join(directory,'same.pdf'));const b=await ingestInvoice(store,pdf);assert.equal(a.id,b.id);assert.match(b.file_path,/\.pdf$/);assert.equal(store.listInvoices().length,1);assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM invoice_variants').get().n,2);assert.ok(fs.existsSync(a.file_path));
});
test('正文规则区分用车行程附件与航空票据，拒绝退款及多金额猜测',()=>{
 assert.equal(parseInvoice('用车行程单\n合计金额：48.86',[],'航旅纵横用车电子行程单.pdf').document_kind,'supporting');
 assert.equal(parseInvoice('电子发票\n小写：¥48.86',[],'航旅纵横用车电子发票.pdf').invoice_type,'用车发票');
 assert.equal(parseInvoice('电子发票\n小写：¥-12.00').document_kind,'refund');
 assert.equal(parsePayment('¥10.00\n¥20.00\n余额¥500.00').amount,null);
 assert.equal(parsePayment('实付金额\n¥18.50\n优惠 ¥2.00').amount,18.5);
 assert.equal(parsePayment('退款成功\n¥18.50').payment_state,'refund');
});
test('首次启动日期只持久化一次，邮件日期范围可补收且默认持续收取',async t=>{
 const {directory,store}=await fixture(t);const initial=store.getSettings().mailReceivedFrom;store.setSettings({mailReceivedFrom:'2025-01-01',mailReceivedTo:null});store.db.close();store.db=null;
 const reopened=await Store.create({root:directory,firstLaunchDate:'2030-01-01'});assert.equal(reopened.getSettings().mailReceivedFrom,'2025-01-01');assert.equal(reopened.getSettings().firstLaunchDate,initial);assert.equal(reopened.getSettings().mailReceivedTo,null);assert.throws(()=>reopened.setSettings({mailReceivedTo:'2024-12-31'}),/结束日期/);reopened.db.close();
});
test('新旧排序按开票日期，金额相同多笔推荐保持歧义，商户日期明确才推荐',async t=>{
 const {store}=await fixture(t);store.addInvoice({file_path:'a',issue_date:'2026-10-27'});store.addInvoice({file_path:'b',issue_date:'2025-01-01'});assert.equal(store.listInvoices()[0].file_path,'a');
 const invoices=[{id:1,amount:10,issue_date:'2026-10-27',seller:'测试酒店'},{id:2,amount:10,issue_date:'2026-10-27',seller:'测试餐厅'}];const shots=[{id:1,amount:10,purpose:'payment',pay_date:'2026-10-27'},{id:2,amount:10,purpose:'payment',pay_date:'2026-10-27'}];assert.equal(recommendations(invoices,shots).filter(r=>r.confident).length,0);shots[0].merchant='测试酒店';shots[1].merchant='测试餐厅';assert.equal(recommendations(invoices,shots).filter(r=>r.confident).length,2);
});
test('N+1 个单面打印任务持久化，失败续打不会重复已成功提交任务',async t=>{
 const {store,directory}=await fixture(t);const {bindPayment}=require('../electron/services/materials');const ids=[];
 for(let i=1;i<=2;i++){const pdf=await invoice(path.join(directory,i+'.pdf'),{amount:i*10,number:'1234567890123456789'+i});const p=await payment(path.join(directory,i+'.png'),{amount:i*10});const id=store.addInvoice({file_path:pdf,amount:i*10});const sid=store.addScreenshot({file_path:p,amount:i*10});bindPayment(store,id,sid);ids.push(id);}
 const calls=[];const failed=await batch.createBatch(store,ids,'QA Fake Printer',{executor:async(file)=>{calls.push(file);if(calls.length===2)throw new Error('offline');}});
 assert.equal(failed.jobs.length,3);assert.equal(failed.jobs[0].state,'submitted');assert.equal(failed.jobs[1].state,'failed');assert.equal(failed.jobs[2].state,'pending');
 const retried=await batch.runBatch(store,failed.id,{executor:async file=>calls.push(file)});assert.equal(retried.status,'submitted');assert.equal(calls.filter(f=>f===failed.jobs[0].file_path).length,1);assert.equal(calls.length,4);assert.ok(fs.existsSync(retried.word_path));assert.equal(batch.printOptions('p',false).duplexMode,'simplex');assert.equal(batch.printOptions('p',false).copies,1);
});
test('状态不确定的打印任务必须人工确认，不自动重发',async t=>{
 const {store,directory}=await fixture(t);const pdf=await invoice(path.join(directory,'1.pdf'));const png=await payment(path.join(directory,'1.png'));const i=store.addInvoice({file_path:pdf,amount:10});const s=store.addScreenshot({file_path:png,amount:10});require('../electron/services/materials').bindPayment(store,i,s);
 const r=await batch.createBatch(store,[i],'QA',{executor:async()=>{throw Object.assign(new Error('timeout'),{uncertain:true});}});assert.equal(r.jobs[0].state,'uncertain');await assert.rejects(batch.runBatch(store,r.id,{executor:async()=>{}}),/状态不确定/);batch.resolveUncertain(store,r.jobs[0].id,true);assert.equal((await batch.runBatch(store,r.id,{executor:async()=>{}})).status,'submitted');
});
test('内置中文 OCR 实测手机付款截图，日常账单识别支出退款收入',async t=>{
 const {directory}=await fixture(t);const ocr=new OcrService();const file=await payment(path.join(directory,'payment.png'),{amount:123.45,merchant:'测试酒店'});const r=await ocr.recognizeAmount(file);assert.equal(r.amount,123.45,JSON.stringify(r));assert.equal(r.merchant,'测试酒店');assert.equal(r.pay_date,'2026-10-27');
 const daily=await payment(path.join(directory,'daily.png'),{daily:true});const result=await ocr.readText(daily);const sum=sumLongScreenshot(result.text);assert.equal(sum.total,18.5,JSON.stringify({text:result.text,sum}));
});
test('资料迁移逐文件校验并改写路径，不覆盖目标、不删除原目录',async t=>{
 const {store,directory}=await fixture(t);const file=await invoice(path.join(store.dirs.inbox,'source.pdf'));store.addInvoice({file_path:file,amount:10});store.persist();
 const target=path.join(path.dirname(directory),path.basename(directory)+'-migrated');t.after(()=>{if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});});const {copyVerified,rewritePaths}=require('../electron/store/storage');copyVerified(directory,target);assert.ok(fs.existsSync(file));const copied=await Store.create({root:target});rewritePaths(copied);assert.ok(copied.listInvoices()[0].file_path.startsWith(target));assert.ok(fs.existsSync(copied.listInvoices()[0].file_path));copied.db.close();assert.throws(()=>copyVerified(directory,target),/同名/);assert.throws(()=>copyVerified(directory,path.join(directory,'child')),/不能互相包含/);
});
