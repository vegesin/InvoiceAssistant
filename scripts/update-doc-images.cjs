'use strict';
const fs=require('fs'),path=require('path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.qa');
async function main(){
 const report=JSON.parse(fs.readFileSync(path.join(qa,'desktop-smoke-result.json'),'utf8'));
 if(!report.passed||report.packaged||!path.resolve(report.dataRoot).startsWith(qa+path.sep+'desktop-v4-'))throw new Error('请先运行合成材料桌面测试');
 const pdf=path.resolve(report.pdfPath);
 if(!pdf.startsWith(path.resolve(report.dataRoot)+path.sep))throw new Error('拒绝读取隔离测试之外的文件');
 for(const [from,to]of [['desktop-v4-invoices.png','invoices.png'],['desktop-v4-daily.png','daily.png'],['desktop-deleted.png','deleted-invoices.png']])await sharp(path.join(qa,from)).resize({width:1380,withoutEnlargement:true}).png().toFile(path.join(root,'docs/images',to));
 const [page]=await require('../electron/services/documents/pdf').renderPdf(pdf,{scale:1.6});
 await sharp(page.data).resize({width:1380,withoutEnlargement:true}).png().toFile(path.join(root,'docs/images/payment-layout.png'));
 console.log('文档配图已更新：合成发票界面、日常核算、完整付款打印页面。');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
