'use strict';
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'assets/brand');
async function main(){
 const icon=fs.readFileSync(path.join(dir,'icon.svg'),'utf8').replace(/<\?xml[^>]*>/g,'');
 const inner=icon.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').replace(/<title[^>]*>[\s\S]*?<\/title>/,'');
 for(const size of [256,512])await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(dir,'icon-'+size+'.png'));
 const parts=[];for(const size of [16,24,32,48,64,128,256])parts.push({size,data:await sharp(Buffer.from(icon)).resize(size,size).png().toBuffer()});
 const header=Buffer.alloc(6+parts.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(parts.length,4);let offset=header.length;
 parts.forEach((p,i)=>{const at=6+i*16;header[at]=p.size===256?0:p.size;header[at+1]=header[at];header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(p.data.length,at+8);header.writeUInt32LE(offset,at+12);offset+=p.data.length;});
 fs.writeFileSync(path.join(dir,'app.ico'),Buffer.concat([header,...parts.map(p=>p.data)]));
 for(const dark of [false,true]){
  const name=dark?'wordmark-dark':'wordmark';const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="240" viewBox="0 0 1120 240" role="img" aria-label="发票报销助手 Invoice Reimbursement Assistant"><g transform="translate(16 16) scale(.203125)">'+inner+'</g><text x="268" y="119" font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="76" font-weight="700" fill="'+(dark?'#EDF5F0':'#20383C')+'">发票报销助手</text><text x="272" y="178" font-family="Segoe UI,Arial,sans-serif" font-size="26" letter-spacing="1.4" fill="'+(dark?'#ACCCC3':'#6B8585')+'">INVOICE REIMBURSEMENT ASSISTANT</text></svg>';
  fs.writeFileSync(path.join(dir,name+'.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(path.join(dir,name+'.png'));
 }
 const social='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" rx="0" fill="#F4F8F5"/><circle cx="1100" cy="80" r="390" fill="#E6F0E8"/><g transform="translate(846 156) scale(.25)">'+inner+'</g><rect x="72" y="91" width="92" height="5" rx="2.5" fill="#176D69"/><text x="72" y="229" font-family="Microsoft YaHei,sans-serif" font-size="70" font-weight="700" fill="#20383C">发票报销助手</text><text x="76" y="311" font-family="Microsoft YaHei,sans-serif" font-size="32" fill="#5C7478">把材料配齐，一次打印</text><text x="76" y="425" font-family="Microsoft YaHei,sans-serif" font-size="22" fill="#176D69">发票与付款截图 · 单面批量打印 · 日常开销核算</text><text x="76" y="544" font-family="Segoe UI,Arial,sans-serif" font-size="17" letter-spacing="2.1" fill="#7D9191">WINDOWS  /  PORTABLE  /  LOCAL OCR</text></svg>';
 fs.writeFileSync(path.join(dir,'social-preview.svg'),social);await sharp(Buffer.from(social)).png().toFile(path.join(dir,'social-preview.png'));
 console.log('品牌资源已生成：SVG、PNG、7 个尺寸的 ICO 和分享预览图。');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
