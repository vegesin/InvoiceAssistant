'use strict';
const path=require('path');
const fs=require('fs');
const {pathToFileURL}=require('url');
const sharp=require('sharp');
let engine;
async function getEngine(){
  engine ||= (async()=>{
    const {default:Ocr}=await import(pathToFileURL(require.resolve('@gutenye/ocr-node')).href);
    const base=process.resourcesPath&&fs.existsSync(path.join(process.resourcesPath,'ocr-models'))
      ?path.join(process.resourcesPath,'ocr-models'):path.join(path.dirname(require.resolve('@gutenye/ocr-models/node')),'assets');
    return Ocr.create({models:{detectionPath:path.join(base,'ch_PP-OCRv4_det_infer.onnx'),recognitionPath:path.join(base,'ch_PP-OCRv4_rec_infer.onnx'),dictionaryPath:path.join(base,'ppocr_keys_v1.txt')},
      onnxOptions:{executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1}});
  })();
  try{return await engine;}catch(error){engine=null;throw error;}
}
async function readLocalText(fileOrBuffer,onProgress){
  const data=Buffer.isBuffer(fileOrBuffer)?fileOrBuffer:fs.readFileSync(fileOrBuffer);
  if(data.length>50*1024*1024)throw new Error('图片超过 50 MB');
  const normalized=await sharp(data,{limitInputPixels:100000000}).rotate().resize({width:1280,withoutEnlargement:true}).ensureAlpha().png().toBuffer({resolveWithObject:true});
  if(normalized.info.height>60000)throw new Error('长截图超过 60000 像素，请分段导入');
  const model=await getEngine();const lines=[];let slice=0;
  for(let y=0;y<normalized.info.height;){
    const height=Math.min(1600,normalized.info.height-y);
    const image=await sharp(normalized.data).extract({left:0,top:y,width:normalized.info.width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const output=await model.detect({data:image.data,width:image.info.width,height:image.info.height});
    for(const line of output.texts||[]){
      if(!line.text?.trim())continue;
      const sx=image.info.width/output.resizedImageWidth,sy=height/output.resizedImageHeight;
      const box=(line.box||[[0,0],[0,0],[0,0],[0,0]]).map(([x,localY])=>[x*sx,localY*sy+y]);
      const center=(box[0][1]+box[2][1])/2;
      if(lines.some(previous=>previous.text===line.text&&Math.abs(previous.center-center)<Math.max(14,Math.abs(box[2][1]-box[0][1])*0.7)))continue;
      lines.push({text:line.text.trim(),confidence:line.mean,box,center});
    }
    onProgress?.(++slice);
    if(y+height>=normalized.info.height)break;
    y+=height-72;
  }
  lines.sort((a,b)=>a.center-b.center||a.box[0][0]-b.box[0][0]);
  return {text:lines.map(line=>line.text).join('\n'),lines};
}
module.exports={readLocalText,getEngine};
