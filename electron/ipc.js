'use strict';
const { ipcMain, dialog, shell, clipboard, app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mail = require('./services/mail');
const ocr = require('./services/ocr');
const match = require('./services/match');
const word = require('./services/word');
const print = require('./services/print');
const ledger = require('./services/ledger');
const materials = require('./services/materials');
const reports = require('./services/reports');
const archive = require('./services/archive');

function registerIpc(ctx) {
  const { store, ocrService } = ctx;
  let activeImports=0;
  async function importItems(items,purpose='payment',invoiceId=null){activeImports++;try{return await require('./services/documents/import').importItems(store,ocrService,ctx.screenshotWatcher,items,purpose,invoiceId);}finally{activeImports--;ctx.notify?.('app:progress',{phase:'导入处理完成'});}}
  const handle=(name,callback)=>ipcMain.handle(name,(_event,...args)=>callback(...args));
  handle('material:drop',importItems);
  handle('settings:get',()=>store.getSettings());
  handle('settings:set',patch=>{const settings=store.setSettings(patch);ocrService.configure(settings);return settings;});
  handle('mail:list',()=>store.listAccounts());
  handle('mail:add',account=>store.addAccount(account));
  handle('mail:update',(id,patch)=>store.updateAccount(id,patch));
  handle('mail:remove',id=>store.removeAccount(id));
  ipcMain.handle('mail:fetch',async(event,accountId)=>{
    const account=store.getAccount(accountId);
    if(!account)throw new Error('邮箱账号不存在');
    if(ctx.fetchOne)return ctx.fetchOne(accountId);
    return mail.fetchInvoices(account,store,{
      onMail:payload=>{if(!event.sender.isDestroyed())event.sender.send('mail:onMail',payload);},
      onInvoice:payload=>{if(!event.sender.isDestroyed())event.sender.send('mail:onInvoice',payload);},
    });
  });
  const filter=(where)=>{
    if(!['',"WHERE status IN ('new','matched')"].includes(where||''))throw new Error('列表筛选参数无效');
    return where||'';
  };
  handle('invoice:list',where=>store.listInvoices(filter(where)));
  handle('screenshot:list',where=>store.listScreenshots(filter(where)));
  handle('invoice:pick',async()=>{
    const result=await dialog.showOpenDialog({properties:['openFile','multiSelections'],filters:[{name:'发票',extensions:['pdf','ofd','zip']}]});
    return result.canceled?[]:result.filePaths;
  });
  handle('invoice:import',async paths=>{
    if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw new Error('请选择有效文件');
    if(!paths.length)return [];return (await importItems(paths)).records;
  });
  handle('screenshot:pick',async()=>{
    const result=await dialog.showOpenDialog({properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['jpg','jpeg','png','webp','bmp','gif']}]});
    return result.canceled?[]:result.filePaths;
  });
  handle('screenshot:import',(paths,purpose='payment')=>{
    if(!Array.isArray(paths)||paths.some(file=>typeof file!=='string'||!path.isAbsolute(file)))throw new Error('请选择有效的图片文件');
    return ctx.screenshotWatcher.importFiles(paths,purpose);
  });
  handle('screenshot:paste',async(purpose='payment')=>{
    const image=clipboard.readImage();
    if(image.isEmpty())throw new Error('剪贴板中没有图片，请先在微信中复制图片');
    const temporary=path.join(store.dirs.temp,'粘贴_'+crypto.randomUUID()+'.png');
    fs.writeFileSync(temporary,image.toPNG(),{flag:'wx'});
    try{return (await ctx.screenshotWatcher.importFiles([temporary],purpose))[0];}
    finally{fs.unlinkSync(temporary);}
  });
  handle('ocr:sumLongText',text=>ocr.sumLongScreenshot(text));
  handle('ocr:parseText',text=>ocr.parseFromText(text));
  handle('ocr:recognize',file=>ocrService.recognizeAmount(file));
  handle('match:run',(invoices,screenshots)=>{
    const matched=match.matchInvoiceToScreenshots(invoices,screenshots);
    return {matched,hints:match.unmatchedHints(invoices,screenshots,matched)};
  });
  handle('material:list',()=>materials.listMaterials(store));
  handle('material:update',(type,id,patch)=>{const r=materials.updateMaterial(store,type,id,patch);ctx.notify?.('app:progress',{phase:'材料已更新'});return r;});
  handle('material:bind',(invoiceId,screenshotId)=>materials.bindPayment(store,invoiceId,screenshotId));
  handle('material:preview',(type,id)=>materials.preview(store,type,id));
  handle('material:open',async(type,id)=>{
    const record=materials.getMaterial(store,type,id);
    const error=await shell.openPath(record.file_path);
    if(error)throw new Error(error);
  });
  handle('material:reveal',(type,id)=>{
    const record=materials.getMaterial(store,type,id);
    if(!fs.existsSync(record.file_path))throw new Error('原始文件不存在');
    shell.showItemInFolder(record.file_path);
  });
  const wordSelection=payload=>{
    if(!payload||!Array.isArray(payload.invoiceIds)||new Set(payload.invoiceIds.map(Number)).size!==payload.invoiceIds.length)throw new Error('请按顺序选择发票');
    const perPage=Number(payload.perPage||store.getSettings().wordPerPage||3);
    if(![2,3].includes(perPage))throw new Error('每页只能放 2 或 3 张');
    return {payments:materials.paymentImages(store,payload.invoiceIds),perPage};
  };
  handle('word:preview',payload=>{
    const {payments,perPage}=wordSelection(payload);
    return {perPage,images:payments.map(payment=>({invoiceId:payment.invoice.id,amount:payment.invoice.amount,...materials.preview(store,'screenshot',payment.screenshot.id)}))};
  });
  handle('word:generate',async payload=>{
    const {payments,perPage}=wordSelection(payload);
    fs.mkdirSync(store.dirs.export,{recursive:true});
    const output=path.join(store.dirs.export,'支付记录_'+Date.now()+'_'+crypto.randomUUID().slice(0,8)+'.docx');
    await word.generatePaymentWord(payments.map(payment=>payment.screenshot.file_path),output,{perPage});
    return output;
  });
  handle('print:list',()=>print.listPrinters());
  handle('print:pdf',(file,printer)=>print.printPdf(file,printer));
  handle('print:image',(file,printer)=>print.printImage(file,printer));
  handle('print:word',(file,printer)=>print.printWord(file,printer));
  handle('ledger:calc',(total,day,days)=>ledger.calcTotals(total,day,days));
  handle('ledger:isTripClosed',types=>ledger.isTripClosed(types));
  handle('report:list',()=>reports.listReports(store));
  handle('report:get',id=>reports.getReport(store,id));
  handle('report:save',input=>reports.saveReport(store,input));
  handle('report:status',(id,status,payment)=>reports.setStatus(store,id,status,payment));
  handle('report:remove',id=>reports.removeReport(store,id));
  handle('report:word',(id,perPage)=>reports.generateReportWord(store,id,perPage||store.getSettings().wordPerPage));
  handle('report:export',(id,perPage)=>reports.exportPackage(store,id,perPage||store.getSettings().wordPerPage));
  handle('archive:files',(title,files,sub)=>archive.archiveFiles(title,files,sub));
  handle('app:dirs',()=>store.dirs);
  handle('app:info',()=>({version:app.getVersion(),privateConfig:store.accounts.file,dataRoot:store.dirs.root,packaged:app.isPackaged}));
  handle('app:help',async()=>{
    const file=app.isPackaged?path.join(path.dirname(process.execPath),'使用手册.html'):path.join(__dirname,'../build/使用手册.html');
    if(!fs.existsSync(file))throw new Error('使用手册缺失，源码运行请先执行 npm run docs');
    const error=await shell.openPath(file);if(error)throw new Error(error);return true;
  });
  handle('app:openDir',async directory=>{const error=await shell.openPath(directory);if(error)throw new Error(error);return true;});
  handle('mail:fetchAll',()=>ctx.fetchAll());
  handle('match:recommend',()=>{const all=materials.listMaterials(store);return require('./services/match/recommend').recommendations(all.invoices,all.screenshots);});
  let thumbnailQueue=Promise.resolve();
  handle('material:thumbnail',(type,id)=>{
    const job=thumbnailQueue.then(async()=>{
      const record=materials.getMaterial(store,type,id);let thumb=record.thumbnail_path;
      if(!thumb||!fs.existsSync(thumb)){
        if(!fs.existsSync(record.file_path))return null;
        let bytes;if(type==='invoice'){
          if(path.extname(record.file_path).toLowerCase()!=='.pdf')return null;
          bytes=(await require('./services/documents/pdf').renderPdf(record.file_path,{scale:1.1}))[0].data;
        }else bytes=fs.readFileSync(record.file_path);
        thumb=await require('./services/documents/ingest').thumbnail(store,bytes,record.content_hash||type+id);
        store.db.prepare('UPDATE '+(type==='invoice'?'invoices':'screenshots')+' SET thumbnail_path=? WHERE id=?').run(thumb,record.id);store.persist();
      }
      return 'data:image/jpeg;base64,'+fs.readFileSync(thumb).toString('base64');
    });thumbnailQueue=job.catch(()=>{});return job;
  });
  const batch=require('./services/print/batch');
  function batchOptions(){
    const options={onProgress:p=>ctx.notify?.('print:progress',p)};
    if(process.env.INVOICE_PRINT_TEST==='1'&&process.env.INVOICE_ASSISTANT_DATA_DIR&&store.dirs.root.includes(path.sep+'.qa'+path.sep))options.executor=async(file,printer)=>{fs.appendFileSync(path.join(store.dirs.root,'print-test.jsonl'),JSON.stringify({file,printer,...batch.printOptions(printer,false)})+'\n');};
    return options;
  }
  handle('print:batch',async(ids,printer,mode='invoices')=>{
    if(!batchOptions().executor&&!(await print.listPrinters()).some(p=>p.name===printer))throw new Error('指定打印机不存在，请刷新列表');
    return batch.createBatch(store,ids,printer,{...batchOptions(),mode});
  });
  handle('print:batches',()=>batch.listBatches(store));
  handle('print:qaPreview',async id=>{
    if(!batchOptions().executor)throw new Error('仅隔离测试环境可用');
    const b=batch.listBatches(store).find(b=>b.id===id);if(!b)throw new Error('批次不存在');
    return batch.nativePrint(b.pdf_path,'',store.dirs.temp,{previewOutput:path.join(store.dirs.temp,'native-print-preview.pdf')});
  });
  handle('print:retry',id=>batch.runBatch(store,id,batchOptions()));
  handle('print:resolve',(id,submitted)=>batch.resolveUncertain(store,id,!!submitted));
  handle('daily:list',()=>store.db.prepare('SELECT * FROM daily_expenses ORDER BY created_at DESC,id DESC').all());
  handle('daily:save',input=>{
    if(!input||!Array.isArray(input.items)||input.items.length>2000)throw new Error('明细无效');
    let cents=0;const items=input.items.map(item=>{const n=materials.amount(item.amount,false);if(!['expense','refund','income'].includes(item.kind))throw new Error('收支类型无效');if(item.enabled!==false)cents+=Math.round(n*100)*(item.kind==='expense'?1:item.kind==='refund'?-1:0);return {...item,amount:n};});
    const id=store.db.prepare('INSERT INTO daily_expenses(title,total,items_json,screenshot_ids_json) VALUES (?,?,?,?)').run(String(input.title||'日常开销').slice(0,100),cents/100,JSON.stringify(items),JSON.stringify(input.screenshotIds||[])).lastInsertRowid;store.persist();return id;
  });
  handle('app:relocate',async()=>{
    if(activeImports||!ctx.canRelocate())throw new Error('请等待导入、邮箱同步和打印结束');
    const picked=await dialog.showOpenDialog({title:'选择新的空资料目录',properties:['openDirectory','createDirectory']});if(picked.canceled)return false;
    const dest=picked.filePaths[0];store.persist();require('./store/storage').copyVerified(store.dirs.root,dest);
    require('./store/private-config').writeJson(require('./store/paths').PREFERENCE_FILE,{dataRoot:dest,firstLaunchDate:store.getSettings().firstLaunchDate});
    await ctx.closeWatcher();app.relaunch();app.quit();return true;
  });
}
module.exports={registerIpc};
