'use strict';
const fs=require('fs');const path=require('path');
const paths=require('./paths');const {writeJson}=require('./private-config');const {localDate}=require('./dates');
function inside(file,root){const rel=path.relative(path.resolve(root),path.resolve(file));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));}
function copyVerified(source,target){
  if(inside(target,source)||inside(source,target))throw new Error('新旧资料目录不能互相包含');
  const excluded=new Set(['electron-profile','temp','Cache','Code Cache','GPUCache']);
  function copy(dir,dest,top=false){
    fs.mkdirSync(dest,{recursive:true});
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      if(top&&excluded.has(entry.name))continue;
      if(entry.isSymbolicLink())throw new Error('资料目录包含链接，迁移已停止');
      const a=path.join(dir,entry.name),b=path.join(dest,entry.name);
      if(entry.isDirectory())copy(a,b);
      else if(entry.isFile()){
        if(fs.existsSync(b))throw new Error('目标已有同名资料，请选择空文件夹');
        fs.copyFileSync(a,b,fs.constants.COPYFILE_EXCL);
        if(require('../services/files').contentHash(fs.readFileSync(a))!==require('../services/files').contentHash(fs.readFileSync(b)))throw new Error('复制校验失败，原资料仍在原处');
      }
    }
  }
  copy(source,target,true);
  writeJson(path.join(target,'migration.json'),{source:path.resolve(source),target:path.resolve(target),copiedAt:new Date().toISOString()});
}
function rewritePaths(store){
  const marker=path.join(store.dirs.root,'migration.json');if(!fs.existsSync(marker))return;
  const info=JSON.parse(fs.readFileSync(marker,'utf8'));if(info.rewritten)return;
  store.db.transaction(()=>{
    for(const [table,fields]of [['invoices',['file_path','thumbnail_path']],['screenshots',['file_path','thumbnail_path']],['invoice_variants',['file_path']],['reimbursement',['word_path','exported_path']],['print_batches',['word_path','pdf_path']],['print_jobs',['file_path']]]){
      for(const row of store.db.prepare('SELECT * FROM '+table).all())for(const field of fields){
        if(row[field]&&inside(row[field],info.source))store.db.prepare('UPDATE '+table+' SET '+field+'=? WHERE id=?').run(path.join(info.target,path.relative(info.source,row[field])),row.id);
      }
    }
  });
  writeJson(marker,{...info,rewritten:true});
}
async function chooseInitial(dialog){
  const previous=paths.preference();let root=process.env.INVOICE_ASSISTANT_DATA_DIR||previous.dataRoot;
  const firstLaunchDate=previous.firstLaunchDate||localDate();
  if(!root){
    root=path.join(paths.LAUNCHER_ROOT,'报销资料');
    try{fs.mkdirSync(root,{recursive:true});}
    catch(error){
      const picked=await dialog.showOpenDialog({title:'默认目录不可写，请选择报销资料保存位置',defaultPath:fs.existsSync('D:\\')?'D:\\':paths.LAUNCHER_ROOT,properties:['openDirectory','createDirectory']});
      if(picked.canceled)return null;
      root=path.join(picked.filePaths[0],'报销资料');
    }
  }
  root=path.resolve(root);paths.setRoot(root);
  if(!process.env.INVOICE_ASSISTANT_DATA_DIR)writeJson(paths.PREFERENCE_FILE,{dataRoot:root,firstLaunchDate});
  if(!process.env.INVOICE_ASSISTANT_DATA_DIR&&!fs.existsSync(path.join(root,'db','app.db'))&&fs.existsSync(path.join(paths.LEGACY_ROOT,'db','app.db'))){
    const answer=await dialog.showMessageBox({type:'question',title:'发现旧版资料',message:'是否把旧版资料复制到所选目录？',detail:'会校验复制结果并保留旧版原文件。邮箱私人配置一并迁移。',buttons:['复制旧资料','使用空白资料库'],defaultId:0,cancelId:1});
    if(answer.response===0)copyVerified(paths.LEGACY_ROOT,root);
  }
  return {root,firstLaunchDate};
}
function cleanEmptySpellingDirs(root){
  if(!root||!fs.existsSync(root))return;
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    if(!entry.isDirectory())continue;
    const base=path.resolve(root,entry.name);if(!inside(base,root))continue;
    const chain=['Microsoft','Spelling','neutral'];let dir=base;const dirs=[base];let valid=true;
    for(const name of chain){const children=fs.readdirSync(dir,{withFileTypes:true});if(children.length!==1||children[0].name!==name||!children[0].isDirectory()){valid=false;break;}dir=path.join(dir,name);dirs.push(dir);}
    if(valid&&fs.readdirSync(dir).length===0){for(const folder of dirs.reverse())fs.rmdirSync(folder);}
  }
}
module.exports={copyVerified,rewritePaths,chooseInitial,inside,cleanEmptySpellingDirs};
