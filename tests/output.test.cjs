const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const {createRequire}=require('module');
const JSZip=require('jszip');
const sharp=require('sharp');
const {temporaryDirectory}=require('./helpers.cjs');
const {generatePaymentWord,fitImage,PAGE,USABLE_WIDTH,USABLE_HEIGHT}=require('../electron/services/word');
const {pdfPrintArgs,shellPrintScript}=require('../electron/services/print');
test('手机截图按横向 A4 栏宽和页高等比例缩放，长截图明确排除',()=>{
  for(const count of [2,3]){
    const result=fitImage(1080,2400,count);
    assert.ok(result.width<=(USABLE_WIDTH/count-180)/15);
    assert.ok(result.height<=(USABLE_HEIGHT-420)/15);
    assert.ok(Math.abs(result.width/result.height-1080/2400)<0.003);
  }
  assert.throws(()=>fitImage(1080,6000,3),/长截图/);
  assert.throws(()=>fitImage(1080,2400,4),/2 或 3/);
});
test('真实 WebP / PNG 完整嵌入，不裁切、不中途拆图，每页三张',async t=>{
  const directory=temporaryDirectory(t);
  const inputs=[];
  for(let index=0;index<7;index++){
    const file=path.join(directory,'phone'+index+(index%2?'.webp':'.png'));
    await sharp({create:{width:108,height:240,channels:3,background:{r:index*20,g:100,b:200}}}).toFormat(index%2?'webp':'png').toFile(file);
    inputs.push(file);
  }
  const output=path.join(directory,'payment.docx');
  await generatePaymentWord(inputs,output,{perPage:3});
  const zip=await JSZip.loadAsync(fs.readFileSync(output));
  const xml=await zip.file('word/document.xml').async('string');
  assert.match(xml,/w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
  assert.match(xml,/w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/);
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,3);
  assert.equal((xml.match(/<w:pageBreakBefore\/>/g)||[]).length,2);
  assert.equal((xml.match(/<a:blip /g)||[]).length,7);
  for(const file of Object.values(zip.files).filter(file=>file.name.startsWith('word/media/')&&!file.dir)){
    const info=await sharp(await file.async('nodebuffer')).metadata();
    assert.equal(info.width,108);assert.equal(info.height,240);assert.equal(info.format,'png');
  }
  await assert.rejects(generatePaymentWord(inputs,output,{perPage:3}),/EEXIST/);
});
test('每页两张可切换，空选择、缺失图片、损坏图片和长图不输出缺页文档',async t=>{
  const directory=temporaryDirectory(t);
  const file=path.join(directory,'phone.png');
  await sharp({create:{width:108,height:240,channels:3,background:'white'}}).png().toFile(file);
  const output=path.join(directory,'two.docx');
  await generatePaymentWord([file,file,file],output,{perPage:2});
  const xml=await(await JSZip.loadAsync(fs.readFileSync(output))).file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:tbl>/g)||[]).length,2);
  await assert.rejects(generatePaymentWord([],path.join(directory,'empty.docx')),/选择/);
  await assert.rejects(generatePaymentWord([path.join(directory,'missing.png')],path.join(directory,'missing.docx')),/不存在/);
  const bad=path.join(directory,'bad.png');fs.writeFileSync(bad,'bad');
  await assert.rejects(generatePaymentWord([bad],path.join(directory,'bad.docx')));
  const long=path.join(directory,'long.png');
  await sharp({create:{width:108,height:600,channels:3,background:'white'}}).png().toFile(long);
  await assert.rejects(generatePaymentWord([long],path.join(directory,'long.docx')),/长截图/);
  assert.equal(fs.existsSync(path.join(directory,'long.docx')),false);
});
test('Sumatra 默认/指定打印机参数正确，Shell 参数能保留中文和引号', () => {
  assert.deepEqual(pdfPrintArgs('D:\\测试.pdf', ''), ['-silent', '-print-to-default', 'D:\\测试.pdf']);
  assert.deepEqual(pdfPrintArgs('D:\\测试.pdf', 'HP A'), ['-silent', '-print-to', 'HP A', 'D:\\测试.pdf']);
  const script = shellPrintScript("D:\\O'Brien\\支付.docx", 'HP A');
  assert.ok(script.includes("-FilePath 'D:\\O''Brien\\支付.docx'"));
  assert.ok(script.includes('-Verb PrintTo'));
  assert.ok(script.includes("-ArgumentList '\"HP A\"'"));
  assert.ok(shellPrintScript('D:\\测试.docx', '').includes('-Verb Print '));
  assert.throws(() => shellPrintScript('D:\\test.docx', 'bad"printer'), /不支持/);
});
test('打印调用使用独立参数和编码脚本，拒绝 OFD，不实际提交打印', async t => {
  const directory = temporaryDirectory(t);
  const file = path.join(directory, '支付.docx'); fs.writeFileSync(file, 'synthetic');
  const realRequire = createRequire(path.join(__dirname, '../electron/services/print/index.js'));
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/services/print/index.js'), 'utf8'), {
    require: name => name === 'child_process' ? { execFile: (exe, args, options, callback) => { calls.push({ exe, args, options }); callback(null, '[]', ''); } } : realRequire(name),
    module, Buffer, process: { env: {} },
  });
  const result = await module.exports.printWord(file, '测试打印机');
  assert.equal(result.submitted, true);
  assert.equal(calls[0].exe, 'powershell.exe');
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes('测试打印机'));
  assert.ok(script.includes('-Verb PrintTo'));
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal((await module.exports.listPrinters()).length, 0);
  const ofd = path.join(directory, 'test.ofd'); fs.writeFileSync(ofd, 'synthetic');
  await assert.rejects(module.exports.printPdf(ofd), /OFD/);
  assert.equal(calls.length, 2);
});
