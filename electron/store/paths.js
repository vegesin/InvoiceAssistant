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
  return path.resolve(__dirname,'../../release');
}
const LAUNCHER_ROOT=launcherDirectory();
const PREFERENCE_FILE=path.join(LAUNCHER_ROOT,'InvoiceAssistant.private.json');
function preference(){
  try{const data=JSON.parse(fs.readFileSync(PREFERENCE_FILE,'utf8'));return data&&typeof data==='object'?data:{};}catch(_){return {};}
}
function resolveDataRoot(value){
  return path.resolve(module.exports.LAUNCHER_ROOT,typeof value==='string'&&value.trim()?value:'InvoiceData');
}
function storedDataRoot(root){
  const base=module.exports.LAUNCHER_ROOT,relative=path.relative(base,path.resolve(root));
  return !relative?'.':!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)?relative.replace(/\\/g,'/'):path.resolve(root);
}
// Initialize exports before resolving paths; helpers also honor test/launcher overrides.
module.exports.LAUNCHER_ROOT=LAUNCHER_ROOT;
const configured=preference().dataRoot;
const DATA_ROOT=process.env.INVOICE_ASSISTANT_DATA_DIR?path.resolve(process.env.INVOICE_ASSISTANT_DATA_DIR)
  :resolveDataRoot(configured);
const DIRS=makeDirs(DATA_ROOT);
function setRoot(root){for(const key of Object.keys(DIRS))delete DIRS[key];Object.assign(DIRS,makeDirs(root));}
const LEGACY_ROOT=path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'InvoiceReimbursementAssistant');
module.exports={makeDirs,DATA_ROOT,DIRS,setRoot,PREFERENCE_FILE,preference,LAUNCHER_ROOT,LEGACY_ROOT,resolveDataRoot,storedDataRoot};
