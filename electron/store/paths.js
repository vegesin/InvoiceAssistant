'use strict';
const path=require('path');
const os=require('os');
const fs=require('fs');
function makeDirs(root){
  const dirs={root:path.resolve(root)};
  for(const name of ['config','db','inbox','screenshots','expenses','incoming','export','temp'])dirs[name]=path.join(dirs.root,name);
  return dirs;
}
function launcherDirectory(){
  if(process.env.PORTABLE_EXECUTABLE_DIR)return path.resolve(process.env.PORTABLE_EXECUTABLE_DIR);
  if(/[\\/]app\.asar[\\/]/.test(__dirname))return path.dirname(process.execPath);
  return path.resolve(__dirname,'../..');
}
const LAUNCHER_ROOT=launcherDirectory();
const PREFERENCE_FILE=path.join(LAUNCHER_ROOT,'InvoiceAssistant.private.json');
function preference(){
  try{const data=JSON.parse(fs.readFileSync(PREFERENCE_FILE,'utf8'));return data&&typeof data==='object'?data:{};}catch(_){return {};}
}
const configured=preference().dataRoot;
const DATA_ROOT=process.env.INVOICE_ASSISTANT_DATA_DIR?path.resolve(process.env.INVOICE_ASSISTANT_DATA_DIR)
  :typeof configured==='string'&&path.isAbsolute(configured)?configured:path.join(LAUNCHER_ROOT,'报销资料');
const DIRS=makeDirs(DATA_ROOT);
function setRoot(root){for(const key of Object.keys(DIRS))delete DIRS[key];Object.assign(DIRS,makeDirs(root));}
const LEGACY_ROOT=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'InvoiceReimbursementAssistant');
module.exports={makeDirs,DATA_ROOT,DIRS,setRoot,PREFERENCE_FILE,preference,LAUNCHER_ROOT,LEGACY_ROOT};
