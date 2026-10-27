'use strict';
const {app,BrowserWindow,dialog}=require('electron');const fs=require('fs');const path=require('path');
const paths=require('./store/paths');const {Store}=require('./store');const storage=require('./store/storage');
app.on('session-created',session=>session.setSpellCheckerEnabled(false));
let profile=path.join(paths.DATA_ROOT,'temp','runtime');
try{fs.mkdirSync(profile,{recursive:true});}catch(_){profile=path.join(app.getPath('temp'),'InvoiceAssistant-runtime-'+process.pid);fs.mkdirSync(profile,{recursive:true});}
app.setPath('userData',profile);
// Windows 原生组件可能按工作目录创建运行文件，将其限制在缓存目录。
process.chdir(profile);
let store,watcher,timer,quitting=false,mailBusy=false;
const single=app.requestSingleInstanceLock();if(!single)app.quit();
function notify(channel,payload){for(const win of BrowserWindow.getAllWindows())if(!win.isDestroyed())win.webContents.send(channel,payload);}
function createWindow(){
  const win=new BrowserWindow({width:1380,height:900,minWidth:1050,minHeight:720,icon:path.join(__dirname,'../assets/brand/icon-256.png'),backgroundColor:'#f4f6f8',webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(url!==win.webContents.getURL())event.preventDefault();});
  if(process.argv.includes('--dev'))win.loadURL('http://localhost:5173');else win.loadFile(path.join(__dirname,'../dist/renderer/index.html'));
  return win;
}
app.on('second-instance',()=>{const win=BrowserWindow.getAllWindows()[0];if(win){if(win.isMinimized())win.restore();win.focus();}});
if(single)app.whenReady().then(async()=>{
  const chosen=await storage.chooseInitial(dialog);if(!chosen){app.quit();return;}
  store=await Store.create(chosen);storage.rewritePaths(store);
  process.chdir(store.dirs.temp);
  store.db.exec("UPDATE print_jobs SET state='uncertain' WHERE state='submitting'; UPDATE print_batches SET status='failed',error='上次打印被中断，请查看系统队列' WHERE status='printing'");store.persist();
  const ocr=new(require('./services/ocr').OcrService)();
  watcher=require('./services/watcher').startScreenshotWatcher(store,ocr,{onNew:rec=>notify('screenshot:new',rec),onError:err=>notify('screenshot:error',err)});
  const fetchOne=id=>{
    const account=store.getAccount(Number(id));if(!account)throw new Error('邮箱账号不存在');
    return require('./services/mail').fetchInvoices(account,store,{ocr,onInvoice:p=>notify('mail:onInvoice',p),onMail:p=>notify('mail:onMail',p)});
  };
  async function fetchAll(){
    if(mailBusy)return {busy:true};mailBusy=true;let downloaded=0;const errors=[];
    try{
      const accounts=store.listAccounts().filter(a=>a.enabled!==0&&a.has_token);if(!accounts.length)return {downloaded:0,message:'请先在设置中添加邮箱'};
      for(const a of accounts){notify('app:progress',{phase:'收取邮箱发票',name:a.email});try{const r=await fetchOne(a.id);downloaded+=r.downloaded;}catch(error){errors.push(a.email+'：'+error.message);}}
      notify('app:progress',errors.length?{error:errors.join('；')}:{phase:'邮箱同步完成',downloaded});return {downloaded,errors};
    }finally{mailBusy=false;}
  }
  require('./ipc').registerIpc({store,ocrService:ocr,screenshotWatcher:watcher,fetchOne,fetchAll,notify,canRelocate:()=>!mailBusy&&!store.printing,closeWatcher:()=>watcher.close()});
  const win=createWindow();
  win.webContents.once('did-finish-load',()=>{
    require('./services/documents/ingest').reanalyze(store,ocr,p=>notify('app:progress',p)).then(()=>require('./services/watcher').reanalyzeScreenshots(store,ocr,p=>notify('app:progress',p))).then(()=>notify('app:progress',{phase:'资料已就绪'})).catch(e=>notify('app:progress',{error:e.message}));
    if(store.getSettings().autoFetchWhenOpen)fetchAll().catch(e=>notify('app:progress',{error:e.message}));
  });
  timer=setInterval(()=>{if(store.getSettings().autoFetchWhenOpen)fetchAll().catch(e=>notify('app:progress',{error:e.message}));},5*60*1000);
}).catch(e=>{dialog.showErrorBox('启动失败',e.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(quitting)return;event.preventDefault();quitting=true;clearInterval(timer);
  Promise.resolve(watcher?.close()).then(()=>{store?.db.close();storage.cleanEmptySpellingDirs(store?.dirs.temp);storage.cleanEmptySpellingDirs(profile);}).catch(e=>dialog.showErrorBox('保存数据失败',e.message)).finally(()=>app.quit());
});
