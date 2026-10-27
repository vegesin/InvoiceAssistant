'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const IMAGE=/\.(png|jpe?g|webp|bmp|gif)$/i,DOCUMENT=/\.(pdf|ofd|zip)$/i;
async function importItems(store,ocr,watcher,items,purpose='payment',invoiceId=null){
 if(!['payment','expense'].includes(purpose))throw new Error('图片用途无效');
 if(!Array.isArray(items)||!items.length)throw new Error('没有取得可读取的文件，微信图片可复制后使用“粘贴截图”');
 if(items.length>200)throw new Error('一次最多导入 200 个文件');
 for(const item of items){const name=typeof item==='string'?item:item?.name;if(!name||(!IMAGE.test(name)&&!DOCUMENT.test(name)))throw new Error('支持 PDF、OFD、ZIP 和常见图片格式');if(purpose==='expense'&&!IMAGE.test(name))throw new Error('日常开销只接收图片');}
 const records=[];
 for(const item of items){
  let source=typeof item==='string'?item:null,dir=null;
  try{
   if(!source){const bytes=Buffer.from(item.bytes||[]);if(!bytes.length||bytes.length>80*1024*1024)throw new Error('拖入的文件内容为空或超过 80 MB');dir=path.join(store.dirs.temp,'drop-'+crypto.randomUUID());fs.mkdirSync(dir,{recursive:true});source=path.join(dir,path.basename(item.name.replace(/\\/g,'/')));fs.writeFileSync(source,bytes,{flag:'wx'});}
   if(!path.isAbsolute(source)||!fs.statSync(source).isFile())throw new Error('请拖入图片或发票文件，暂不接收文件夹');
   if(IMAGE.test(source))records.push({...((await watcher.importFiles([source],purpose))[0]),materialType:'screenshot'});
   else if(/\.zip$/i.test(source)){
    const files=await require('../mail/attachments').invoiceAttachments([{filename:path.basename(source),content:fs.readFileSync(source)}]);if(!files.length)throw new Error('ZIP 内没有 PDF / OFD 发票');
    for(const file of files){const temp=path.join(store.dirs.temp,'unzip-'+crypto.randomUUID()+path.extname(file.filename));fs.writeFileSync(temp,file.content,{flag:'wx'});try{records.push({...await require('./ingest').ingestInvoice(store,temp,ocr,{original_name:file.filename}),materialType:'invoice'});}finally{fs.unlinkSync(temp);}}
   }else records.push({...await require('./ingest').ingestInvoice(store,source,ocr),materialType:'invoice'});
  }finally{if(dir&&source){if(fs.existsSync(source))fs.unlinkSync(source);fs.rmdirSync(dir);}}
 }
 let bound=false;
 if(invoiceId&&records.length===1&&records[0].materialType==='screenshot'){try{require('../materials').bindPayment(store,invoiceId,records[0].id);bound=true;}catch(error){return {records,bound:false,warning:'图片已导入，关联未完成：'+error.message};}}
 return {records,bound};
}
module.exports={importItems};
