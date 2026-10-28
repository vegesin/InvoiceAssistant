const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {fixture}=require('./helpers.cjs'),{Store}=require('../electron/store');
const paths=require('../electron/store/paths'),storage=require('../electron/store/storage');
test('定位文件的相对目录按启动器目录解析，不依赖当前工作目录，外部绝对路径继续支持',async t=>{
 const {directory}=await fixture(t);const saved={launcher:paths.LAUNCHER_ROOT,pointer:paths.PREFERENCE_FILE,preference:paths.preference,legacy:paths.LEGACY_ROOT,root:paths.DIRS.root};
 const prior=process.env.INVOICE_ASSISTANT_DATA_DIR;delete process.env.INVOICE_ASSISTANT_DATA_DIR;
 try{
  paths.LAUNCHER_ROOT=path.join(directory,'release');paths.PREFERENCE_FILE=path.join(paths.LAUNCHER_ROOT,'InvoiceAssistant.private.json');paths.LEGACY_ROOT=path.join(directory,'none');paths.preference=()=>({dataRoot:'InvoiceData',firstLaunchDate:'2025-01-02'});
  const result=await storage.chooseInitial({showOpenDialog(){throw new Error('不应弹窗');}});
  assert.equal(result.root,path.join(paths.LAUNCHER_ROOT,'InvoiceData'));assert.equal(result.firstLaunchDate,'2025-01-02');
  assert.equal(JSON.parse(fs.readFileSync(paths.PREFERENCE_FILE,'utf8')).dataRoot,'InvoiceData');
  assert.equal(paths.resolveDataRoot('InvoiceData'),result.root);assert.equal(paths.storedDataRoot(result.root),'InvoiceData');
  const external=path.join(directory,'external');assert.equal(paths.storedDataRoot(external),external);assert.equal(paths.resolveDataRoot(external),external);
  paths.preference=()=>({});const fresh=await storage.chooseInitial({showOpenDialog(){throw new Error('不应弹窗');}});assert.equal(fresh.root,result.root);
 }finally{Object.assign(paths,{LAUNCHER_ROOT:saved.launcher,PREFERENCE_FILE:saved.pointer,preference:saved.preference,LEGACY_ROOT:saved.legacy});paths.setRoot(saved.root);if(prior===undefined)delete process.env.INVOICE_ASSISTANT_DATA_DIR;else process.env.INVOICE_ASSISTANT_DATA_DIR=prior;}
});
test('移动整个资料目录后自动修正原件、变体、截图和打印记录路径，保留私人配置及关联',async t=>{
 const {directory,store}=await fixture(t);const old=path.join(directory,'old','InvoiceData'),next=path.join(directory,'moved','InvoiceData');
 fs.mkdirSync(old,{recursive:true});const original=await Store.create({root:old});let copied;
 try{
  const pdf=path.join(original.dirs.inbox,'original.pdf'),shot=path.join(original.dirs.screenshots,'pay.png');fs.writeFileSync(pdf,'synthetic-pdf');fs.writeFileSync(shot,'synthetic-image');
  const id=original.addInvoice({file_path:pdf,amount:10}),sid=original.addScreenshot({file_path:shot,amount:10});require('../electron/services/materials').bindPayment(original,id,sid);
  original.db.prepare('INSERT INTO invoice_variants(invoice_id,file_path,format) VALUES (?,?,?)').run(id,pdf,'.pdf');
  original.db.prepare("INSERT INTO print_batches(id,printer_name,status,word_path,pdf_path) VALUES ('old','QA','failed',?,?)").run(path.join(old,'export','x.docx'),path.join(old,'export','x.pdf'));
  original.db.prepare("INSERT INTO print_jobs(batch_id,invoice_id,file_path) VALUES ('old',?,?)").run(id,pdf);
  storage.rewritePaths(original);original.db.close();original.db=null;
  fs.mkdirSync(path.dirname(next),{recursive:true});fs.cpSync(old,next,{recursive:true});
  copied=await Store.create({root:next});const config=fs.readFileSync(copied.configFile);storage.rewritePaths(copied);
  const data=require('../electron/services/materials').listMaterials(copied);assert.equal(data.invoices[0].file_path,path.join(next,'inbox','original.pdf'));assert.equal(data.invoices[0].screenshot_id,sid);assert.equal(data.screenshots[0].file_path,path.join(next,'screenshots','pay.png'));
  assert.equal(copied.db.prepare('SELECT file_path FROM invoice_variants').get().file_path,path.join(next,'inbox','original.pdf'));
  assert.equal(copied.db.prepare('SELECT file_path FROM print_jobs').get().file_path,path.join(next,'inbox','original.pdf'));
  assert.equal(copied.db.prepare('SELECT word_path FROM print_batches').get().word_path,path.join(next,'export','x.docx'));assert.deepEqual(fs.readFileSync(copied.configFile),config);
  assert.ok(fs.existsSync(pdf));assert.ok(fs.existsSync(data.invoices[0].file_path));
  storage.rewritePaths(copied);assert.equal(copied.listInvoices()[0].file_path,path.join(next,'inbox','original.pdf'));
 }finally{original.db?.close();copied?.db?.close();}
});
