'use strict';
const fs=require('fs'),path=require('path'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..');
module.exports=async function afterPack(context){
 const pe=await import('pe-library'),re=await import('resedit');
 const exePath=path.join(context.appOutDir,'InvoiceAssistant.exe');
 const exe=pe.NtExecutable.from(fs.readFileSync(exePath));
 const resources=pe.NtExecutableResource.from(exe),icon=re.Data.IconFile.from(fs.readFileSync(path.join(root,'assets/brand/app.ico')));
 const groups=re.Resource.IconGroupEntry.fromEntries(resources.entries);
 if(!groups.length)throw new Error('程序缺少可替换的图标资源');
 for(const group of groups)re.Resource.IconGroupEntry.replaceIconsForResource(resources.entries,group.id,group.lang,icon.icons.map(item=>item.data));
 resources.outputResource(exe);fs.writeFileSync(exePath,Buffer.from(exe.generate()));
 const licenses=path.join(context.appOutDir,'third-party-licenses');fs.mkdirSync(licenses,{recursive:true});
 const archive=path.join(context.appOutDir,'resources/app.asar');
 const names=asar.listPackage(archive).map(name=>name.replace(/\\/g,'/').replace(/^\//,''));
 const packages=names.filter(name=>/^(?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(name)),index=[];
 for(const item of packages){
  const info=JSON.parse(asar.extractFile(archive,path.normalize(item)));const relative=path.posix.dirname(item),source=path.join(root,relative);
  const destination=path.join(licenses,relative);fs.mkdirSync(destination,{recursive:true});
  fs.writeFileSync(path.join(destination,'package.json'),JSON.stringify({name:info.name,version:info.version,license:info.license,repository:info.repository},null,2));
  const files=fs.existsSync(source)?fs.readdirSync(source).filter(name=>/^(?:licen[sc]e|notice|copying|copyright|third[-_]party)(?:[._-].*)?$/i.test(name)&&fs.statSync(path.join(source,name)).isFile()):[];
  if(info.name==='@img/sharp-win32-x64')for(const file of ['README.md','versions.json'])if(fs.existsSync(path.join(source,file)))files.push(file);
  for(const file of files)fs.copyFileSync(path.join(source,file),path.join(destination,file));
  index.push({name:info.name,version:info.version,license:info.license,files:files.map(file=>path.relative(licenses,path.join(destination,file)).replace(/\\/g,'/'))});
 }
 const extra=[['node_modules/electron/dist/LICENSE','Electron-LICENSE.txt'],['node_modules/electron/dist/LICENSES.chromium.html','LICENSES.chromium.html'],['build/fonts/OFL.txt','Noto-OFL.txt'],['build/Apache-2.0.txt','PaddleOCR-Apache-2.0.txt']];
 for(const [file,to]of extra)fs.copyFileSync(path.join(root,file),path.join(licenses,to));
 const legal=path.join(root,'build/licenses');if(fs.existsSync(legal))for(const file of fs.readdirSync(legal))fs.copyFileSync(path.join(legal,file),path.join(licenses,file));
 fs.writeFileSync(path.join(licenses,'index.json'),JSON.stringify(index.sort((a,b)=>a.name.localeCompare(b.name)),null,2));
 console.log('已设置程序图标并收集 '+index.length+' 个打包组件的版本／许可信息。');
};
