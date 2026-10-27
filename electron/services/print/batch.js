'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {paymentImages}=require('../materials');
const {contentHash}=require('../files');
const {generatePaymentWord,generatePaymentPdf}=require('../word');
const {renderPdf}=require('../documents/pdf');
function printOptions(printer,landscape){return {silent:true,deviceName:printer,duplexMode:'simplex',copies:1,printBackground:true,color:true,pageSize:'A4',landscape,margins:{marginType:'none'}};}
async function nativePrint(file,printer,temp,options={}){
  const {BrowserWindow}=require('electron');
  const pages=await renderPdf(file,{scale:2.5,pages:'all'});
  const landscape=pages[0].width>pages[0].height;
  const html='<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><style>@page{size:A4 '+(landscape?'landscape':'portrait')+';margin:0}*{box-sizing:border-box}html,body{margin:0}.page{width:'+(landscape?'297':'210')+'mm;height:'+(landscape?'210':'297')+'mm;display:flex;align-items:center;justify-content:center;break-after:page}.page:last-child{break-after:auto}img{width:100%;height:100%;object-fit:contain}</style>'+pages.map(p=>'<div class="page"><img src="data:image/png;base64,'+p.data.toString('base64')+'"></div>').join('');
  const htmlPath=path.join(temp,'print-'+crypto.randomUUID()+'.html');fs.writeFileSync(htmlPath,html);
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false}});
  try{
    await win.loadFile(htmlPath);await win.webContents.executeJavaScript('Promise.all(Array.from(document.images).map(i=>i.decode()))');
    if(options.previewOutput){
      fs.writeFileSync(options.previewOutput+'.json',JSON.stringify({images:await win.webContents.executeJavaScript('Array.from(document.images).map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,rect:{width:i.width,height:i.height}}))'),stats:await require('sharp')(pages[0].data).stats(),runtime:process.versions},null,2));
      fs.writeFileSync(options.previewOutput,await win.webContents.printToPDF({landscape,pageSize:'A4',printBackground:true,preferCSSPageSize:true,margins:{top:0,bottom:0,left:0,right:0}}));
      return options.previewOutput;
    }
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Object.assign(new Error('打印反馈超时，任务状态不确定，请先查看系统打印队列'),{uncertain:true})),60000);
      win.webContents.print(printOptions(printer,landscape),(success,reason)=>{clearTimeout(timer);success?resolve():reject(new Error(reason||'打印机拒绝任务'));});
    });
  }finally{win.destroy();fs.unlinkSync(htmlPath);}
}
function listBatches(store){return store.db.prepare('SELECT * FROM print_batches ORDER BY created_at DESC,id DESC LIMIT 20').all().map(b=>({...b,jobs:store.db.prepare('SELECT * FROM print_jobs WHERE batch_id=? ORDER BY seq').all(b.id)}));}
async function createBatch(store,invoiceIds,printer,options={}){
 if(store.printing||store.preparingPrint)throw new Error('有批次正在打印，请等待完成');
 if(typeof printer!=='string'||!printer.trim())throw new Error('请选择打印机');
 if(!Array.isArray(invoiceIds)||!invoiceIds.length||new Set(invoiceIds.map(Number)).size!==invoiceIds.length)throw new Error('请先选择发票，选择不能重复');
 const mode=options.mode||'complete';if(!['invoices','complete'].includes(mode))throw new Error('打印模式无效');
 const pairs=mode==='complete'?paymentImages(store,invoiceIds):invoiceIds.map(id=>({invoice:require('../materials').getMaterial(store,'invoice',id)}));
 store.preparingPrint=true;store.printingIds=new Set(invoiceIds.map(Number));
 const id=Date.now()+'-'+crypto.randomUUID().slice(0,8);let word=null,pdf=null;
 try{
  for(const {invoice,screenshot}of pairs){
   if(path.extname(invoice.file_path).toLowerCase()!=='.pdf')throw new Error('该发票只有 OFD，请补充对应 PDF 后打印');
   if(!fs.existsSync(invoice.file_path))throw new Error('发票原件缺失，请重新导入');
   const info=await require('../documents/pdf').pdfText(invoice.file_path);if(info.pageCount>30)throw new Error('单份 PDF 超过 30 页，请拆分后打印');
   if(mode==='complete'){
    if(!fs.existsSync(screenshot.file_path))throw new Error('付款截图缺失，请重新导入');
    if(screenshot.payment_state!=='ok')throw new Error('付款截图状态异常，请核对');
    const m=await require('sharp')(fs.readFileSync(screenshot.file_path)).metadata();require('../word').fitImage(m.width,m.height,options.perPage||store.getSettings().wordPerPage);
   }
  }
  if(mode==='complete'){
   const dir=path.join(store.dirs.export,id);fs.mkdirSync(dir,{recursive:true});word=path.join(dir,'付款记录.docx');pdf=path.join(dir,'付款记录_打印.pdf');
   const images=pairs.map(p=>p.screenshot.file_path),config={perPage:options.perPage||store.getSettings().wordPerPage};await generatePaymentWord(images,word,config);await generatePaymentPdf(images,pdf,config);
  }
  store.db.transaction(()=>{
   store.db.prepare("INSERT INTO print_batches(id,printer_name,status,word_path,pdf_path) VALUES (?,?,'ready',?,?)").run(id,printer,word,pdf);
   pairs.forEach((p,i)=>store.db.prepare("INSERT INTO print_jobs(batch_id,seq,kind,invoice_id,file_path,title,content_hash) VALUES (?,?,'invoice',?,?,?,?)").run(id,i,p.invoice.id,p.invoice.file_path,require('../documents/parse').friendlyInvoice(p.invoice),contentHash(fs.readFileSync(p.invoice.file_path))));
   if(pdf)store.db.prepare("INSERT INTO print_jobs(batch_id,seq,kind,file_path,title,content_hash) VALUES (?,?,'payments',?,'付款记录 Word 的打印版',?)").run(id,pairs.length,pdf,contentHash(fs.readFileSync(pdf)));
  });
 }finally{store.preparingPrint=false;store.printingIds=null;}
 return runBatch(store,id,options);
}
async function runBatch(store,id,options={}){
  if(store.printing)throw new Error('有批次正在打印');
  const batch=store.db.prepare('SELECT * FROM print_batches WHERE id=?').get(id);if(!batch)throw new Error('打印批次不存在');
  const jobs=store.db.prepare("SELECT * FROM print_jobs WHERE batch_id=? AND state IN ('pending','failed') ORDER BY seq").all(id);
  if(store.db.prepare("SELECT id FROM print_jobs WHERE batch_id=? AND state IN ('submitting','uncertain')").get(id))throw new Error('有状态不确定的任务，请先查看系统打印队列并在界面确认');
  for(const job of jobs){if(!fs.existsSync(job.file_path)||contentHash(fs.readFileSync(job.file_path))!==job.content_hash)throw new Error('待打印文件已变化，请重新选择生成批次');}
  store.printing=true;
  store.db.prepare("UPDATE print_batches SET status='printing',error=NULL WHERE id=?").run(id);store.persist();
  try{
    for(const job of jobs){
      store.db.prepare("UPDATE print_jobs SET state='submitting',error=NULL WHERE id=?").run(job.id);store.persist();
      options.onProgress?.({batchId:id,title:job.title,seq:job.seq+1,total:store.db.prepare('SELECT COUNT(*) AS n FROM print_jobs WHERE batch_id=?').get(id).n});
      try{
        await (options.executor||nativePrint)(job.file_path,batch.printer_name,store.dirs.temp);
        store.db.prepare("UPDATE print_jobs SET state='submitted',submitted_at=datetime('now','localtime') WHERE id=?").run(job.id);
        if(job.invoice_id)store.db.prepare("UPDATE invoices SET printed_at=datetime('now','localtime') WHERE id=?").run(job.invoice_id);
        store.persist();
      }catch(error){
        store.db.prepare('UPDATE print_jobs SET state=?,error=? WHERE id=?').run(error.uncertain?'uncertain':'failed',error.message,job.id);
        store.db.prepare("UPDATE print_batches SET status='failed',error=? WHERE id=?").run(error.message,id);store.persist();
        return listBatches(store).find(b=>b.id===id);
      }
    }
    store.db.prepare("UPDATE print_batches SET status='submitted' WHERE id=?").run(id);store.persist();
    return listBatches(store).find(b=>b.id===id);
  }finally{store.printing=false;}
}
function resolveUncertain(store,jobId,wasSubmitted){
  if(store.printing)throw new Error('正在打印');
  const job=store.db.prepare("SELECT * FROM print_jobs WHERE id=? AND state IN ('submitting','uncertain')").get(Number(jobId));if(!job)throw new Error('任务无需确认');
  store.db.prepare('UPDATE print_jobs SET state=? WHERE id=?').run(wasSubmitted?'submitted':'pending',job.id);store.persist();
  if(wasSubmitted&&job.invoice_id){store.db.prepare("UPDATE invoices SET printed_at=datetime('now','localtime') WHERE id=?").run(job.invoice_id);store.persist();}
}
module.exports={createBatch,runBatch,listBatches,resolveUncertain,nativePrint,printOptions};
