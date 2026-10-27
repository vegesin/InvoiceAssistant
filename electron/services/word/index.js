'use strict';
const fs = require('fs');
const sharp = require('sharp');
const { Document, Packer, Paragraph, ImageRun, Table, TableRow, TableCell, WidthType, TableLayoutType, AlignmentType, VerticalAlign, BorderStyle, PageOrientation } = require('docx');

// A4 横向；页面单位 twip，ImageRun 尺寸单位 96 DPI 像素。
const PAGE = { width:16838, height:11906, top:720, bottom:720, left:720, right:720 };
const USABLE_WIDTH = PAGE.width-PAGE.left-PAGE.right;
const USABLE_HEIGHT = PAGE.height-PAGE.top-PAGE.bottom;
function fitImage(width,height,perPage=3) {
  if (![2,3].includes(perPage)) throw new Error('每页只支持 2 或 3 张付款截图');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0 || width*height>100000000) throw new Error('图片尺寸无效或过大');
  if (height/width>3.5) throw new Error('检测到长截图，请归入日常开销统计，不放入付款截图 Word');
  const maximumWidth = (Math.floor(USABLE_WIDTH/perPage)-180)/15;
  const maximumHeight = (USABLE_HEIGHT-420)/15; // 给表格、段落和行基线留出余量。
  const scale = Math.min(maximumWidth/width,maximumHeight/height);
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
async function readImage(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('图片不存在：'+filePath);
  if (fs.statSync(filePath).size>50*1024*1024) throw new Error('图片超过 50 MB');
  const {data,info}=await sharp(fs.readFileSync(filePath),{limitInputPixels:100000000,animated:false}).rotate().png().toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height};
}
async function generatePaymentWord(imagePaths,outPath,options={}) {
  if (!Array.isArray(imagePaths)||!imagePaths.length) throw new Error('请先选择发票对应的付款截图');
  const perPage=options.perPage??3;
  if (![2,3].includes(perPage)) throw new Error('每页只支持 2 或 3 张付款截图');
  const images=[];
  for (const filePath of imagePaths) {
    const image=await readImage(filePath);
    images.push({...image,...fitImage(image.width,image.height,perPage)});
  }
  const none={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
  const borders={top:none,bottom:none,left:none,right:none,insideHorizontal:none,insideVertical:none};
  const children=[];
  for(let offset=0;offset<images.length;offset+=perPage) {
    if(offset) children.push(new Paragraph({pageBreakBefore:true,spacing:{before:0,after:0},children:[]}));
    const cells=Array.from({length:perPage},(_,column)=>{
      const image=images[offset+column];
      return new TableCell({
        width:{size:Math.floor(USABLE_WIDTH/perPage),type:WidthType.DXA},
        margins:{top:0,bottom:0,left:90,right:90},borders,verticalAlign:VerticalAlign.CENTER,
        children:[new Paragraph({alignment:AlignmentType.CENTER,spacing:{before:0,after:0},children:image?[new ImageRun({type:'png',data:image.data,transformation:{width:image.width,height:image.height}})]:[]})],
      });
    });
    children.push(new Table({
      width:{size:USABLE_WIDTH,type:WidthType.DXA},columnWidths:Array(perPage).fill(Math.floor(USABLE_WIDTH/perPage)),
      layout:TableLayoutType.FIXED,borders,rows:[new TableRow({cantSplit:true,children:cells})],
    }));
  }
  const doc=new Document({
    styles:{default:{document:{run:{size:2},paragraph:{spacing:{before:0,after:0}}}}},
    // docx 在 LANDSCAPE 模式内部交换宽高，因此输入仍用竖向 A4 的基准尺寸。
    sections:[{properties:{page:{size:{width:PAGE.height,height:PAGE.width,orientation:PageOrientation.LANDSCAPE},
      margin:{top:PAGE.top,bottom:PAGE.bottom,left:PAGE.left,right:PAGE.right,header:0,footer:0}}},children}],
  });
  fs.writeFileSync(outPath,await Packer.toBuffer(doc),{flag:'wx'});
  return outPath;
}
async function generatePaymentPdf(imagePaths,outPath,options={}){
  const {PDFDocument}=require('pdf-lib');const doc=await PDFDocument.create();
  const perPage=options.perPage??3;
  for(let offset=0;offset<imagePaths.length;offset+=perPage){
    const page=doc.addPage([PAGE.width/20,PAGE.height/20]);
    for(let column=0;column<perPage&&offset+column<imagePaths.length;column++){
      const raw=await readImage(imagePaths[offset+column]);const fit=fitImage(raw.width,raw.height,perPage);
      const image=await doc.embedPng(raw.data);const w=fit.width*0.75,h=fit.height*0.75;
      const cellWidth=USABLE_WIDTH/20/perPage;
      page.drawImage(image,{x:PAGE.left/20+column*cellWidth+(cellWidth-w)/2,y:PAGE.height/20-PAGE.top/20-h,width:w,height:h});
    }
  }
  fs.writeFileSync(outPath,await doc.save(),{flag:'wx'});return outPath;
}
module.exports={generatePaymentWord,generatePaymentPdf,fitImage,PAGE,USABLE_WIDTH,USABLE_HEIGHT};
