import React,{useEffect,useState} from 'react';
export default function WordPreview({preview,invoiceIds,perPage}){
 const [result,setResult]=useState(preview||null),[error,setError]=useState('');
 useEffect(()=>{if(preview){setResult(preview);return;}window.api.previewWord({invoiceIds,perPage}).then(setResult).catch(e=>setError(e.message));},[preview,invoiceIds,perPage]);
 const pages=[];if(result)for(let i=0;i<result.images.length;i+=result.perPage)pages.push(result.images.slice(i,i+result.perPage));
 return <div><p className="muted">A4 横向 · 每页 {result?.perPage||perPage} 张 · 等比例缩放，保留完整截图。发票和付款记录按相同顺序打印。</p>{error&&<p className="error">{error}</p>}{pages.map((page,i)=><section key={i}><p className="muted">第 {i+1} 页</p><div className="word-sheet" style={{gridTemplateColumns:'repeat('+(result?.perPage||perPage)+',1fr)'}}>{page.map(image=><div className="word-slot" key={image.invoiceId}><img src={image.dataUrl} alt="实际付款截图"/></div>)}</div></section>)}</div>;
}
