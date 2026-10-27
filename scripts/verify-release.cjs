const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.qa'),build=JSON.parse(fs.readFileSync(path.join(qa,'latest-build.json'),'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const inputs=[];function gather(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())gather(f);else inputs.push(f);}}
for(const dir of ['electron','renderer/src','build'])gather(path.join(root,dir));inputs.push(path.join(root,'package.json'),path.join(root,'package-lock.json'),path.join(root,'electron-builder.config.cjs'));
const inputDigest=hash(Buffer.from(inputs.sort().map(f=>path.relative(root,f)+':'+hash(fs.readFileSync(f))).join('\n')));
const sums=fs.readFileSync(path.join(root,'release/SHA256SUMS.txt'),'utf8').trim().split('\n');const artifacts={};
for(const line of sums){const [expected,name]=line.split('  '),bytes=fs.readFileSync(path.join(root,'release',name));assert.equal(bytes.subarray(0,2).toString(),'MZ');assert.equal(hash(bytes),expected);artifacts[name]=expected;}
const auditFile=path.join(qa,'release-audit.json');
if(build.cleaned){const audit=JSON.parse(fs.readFileSync(auditFile,'utf8'));assert.ok(audit.passed);assert.equal(audit.inputDigest,inputDigest,'源码或构建资源已改变，请重新构建');assert.deepEqual(audit.artifactHashes,artifacts);console.log(JSON.stringify({...audit,publishedChecksumVerified:true,stagingRemoved:true},null,2));process.exit(0);}
const archive=path.join(path.dirname(build.executable),'resources/app.asar'),names=asar.listPackage(archive).map(n=>n.replace(/\\/g,'/'));
const forbidden=names.filter(n=>/^\/(?:data|\.qa|\.private-backups|tests|scripts|release)(?:\/|$)/.test(n)||/(?:^|\/)(?:accounts\.private\.json|\.key|app\.db)$/.test(n));assert.deepEqual(forbidden,[]);
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,'0.4.0');const sources=inputs.filter(f=>f.startsWith(path.join(root,'electron')+path.sep)&&f.endsWith('.js'));
for(const f of sources)assert.deepEqual(asar.extractFile(archive,path.relative(root,f)),fs.readFileSync(f));
for(const f of ['node_modules/sql.js/dist/sql-wasm.wasm','node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node','node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node','node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime.dll'])assert.ok(fs.existsSync(path.join(archive+'.unpacked',f)),f);
assert.ok(names.some(n=>n.endsWith('/skia.win32-x64-msvc.node')));
for(const n of ['ch_PP-OCRv4_det_infer.onnx','ch_PP-OCRv4_rec_infer.onnx','ppocr_keys_v1.txt'])assert.equal(hash(fs.readFileSync(path.join(root,'node_modules/@gutenye/ocr-models/assets',n))),hash(fs.readFileSync(path.join(path.dirname(archive),'ocr-models',n))));
assert.equal(hash(fs.readFileSync(path.join(root,'build/fonts/NotoSansCJKsc-Regular.otf'))),hash(fs.readFileSync(path.join(path.dirname(archive),'fonts/NotoSansCJKsc-Regular.otf'))));
for(const n of ['msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll'])assert.ok(fs.existsSync(path.join(path.dirname(build.executable),n)));
assert.ok(build.artifacts.every(f=>/Portable\.exe$/.test(f)));
const report={version:'0.4.0',sourceFilesVerified:sources.length,privateFiles:forbidden,artifacts:sums.length,portableOnly:true,offlineOcrModels:true,chineseFallbackFont:true,inputDigest,artifactHashes:artifacts,passed:true};fs.writeFileSync(auditFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
