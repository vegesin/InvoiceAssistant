'use strict';
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const {createCanvas,DOMMatrix,ImageData,Path2D}=require('@napi-rs/canvas');
class PdfMatrix extends DOMMatrix {
  invertSelf(){
    const {a,b,c,d,e,f}=this,det=a*d-b*c;
    if(!Number.isFinite(det)||det===0){this.a=this.b=this.c=this.d=this.e=this.f=NaN;return this;}
    this.a=d/det;this.b=-b/det;this.c=-c/det;this.d=a/det;
    this.e=(c*f-d*e)/det;this.f=(b*e-a*f)/det;return this;
  }
  inverse(){return new PdfMatrix([this.a,this.b,this.c,this.d,this.e,this.f]).invertSelf();}
}
function canvasForPdf(width,height){
  const canvas=createCanvas(width,height),context=canvas.getContext('2d');
  const put=context.putImageData.bind(context),get=context.getImageData.bind(context);
  const transform=context.getTransform.bind(context);
  context.getTransform=()=>{const m=transform();return new PdfMatrix([m.a,m.b,m.c,m.d,m.e,m.f]);};
  // Electron 的 V8 沙箱会复制原生 ImageData.data。用 JS 持有可写缓冲，
  // 提交时重新构造 ImageData，保证 PDF 中嵌入的手机截图和扫描图完整渲染。
  context.createImageData=(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
  context.getImageData=(...args)=>{const d=get(...args);return {data:Uint8ClampedArray.from(d.data),width:d.width,height:d.height};};
  context.putImageData=(d,...args)=>put(new ImageData(d.data,d.width,d.height),...args);
  return {canvas,context};
}
class PdfCanvasFactory{
  create(width,height){return canvasForPdf(width,height);}
  reset(target,width,height){target.canvas.width=width;target.canvas.height=height;}
  destroy(target){target.canvas.width=0;target.canvas.height=0;target.canvas=null;target.context=null;}
}
let pdfModule;
async function engine(){
  process.getBuiltinModule ||= name=>require(name);
  global.DOMMatrix ||= PdfMatrix;global.ImageData ||= ImageData;global.Path2D ||= Path2D;
  pdfModule ||= import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfModule;
}
async function openPdf(fileOrBytes,options={}){
  const pdf=await engine();
  const bytes=typeof fileOrBytes==='string'?fs.readFileSync(fileOrBytes):fileOrBytes;
  if(bytes.length>80*1024*1024)throw new Error('PDF 超过 80 MB');
  const base=path.dirname(require.resolve('pdfjs-dist/package.json'));
  return pdf.getDocument({data:new Uint8Array(bytes),CanvasFactory:PdfCanvasFactory,useSystemFonts:true,isEvalSupported:false,verbosity:0,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,
    cMapUrl:path.join(base,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(base,'standard_fonts')+path.sep,disableFontFace:true,...options}).promise;
}
function textLines(items){
  const lines=[];
  for(const item of items){
    if(!('str'in item)||!item.str.trim())continue;
    const x=item.transform[4],y=item.transform[5];
    let line=lines.find(line=>Math.abs(line.y-y)<Math.max(2,Math.abs(item.height||8)*0.32));
    if(!line){line={y,items:[]};lines.push(line);}
    line.items.push({text:item.str,x,y,width:item.width||0,height:item.height||10});
  }
  return lines.sort((a,b)=>b.y-a.y).map(line=>({...line,items:line.items.sort((a,b)=>a.x-b.x),
    text:line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ').replace(/\s+/g,' ').trim()}));
}
async function pdfText(file){
  const doc=await openPdf(file);
  try{
    if(doc.numPages>100)throw new Error('PDF 页数超过 100，请拆分后导入');
    const pages=[];
    for(let n=1;n<=Math.min(doc.numPages,5);n++){
      const page=await doc.getPage(n);const viewport=page.getViewport({scale:1});
      const content=await page.getTextContent();
      pages.push({width:viewport.width,height:viewport.height,lines:textLines(content.items)});
      page.cleanup();
    }
    return {text:pages.map(page=>page.lines.map(line=>line.text).join('\n')).join('\n'),pages,pageCount:doc.numPages};
  }finally{await doc.destroy();}
}
const installedFonts=new Set();
function registerPageFonts(page,operators,registered,keys){
 const fonts=require('@napi-rs/canvas').GlobalFonts;
 const fallback=process.resourcesPath&&fs.existsSync(path.join(process.resourcesPath,'fonts/NotoSansCJKsc-Regular.otf'))?path.join(process.resourcesPath,'fonts/NotoSansCJKsc-Regular.otf'):path.resolve(__dirname,'../../../build/fonts/NotoSansCJKsc-Regular.otf');
 for(const args of operators.argsArray){
  const id=args?.[0];if(typeof id!=='string'||!id.startsWith('g_')||registered.has(id))continue;
  let font;try{font=page.commonObjs.get(id);}catch(_){continue;}if(!font?.loadedName||font.isType3Font)continue;registered.add(id);
  let key=null;if(font.data?.length)key=fonts.register(Buffer.from(font.data),font.loadedName);
  if(key){keys.push(key);continue;}
  if(installedFonts.has(font.loadedName))continue;
  const name=font.name||font.loadedName;
  const filename=/KaiTi|楷体/i.test(name)?'simkai.ttf':/SimHei|黑体/i.test(name)?'simhei.ttf':/SimSun|宋体/i.test(name)?'simsun.ttc':/DengXian/i.test(name)?'Deng.ttf':/YaHei/i.test(name)?'msyh.ttc':/Courier/i.test(name)?'cour.ttf':/Times/i.test(name)?'times.ttf':/Helvetica|Arial/i.test(name)?'arial.ttf':null;
  const system=filename&&path.join(process.env.WINDIR||'C:/Windows','Fonts',filename);
  key=fonts.registerFromPath(system&&fs.existsSync(system)?system:fallback,font.loadedName);
  if(!key)throw new Error('票据字体无法加载：'+name);
  installedFonts.add(font.loadedName);
 }
}
async function renderPdf(file,{scale=1.5,pages=[1],maxPixels=18000000}={}){
 const doc=await openPdf(file,{disableFontFace:false,fontExtraProperties:true}),fontKeys=[];const registered=new Set();
 try{
  const numbers=pages==='all'?Array.from({length:doc.numPages},(_,i)=>i+1):pages;if(numbers.length>30)throw new Error('单份文件超过 30 页，请拆分后打印');
  const results=[];for(const n of numbers){
   const page=await doc.getPage(n),operators=await page.getOperatorList();registerPageFonts(page,operators,registered,fontKeys);
   let viewport=page.getViewport({scale});if(viewport.width*viewport.height>maxPixels)viewport=page.getViewport({scale:scale*Math.sqrt(maxPixels/(viewport.width*viewport.height))});
   const {canvas,context}=canvasForPdf(Math.ceil(viewport.width),Math.ceil(viewport.height));context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
   await page.render({canvasContext:context,viewport,background:'white'}).promise;
   results.push({data:canvas.toBuffer('image/png'),width:canvas.width,height:canvas.height,page:n});page.cleanup();
  }return results;
 }finally{await doc.destroy();if(fontKeys.length)require('@napi-rs/canvas').GlobalFonts.removeBatch(fontKeys);}
}
module.exports={pdfText,renderPdf,textLines,PdfMatrix,openPdf,canvasForPdf};
