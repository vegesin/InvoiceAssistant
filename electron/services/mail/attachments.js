'use strict';
const path=require('path');
const Zip=require('jszip');
const MAX_BYTES=80*1024*1024,MAX_TOTAL=160*1024*1024,MAX_FILES=200;
async function invoiceAttachments(attachments){
  const output=[];let expanded=0,entries=0;
  async function visit(name,bytes,depth=0){
    const ext=path.extname(name).toLowerCase();
    if(!['.pdf','.ofd','.zip'].includes(ext))return;
    if(bytes.length>MAX_BYTES)throw new Error('发票附件超过 80 MB');
    if(ext!=='.zip'){expanded+=bytes.length;if(expanded>MAX_TOTAL)throw new Error('附件展开总大小超过 160 MB');output.push({filename:path.basename(name.replace(/\\/g,'/')),content:bytes});return;}
    if(depth>1)throw new Error('发票压缩包嵌套过深');
    let zip;try{zip=await Zip.loadAsync(bytes);}catch(_){throw new Error('发票 ZIP 无法读取，请检查是否损坏或加密');}
    for(const item of Object.values(zip.files)){
      if(item.dir)continue;if(++entries>MAX_FILES)throw new Error('发票压缩包文件过多');
      if(!/\.(pdf|ofd|zip)$/i.test(item.name))continue;
      if((item._data?.uncompressedSize||0)>MAX_BYTES)throw new Error('压缩包中的发票超过 80 MB');
      await visit(item.name,await item.async('nodebuffer'),depth+1);
    }
  }
  for(const a of attachments||[])if(a.filename)await visit(a.filename,a.content);
  return output.sort((a,b)=>Number(/\.ofd$/i.test(a.filename))-Number(/\.ofd$/i.test(b.filename)));
}
module.exports={invoiceAttachments};
