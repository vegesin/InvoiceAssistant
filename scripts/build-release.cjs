const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const env={...process.env,ELECTRON_BUILDER_CACHE:path.join(root,'.qa','builder-cache'),ELECTRON_CACHE:path.join(root,'.qa','electron-cache'),CSC_IDENTITY_AUTO_DISCOVERY:'false'};
function run(script,args){
  const result=spawnSync(process.execPath,[script,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
run(path.join(root,'node_modules/vite/bin/vite.js'),['build']);
const config=require('../electron-builder.config.cjs');
const staging=path.join(root,'.qa','build-'+Date.now());
config.directories.output=staging;
const configFile=path.join(root,'.qa','release-config.json');
fs.mkdirSync(path.dirname(configFile),{recursive:true});
fs.writeFileSync(configFile,JSON.stringify(config,null,2));
run(path.join(root,'node_modules/electron-builder/cli.js'),['--config',configFile,'--win','--x64',...(process.argv.includes('--dir')?['--dir']:[])]);
const release=path.join(root,'release');
fs.mkdirSync(release,{recursive:true});
const artifacts=fs.readdirSync(staging).filter(file=>/\.exe(?:\.blockmap)?$/.test(file));
for(const file of artifacts)fs.copyFileSync(path.join(staging,file),path.join(release,file));
fs.copyFileSync(path.join(root,'build/使用说明.txt'),path.join(release,'使用说明.txt'));
const hashes=artifacts.filter(file=>file.endsWith('.exe')).map(file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(release,file))).digest('hex')+'  '+file);
if(hashes.length)fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),hashes.join('\n')+'\n');
fs.writeFileSync(path.join(root,'.qa/latest-build.json'),JSON.stringify({staging,executable:path.join(staging,'win-unpacked','InvoiceAssistant.exe'),artifacts:artifacts.map(file=>path.join(release,file))},null,2));
console.log('构建完成：'+release);
