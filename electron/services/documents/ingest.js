'use strict';
const fs=require('fs');
const path=require('path');
const sharp=require('sharp');
const {contentHash,saveContentFile}=require('../files');
const {parseInvoice,friendlyInvoice}=require('./parse');
const {pdfText,renderPdf}=require('./pdf');
const VERSION='4';
function xmlText(value){return value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));}
function ofdPage(xml){
  const items=[];
  for(const m of xml.matchAll(/<(?:\w+:)?TextObject\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?TextObject>/g)){
    const boundary=m[1].match(/\bBoundary\s*=\s*["']([^"']+)["']/)?.[1]?.trim().split(/\s+/).map(Number);
    if(!boundary||boundary.length!==4||boundary.some(n=>!Number.isFinite(n)))continue;
    const text=[...m[2].matchAll(/<(?:\w+:)?TextCode\b[^>]*>([\s\S]*?)<\/(?:\w+:)?TextCode>/g)].map(x=>xmlText(x[1])).join('');
    const code=m[2].match(/<(?:\w+:)?TextCode\b([^>]*)>/)?.[1]||'';
    const x=Number(code.match(/\bX\s*=\s*["']([^"']+)["']/)?.[1]||0),y=Number(code.match(/\bY\s*=\s*["']([^"']+)["']/)?.[1]||0);
    if(text.trim())items.push({text,x:boundary[0]+x,y:-boundary[1]-y,width:boundary[2],height:Number(m[1].match(/\bSize\s*=\s*["']([^"']+)["']/)?.[1])||boundary[3]});
  }
  const lines=[];
  for(const item of items){let row=lines.find(r=>Math.abs(r.y-item.y)<Math.max(0.7,item.height*0.25));if(!row){row={y:item.y,items:[]};lines.push(row);}row.items.push(item);}
  for(const row of lines){row.items.sort((a,b)=>a.x-b.x);row.text=row.items.map(i=>i.text).join(' ');}
  return {width:Math.max(1,...items.map(i=>i.x+i.width)),lines:lines.sort((a,b)=>b.y-a.y)};
}
async function analyze(file,ocr){
  let text='',layout=[],source='pdf-text',notice='',thumbnail=null;
  if(path.extname(file).toLowerCase()==='.pdf'){
    try{const result=await pdfText(file);text=result.text;layout=result.pages;}
    catch(error){notice='PDF 文本读取失败：'+error.message;}
    try{
      const [page]=await renderPdf(file,{scale:1.7});thumbnail=page.data;
      if((text.replace(/\s/g,'').length<25||parseInvoice(text,layout,path.basename(file)).amount==null)&&ocr){
        const read=await ocr.readText(page.data);text+='\n'+read.text;source='pdf-text+local-ocr';
      }
    }catch(error){notice+=' 图片识别失败：'+error.message;}
  }else{
    source='ofd-text';
    try{
      const zip=await require('jszip').loadAsync(fs.readFileSync(file));
      const entries=Object.values(zip.files).filter(e=>!e.dir&&/\.xml$/i.test(e.name));
      if(entries.length>500)throw new Error('OFD 文件条目过多');
      let size=0;const parts=[];
      for(const entry of entries){
        if(entry._data?.uncompressedSize>10*1024*1024)throw new Error('OFD 内容过大');
        const xml=await entry.async('string');size+=xml.length;if(size>20*1024*1024)throw new Error('OFD 内容过大');
        const page=ofdPage(xml);
        if(page.lines.length){parts.push({xml,template:/[/\\](?:Tpls|Templates?)[/\\]/i.test(entry.name)});}
        else for(const m of xml.matchAll(/<(?:\w+:)?TextCode\b[^>]*>([\s\S]*?)<\/(?:\w+:)?TextCode>/g))text+=xmlText(m[1])+'\n';
      }
      if(parts.length){const templates=parts.filter(p=>p.template).map(p=>p.xml).join('\n');const pages=parts.filter(p=>!p.template);layout=(pages.length?pages:parts).map(p=>ofdPage(templates+'\n'+p.xml));text=layout.map(p=>p.lines.map(r=>r.text).join('\n')).join('\n');}
    }catch(error){notice='OFD 读取失败：'+error.message;}
  }
  const parsed=parseInvoice(text,layout,path.basename(file));
  return {...parsed,raw_text:text,recognition_source:source,recognition_state:parsed.amount==null?'review':'done',analysis_version:VERSION,notice:[parsed.notice,notice].filter(Boolean).join('；'),thumbnail};
}
async function thumbnail(store,data,hash){
  if(!data)return null;
  const dir=path.join(store.dirs.temp,'thumbnails');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,hash+'.jpg');
  await sharp(data).resize({width:600,height:900,fit:'inside',withoutEnlargement:true}).jpeg({quality:78}).toFile(file);
  return file;
}
function writeAnalysis(store,id,result){
  const record=store.db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  const manual=JSON.parse(record.manual_fields||'[]');
  const allowed=['amount','invoice_no','invoice_code','seller','buyer','issue_date','invoice_type','raw_text','recognition_source','recognition_state','analysis_version','document_kind','identity_key','notice','thumbnail_path'];
  const keys=allowed.filter(key=>result[key]!==undefined&&!manual.includes(key));
  if(keys.length)store.db.prepare('UPDATE invoices SET '+keys.map(key=>key+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>result[k]??null),id);
}
async function ingestOne(store,file,ocr,metadata={}){
  if(!path.isAbsolute(file)||!['.pdf','.ofd'].includes(path.extname(file).toLowerCase()))throw new Error('请选择 PDF / OFD 文件');
  const data=fs.readFileSync(file);if(data.length>80*1024*1024)throw new Error('发票文件超过 80 MB');
  const hash=contentHash(data);const existing=store.findInvoiceByHash(hash);
  if(existing)return {...existing,duplicate:true};
  const analysis=await analyze(file,ocr);
  const name=friendlyInvoice(analysis).replace(/[\\/:*?"<>|]/g,'_')+path.extname(file).toLowerCase();
  const date=analysis.issue_date||String(metadata.mail_received_at||'').slice(0,10)||'待核对';
  const saved=saveContentFile(path.join(store.dirs.inbox,date.slice(0,7)),name,data);
  analysis.thumbnail_path=await thumbnail(store,analysis.thumbnail,hash);
  const same=analysis.identity_key&&store.db.prepare('SELECT * FROM invoices WHERE identity_key=? AND duplicate_of IS NULL AND document_kind=?').get(analysis.identity_key,analysis.document_kind);
  if(same){
    store.db.transaction(()=>{
      store.db.prepare('INSERT INTO invoice_variants (invoice_id,file_path,file_name,format,content_hash,document_kind) VALUES (?,?,?,?,?,?)').run(same.id,saved.filePath,path.basename(file),path.extname(file),hash,analysis.document_kind);
      if(path.extname(file).toLowerCase()==='.pdf'&&path.extname(same.file_path).toLowerCase()!=='.pdf'){
        store.db.prepare('INSERT OR IGNORE INTO invoice_variants (invoice_id,file_path,file_name,format,content_hash,document_kind) VALUES (?,?,?,?,?,?)').run(same.id,same.file_path,same.file_name,path.extname(same.file_path),same.content_hash,same.document_kind);
        store.db.prepare('UPDATE invoices SET file_path=?,file_name=?,content_hash=? WHERE id=?').run(saved.filePath,path.basename(file),hash,same.id);
        writeAnalysis(store,same.id,analysis);
      }
    });
    return {...store.db.prepare('SELECT * FROM invoices WHERE id=?').get(same.id),duplicate:true,variant:true};
  }
  const id=store.addInvoice({...analysis,...metadata,file_path:saved.filePath,file_name:metadata.original_name||path.basename(file),content_hash:hash});
  store.db.transaction(()=>{
    writeAnalysis(store,id,analysis);
    if(metadata.mail_received_at)store.db.prepare('UPDATE invoices SET mail_received_at=? WHERE id=?').run(metadata.mail_received_at,id);
  });
  return {...store.db.prepare('SELECT * FROM invoices WHERE id=?').get(id),duplicate:false};
}
async function reanalyze(store,ocr,onProgress){
  const records=store.listInvoices().filter(row=>row.analysis_version!==VERSION);
  for(let i=0;i<records.length;i++){
    const row=records[i];
    try{
      require('../materials').assertEditable(store,'invoice',row.id);
      const result=await analyze(row.file_path,ocr);
      result.thumbnail_path=await thumbnail(store,result.thumbnail,row.content_hash||String(row.id));
      require('../materials').assertEditable(store,'invoice',row.id);
      writeAnalysis(store,row.id,result);
      const same=result.identity_key&&store.db.prepare('SELECT * FROM invoices WHERE identity_key=? AND document_kind=? AND id<>? AND duplicate_of IS NULL AND deleted_at IS NULL ORDER BY id').get(result.identity_key,result.document_kind,row.id);
      if(same){
        const pairs=store.db.prepare('SELECT * FROM invoice_payments WHERE invoice_id IN (?,?)').all(row.id,same.id);
        if(pairs.length<=1){
          const keep=path.extname(row.file_path).toLowerCase()==='.pdf'?row:same;const other=keep.id===row.id?same:row;
          store.db.transaction(()=>{
            if(pairs.length&&pairs[0].invoice_id===other.id){store.db.prepare('DELETE FROM invoice_payments WHERE invoice_id=?').run(other.id);store.db.prepare('INSERT INTO invoice_payments(invoice_id,screenshot_id) VALUES (?,?)').run(keep.id,pairs[0].screenshot_id);}
            store.db.prepare('UPDATE invoices SET duplicate_of=? WHERE id=?').run(keep.id,other.id);
          });
        }
      }
      store.persist();
    }catch(error){store.db.prepare('UPDATE invoices SET analysis_version=?,notice=? WHERE id=?').run(VERSION,'待核对：'+error.message,row.id);}
    onProgress?.({phase:'历史发票识别',done:i+1,total:records.length});
  }
  store.persist();
}
const queues=new WeakMap();
function ingestInvoice(store,...args){const job=(queues.get(store)||Promise.resolve()).then(()=>ingestOne(store,...args));queues.set(store,job.catch(()=>{}));return job;}
module.exports={ingestInvoice,analyze,reanalyze,thumbnail,VERSION};
