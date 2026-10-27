const fs=require('fs');
const path=require('path');
const net=require('net');
const {spawn}=require('child_process');
const assert=require('assert/strict');
const sharp=require('sharp');
const root=path.resolve(__dirname,'..');
const qa=path.join(root,'.qa');
fs.mkdirSync(qa,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function pdf(label){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
  const stream='BT /F1 20 Tf 40 780 Td ('+label+') Tj ET';
  objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'\nendstream','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let result='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(result));result+=(index+1)+' 0 obj\n'+object+'\nendobj\n';});
  const xref=Buffer.byteLength(result);
  result+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('');
  return Buffer.from(result+'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
}
async function samples(){
  const {invoice,payment}=require('../tests/doc-fixtures.cjs');const invoices=[],payments=[];
  for(let i=1;i<=3;i++){invoices.push(await invoice(path.join(qa,'new-invoice-'+i+'.pdf'),{amount:i*10,date:'2026-10-'+(24+i),number:'1234567890123456789'+i,seller:'Test Hotel '+i}));payments.push(await payment(path.join(qa,'new-payment-'+i+'.png'),{amount:i*10,date:'2026-10-'+(24+i),merchant:'测试酒店'+i}));}
  const expense=await payment(path.join(qa,'daily-bill.png'),{daily:true});return {invoices,payments,expense};
}
async function unusedPort(){
  return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
}
async function launch(executable,dataRoot,development){
  const port=await unusedPort();
  const flags=['--remote-debugging-port='+port];
  if(process.env.INVOICE_SMOKE_RESTRICTED==='1')flags.push('--disable-gpu','--in-process-gpu','--no-sandbox');
  const env={...process.env,INVOICE_ASSISTANT_DATA_DIR:dataRoot,INVOICE_PRINT_TEST:"1"};
  if(process.env.INVOICE_TEST_TEMP){fs.mkdirSync(process.env.INVOICE_TEST_TEMP,{recursive:true});env.TEMP=process.env.INVOICE_TEST_TEMP;env.TMP=process.env.INVOICE_TEST_TEMP;}
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[...(development?[root]:[]),...flags],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let logs='';let exitCode=null;
  child.on('error',error=>{logs+=error.message;exitCode=-1;});
  child.on('exit',code=>{exitCode=code;});
  child.stderr.on('data',data=>{logs=(logs+data.toString()).slice(-8192);});child.stdout.on('data',()=>{});
  let target;
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){
    try{const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();target=list.find(target=>target.type==='page'&&target.webSocketDebuggerUrl);if(target)break;}catch(_){}
    if(exitCode!==null&&exitCode!==0)break;
    await delay(100);
  }
  if(!target){child.kill();throw new Error('未能启动程序界面。exit='+exitCode+' '+logs);}
  const socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(message.error.message)):request.resolve(message.result);}});
  const request=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},60000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const run=async expression=>{const response=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result?.value;};
  const waitFor=async expression=>{const until=Date.now()+20000;while(Date.now()<until){if(await run(expression))return;await delay(80);}throw new Error('界面等待超时：'+expression);};
  const click=async label=>{
    await waitFor('(()=>{const button=Array.from(document.querySelectorAll("button")).find(button=>button.textContent==='+JSON.stringify(label)+');return !!button&&!button.disabled;})()');
    return run('(()=>{const button=Array.from(document.querySelectorAll("button")).find(button=>button.textContent==='+JSON.stringify(label)+');button.scrollIntoView({block:"center"});button.click();})()');
  };
  const tab=async label=>{await run('Array.from(document.querySelectorAll("nav button")).find(button=>button.textContent==='+JSON.stringify(label)+').click()');await delay(120);};
  const set=async(selector,value)=>{await run('(()=>{const element=document.querySelector('+JSON.stringify(selector)+');if(!element)throw new Error("输入不存在");Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),"value").set.call(element,'+JSON.stringify(value)+');element.dispatchEvent(new Event(element.tagName==="SELECT"?"change":"input",{bubbles:true}));})()');await delay(60);};
  const capture=async file=>{const result=await request('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(file,Buffer.from(result.data,'base64'));};
  const close=async()=>{try{await Promise.race([run('window.close()'),delay(500)]);}catch(_){}socket.close();await delay(400);if(child.exitCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(2000)]);if(child.exitCode===null)child.kill();};
  return {run,waitFor,click,tab,set,capture,close,request};
}
(async()=>{
 const input=await samples(),packaged=process.argv.includes('--packaged');
 const executable=packaged?(process.env.INVOICE_TEST_EXE||JSON.parse(fs.readFileSync(path.join(qa,'latest-build.json'),'utf8')).executable):require(path.join(root,'node_modules/electron'));
 const dataRoot=path.join(qa,(packaged?'packaged':'desktop')+'-v4-'+Date.now());let app=await launch(executable,dataRoot,!packaged);let batchId;
 try{
  await app.waitFor('document.querySelector("h1")?.textContent==="发票报销助手"&&!!document.querySelector(".import-strip")');
  await app.run('window.__errors=[];window.addEventListener("error",e=>window.__errors.push(e.message));window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)))');
  assert.equal(await app.run('document.querySelectorAll("nav button").length'),2);assert.equal((await app.run('window.api.listAccounts()')).length,0);
  assert.equal((await app.run('window.api.getAppInfo()')).packaged,packaged);
  const invoices=await app.run('window.api.importInvoices('+JSON.stringify(input.invoices)+')');assert.deepEqual(invoices.map(i=>i.amount),[10,20,30]);assert.ok(invoices.every(i=>i.thumbnail_path));
  await app.waitFor('document.querySelectorAll(".invoice-card").length===3');
  await app.click('选中当前可打印的未打印发票');
  await app.click('打印所选材料');await app.waitFor('(async()=>{const b=await window.api.printBatches();return b.length===1&&b[0].status==="submitted";})()');
  const only=(await app.run('window.api.printBatches()'))[0];assert.equal(only.jobs.length,3);assert.equal(only.word_path,null);assert.ok(only.jobs.every(j=>j.kind==='invoice'));
  await app.run('document.querySelector("[aria-label=关闭]").click()');
  const drop=async(selector,files)=>{const b=await app.run('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(Math.max(120,r.y)+35)};})()');for(const type of ['dragEnter','dragOver','drop'])await app.request('Input.dispatchDragEvent',{type,x:b.x,y:b.y,data:{items:[],files,dragOperationsMask:1}});};
  await drop('[data-invoice-id="'+invoices[0].id+'"]',[input.payments[0]]);
  await app.waitFor('(async()=>{const x=await window.api.listMaterials();return !!x.invoices.find(i=>i.id==='+invoices[0].id+').screenshot_id;})()');
  await app.waitFor('!document.querySelector(".working")');
  await drop('.payment-sidebar',input.payments.slice(1));
  await app.waitFor('(async()=>{const x=await window.api.listMaterials();return x.screenshots.length===3;})()');
  await app.waitFor('!document.querySelector(".working")');
  const payments=(await app.run('window.api.listMaterials()')).screenshots.sort((a,b)=>a.amount-b.amount);assert.deepEqual(payments.map(s=>s.amount),[10,20,30]);assert.ok(payments.every(s=>s.merchant&&s.pay_date&&s.recognition_source==='local-ocr'));
  await app.run('(()=>{const bytes=Uint8Array.from(atob('+JSON.stringify(fs.readFileSync(input.payments[0]).toString('base64'))+'),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([bytes],"wechat-virtual.png",{type:"image/png"}));document.querySelector(".payment-sidebar").dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:d}));})()');
  await app.waitFor('!document.querySelector(".working")');
  assert.equal((await app.run('window.api.recommend()')).filter(r=>r.confident).length,2);
  await app.waitFor('document.querySelectorAll(".invoice-card").length===3&&document.querySelectorAll(".payment-tile").length===2');
  // 与用户从图库拖动截图相同的浏览器事件。
  await app.run('(()=>{const d=new DataTransfer();d.setData("application/x-payment-id","'+payments[0].id+'");Array.from(document.querySelectorAll(".invoice-card")).find(x=>x.dataset.invoiceId==='+JSON.stringify(String(invoices[0].id))+').dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:d}));})()');
  await app.waitFor('(async()=>{const x=await window.api.listMaterials();return x.invoices.find(i=>i.id==='+invoices[0].id+').screenshot_id==='+payments[0].id+';})()');
  for(let i=1;i<3;i++)await app.run('window.api.bindPayment('+invoices[i].id+','+payments[i].id+')');
  // 主动刷新：切换设置会让界面重新读取材料。
  await app.click('⚙ 设置');await app.waitFor('document.querySelector("[role=dialog]")!==null');
  await app.set('input[type=date]','2025-01-01');await app.click('保存设置');await app.waitFor('document.body.textContent.includes("设置已保存")');await app.run('document.querySelector("[aria-label=关闭]").click()');
  await app.waitFor('document.querySelectorAll(".invoice-card .badge.ok").length===3');await app.set('select[aria-label=打印模式]','complete');
  await app.capture(path.join(qa,packaged?'packaged-v4-invoices.png':'desktop-v4-invoices.png'));
  await app.click('预览付款排版');await app.waitFor('document.querySelectorAll(".word-slot img").length===3');await app.capture(path.join(qa,packaged?'packaged-v4-preview.png':'desktop-v4-preview.png'));await app.run('document.querySelector("[aria-label=关闭]").click()');
  const printed=await app.run('window.api.printBatch('+JSON.stringify(invoices.map(i=>i.id))+',"QA Fake Printer","complete")');batchId=printed.id;assert.equal(printed.status,'submitted');assert.equal(printed.jobs.length,4);assert.ok(fs.existsSync(printed.word_path));assert.ok(fs.existsSync(printed.pdf_path));
  const calls=fs.readFileSync(path.join(dataRoot,'print-test.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(calls.length,7);assert.ok(calls.every(c=>c.duplexMode==='simplex'));assert.ok(calls.slice(3).every(c=>c.deviceName==='QA Fake Printer'));
  const nativePreview=await app.run('window.api.qaPrintPreview('+JSON.stringify(batchId)+')');
  const previewDoc=await require('pdf-lib').PDFDocument.load(fs.readFileSync(nativePreview));assert.equal(previewDoc.getPageCount(),1,'原生打印布局不能多出空白页');assert.ok(previewDoc.getPage(0).getWidth()>previewDoc.getPage(0).getHeight());
  const printPixels=JSON.parse(fs.readFileSync(nativePreview+'.json','utf8'));assert.ok(printPixels.stats.channels[0].stdev>10,'原生打印图片不能为空白或丢失');
  await app.tab('日常开销');
  // CDP 将真实磁盘文件作为系统拖放数据，验证 preload 的文件路径提取。
  const bounds=await app.run('(()=>{const r=Array.from(document.querySelectorAll(".import-strip")).find(e=>e.getClientRects().length).getBoundingClientRect();return {x:Math.round(r.x+80),y:Math.round(r.y+30)};})()');
  for(const type of ['dragEnter','dragOver','drop'])await app.request('Input.dispatchDragEvent',{type,x:bounds.x,y:bounds.y,data:{items:[],files:[input.expense],dragOperationsMask:1}});
  await app.waitFor('document.querySelectorAll(".daily-layout tbody tr").length===4');
  await app.waitFor('document.querySelector(".daily-total strong")?.textContent==="¥18.50"');await app.click('保存核算');await app.waitFor('document.body.textContent.includes("核算已保存")');await app.capture(path.join(qa,packaged?'packaged-v4-daily.png':'desktop-v4-daily.png'));
  assert.equal((await app.run('window.api.printBatches()')).length,2);
  assert.equal((await app.run('window.api.listDaily()'))[0].total,18.5);
  assert.ok((await app.run('window.api.importScreenshots('+JSON.stringify(input.payments)+',"payment")')).every(s=>s.duplicate));
  assert.deepEqual(await app.run('window.__errors'),[]);
  fs.writeFileSync(path.join(qa,packaged?'packaged-smoke-result.json':'desktop-smoke-result.json'),JSON.stringify({passed:true,version:'0.4.0',packaged,executable,dataRoot,batchId,wordPath:printed.word_path,pdfPath:printed.pdf_path,tasks:7,invoiceOnly:true,cardFileDrop:true,galleryFileDrop:true,ocr:true,externalFileDrop:true,thumbnailDragPair:true,simplex:true},null,2));
  console.log('PASS: 两个选项卡、内置OCR、真实文件拖入、截图拖动关联、日期配置、N+1单面打印任务、日常开销合计');
 }catch(error){try{console.error('界面状态：',await app.run('document.body.textContent.slice(-1800)'));await app.capture(path.join(qa,'smoke-failure.png'));}catch(_){}throw error;}finally{await app.close();}
 app=await launch(executable,dataRoot,!packaged);
 try{await app.waitFor('!!window.api&&!!document.querySelector(".panel")');assert.equal((await app.run('window.api.getSettings()')).mailReceivedFrom,'2025-01-01');assert.equal((await app.run('window.api.listMaterials()')).invoices.length,3);assert.equal((await app.run('window.api.printBatches()'))[0].status,'submitted');assert.equal((await app.run('window.api.listDaily()')).length,1);console.log('PASS: 重启后日期配置、配对、打印进度和日常核算保留');}finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
