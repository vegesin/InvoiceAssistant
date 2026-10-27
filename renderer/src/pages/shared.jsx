import React,{useEffect,useState} from 'react';
export const money=n=>n===null||n===undefined||n===''?'金额待核对':'¥'+Number(n).toFixed(2);
export function Thumb({type,record,onClick,draggable=false}){
 const [src,setSrc]=useState(null);
 useEffect(()=>{let alive=true;window.api.thumbnail(type,record.id).then(s=>{if(alive)setSrc(s);}).catch(()=>{});return()=>{alive=false;};},[type,record.id,record.thumbnail_path]);
 return <div className={'thumbnail '+type} onClick={onClick} draggable={draggable} onDragStart={e=>{e.dataTransfer.setData('application/x-payment-id',String(record.id));e.dataTransfer.effectAllowed='link';}}>{src?<img src={src} alt={type==='invoice'?'发票预览':'支付记录预览'} loading="lazy"/>:<span>{type==='invoice'?'PDF':'图片'}<small>打开核对</small></span>}</div>;
}
export function Modal({title,onClose,children,wide=false}){return <div className="overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className={'modal '+(wide?'wide':'')} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}>×</button></div>{children}</section></div>;}
export function isFileDrop(e){return Array.from(e.dataTransfer.types||[]).includes('Files')||Array.from(e.dataTransfer.items||[]).some(i=>i.kind==='file');}
export async function filesFromDrop(e){
 e.preventDefault();e.stopPropagation();
 const files=Array.from(e.dataTransfer.files||[]);if(!files.length)for(const item of Array.from(e.dataTransfer.items||[])){if(item.kind==='file'){const file=item.getAsFile();if(file)files.push(file);}}
 if(!files.length)throw new Error('没有取得可读取的文件；微信图片请复制后点击“粘贴截图”');
 const result=[];for(const file of files){let p='';try{p=window.api.filePath(file);}catch(_){}if(p){result.push(p);continue;}if(file.size>80*1024*1024)throw new Error('单个文件超过 80 MB');const bytes=new Uint8Array(await file.arrayBuffer());if(!bytes.length)throw new Error('拖入文件没有可读取内容；微信图片请复制后粘贴');result.push({name:file.name,bytes});}return result;
}
export function Detail({type,record,onClose,onSave}){
 const invoice=type==='invoice';const [form,setForm]=useState({...record}),[src,setSrc]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{window.api.previewMaterial(type,record.id).then(p=>{if(p.mime?.startsWith('image/'))setSrc(p.dataUrl);else window.api.thumbnail(type,record.id).then(setSrc);}).catch(e=>setError(e.message));},[type,record.id]);
 const fields=invoice?[['seller','商户 / 销售方'],['amount','发票金额'],['issue_date','开票日期'],['invoice_no','发票号码'],['invoice_type','类型']]:[['merchant','商户'],['amount','实际付款金额'],['pay_date','支付日期'],['purpose','图片用途']];
 async function save(){setSaving(true);try{const patch=Object.fromEntries(fields.map(([key])=>[key,form[key]??'']));await window.api.updateMaterial(type,record.id,patch);await onSave();onClose();}catch(e){setError(e.message);}finally{setSaving(false);}}
 return <Modal title={invoice?'核对发票':'核对实际付款截图'} onClose={onClose} wide><div className="detail-layout"><div className="detail-image">{src?<img src={src} alt="原件预览"/>:<p>此格式请打开原件查看</p>}</div><div><p className="muted">识别不完整时可直接修正，修改后的字段会保留。</p><div className="form-grid">{fields.map(([key,label])=><label className="field" key={key}>{label}{key==='purpose'?<select value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})}><option value="payment">发票付款截图</option><option value="expense">日常开销账单</option></select>:<input value={form[key]??''} type={key==='amount'?'number':key.includes('date')?'date':'text'} step="0.01" min={key==='amount'?0:undefined} onChange={e=>setForm({...form,[key]:e.target.value})}/>}</label>)}</div>{record.notice&&<p className="notice">{record.notice}</p>}{error&&<p className="error" role="alert">{error}</p>}<div className="actions"><button className="btn primary" onClick={save} disabled={saving}>保存核对结果</button><button className="btn" onClick={()=>window.api.openMaterial(type,record.id).catch(e=>setError(e.message))}>打开原件</button><button className="btn" onClick={()=>window.api.revealMaterial(type,record.id).catch(e=>setError(e.message))}>所在文件夹</button></div><details><summary>识别原文与原始文件名</summary><p className="break">{record.file_name}</p><pre>{record.raw_text||'暂无识别文本'}</pre></details></div></div></Modal>;
}
