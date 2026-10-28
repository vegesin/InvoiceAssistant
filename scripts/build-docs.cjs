'use strict';
const fs=require('fs'),path=require('path'),MarkdownIt=require('markdown-it');
const root=path.resolve(__dirname,'..'),docs=path.join(root,'docs'),out=path.join(root,'build');
const {version}=require('../package.json');
const md=new MarkdownIt({html:false,linkify:false,typographer:false}),escape=md.utils.escapeHtml;
const tokens=md.parse(fs.readFileSync(path.join(docs,'USER_GUIDE.md'),'utf8'),{}),toc=[];let heading=0;
const manualEnd=tokens.length;
for(const [file,id]of [['FAQ.md','faq'],['PRIVACY.md','privacy']]){
 const extra=md.parse(fs.readFileSync(path.join(docs,file),'utf8'),{});extra[0].attrSet('id',id);tokens.push(...extra);
}
for(let i=0;i<tokens.length;i++){
 if(tokens[i].type==='heading_open'){
  const id=tokens[i].attrGet('id')||'section-'+(++heading);tokens[i].attrSet('id',id);
  if((i<manualEnd&&tokens[i].tag==='h2')||id==='faq'||id==='privacy')toc.push({id,title:tokens[i+1].content});
 }
 // Local Markdown links point to source guidance; the portable manual embeds its images.
 if(tokens[i].children)for(const token of tokens[i].children){
  if(token.type==='link_open'&&/\.md(?:#.*)?$/i.test(token.attrGet('href')||'')){
   const targets={'USER_GUIDE.md':'#section-1','FAQ.md':'#faq','PRIVACY.md':'#privacy','README.md':'#section-1'};
   token.attrSet('href',targets[path.basename(token.attrGet('href'))]||'#source-docs');
  }
  if(token.type==='image'){
   const file=path.resolve(docs,token.attrGet('src'));
   if(!file.startsWith(docs+path.sep)||!fs.existsSync(file))throw new Error('手册图片缺失或越界：'+token.attrGet('src'));
   token.attrSet('src','data:image/png;base64,'+fs.readFileSync(file).toString('base64'));
  }
 }
}
const logo='data:image/png;base64,'+fs.readFileSync(path.join(root,'assets/brand/icon-256.png')).toString('base64');
const css=`:root{font:16px/1.85 "Microsoft YaHei",system-ui,sans-serif;color:#20383c;background:#f4f8f5}*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #dce7e2;padding:24px max(24px,calc((100vw - 1160px)/2));display:flex;align-items:center;gap:16px}header img{width:58px;height:58px}header b{font-size:24px}header small{display:block;color:#66827c}a{color:#176d69;text-underline-offset:4px}a:hover{color:#0b4946}.layout{max-width:1210px;margin:30px auto;display:grid;grid-template-columns:230px minmax(0,1fr);gap:30px;padding:0 24px}aside{position:sticky;top:24px;align-self:start;padding:14px 0}aside a{display:block;margin:10px 0;font-size:14px;text-decoration:none}article{background:#fff;border:1px solid #dce7e2;border-radius:14px;padding:24px 38px;min-width:0}h1{font-size:30px}h2{font-size:23px;border-bottom:1px solid #e1ebe6;padding-bottom:10px;margin-top:42px;scroll-margin-top:22px}h3{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:14px;margin:20px 0;display:block;overflow:auto}th,td{text-align:left;padding:10px 12px;border:1px solid #dce7e2;vertical-align:top}th{background:#edf5f0}img{max-width:100%;height:auto}code{font-family:Consolas,monospace;background:#edf3ef;padding:2px 5px;border-radius:3px;overflow-wrap:anywhere}pre{background:#edf3ef;padding:14px;overflow:auto}pre code{padding:0}li{margin:6px 0}.source{font-size:13px;color:#66827c;border-top:1px solid #dce7e2;margin-top:40px;padding-top:18px}@media(max-width:820px){.layout{display:block;margin:18px auto;padding:0 12px}aside{position:static;padding:0 12px 18px}aside a{display:inline-block;margin:4px 12px 4px 0}article{padding:18px}header{padding:18px 24px}}@media print{aside,header{display:none}.layout{display:block;margin:0;padding:0}article{border:0;padding:0}body{background:white}h2{break-after:avoid}img,tr{break-inside:avoid}}`;
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>发票报销助手 '+escape(version)+' · 使用手册</title><style>'+css+'</style></head><body><header><img src="'+logo+'" alt=""><div><b>发票报销助手</b><small>'+escape(version)+' · Windows x64 便携版 · 离线使用帮助</small></div></header><div class="layout"><aside aria-label="目录">'+toc.map(item=>'<a href="#'+item.id+'">'+escape(item.title)+'</a>').join('')+'</aside><article>'+md.renderer.render(tokens,md.options,{})+'<p id="source-docs" class="source">本文件由 docs/ 中的使用手册、常见问题与隐私说明生成。开发、发布与安全反馈说明见源码仓库；私人配置、授权码和真实票据请勿随问题反馈发送。</p></article></div></body></html>';
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'使用手册.html'),html);
fs.writeFileSync(path.join(out,'使用说明.txt'),`发票报销助手 ${version} — Windows x64 便携版

双击 InvoiceAssistant-${version}-x64-Portable.exe，无需安装。
使用手册：打开同目录的“使用手册.html”，或点软件右上角“使用帮助”。

1. 资料默认放在 EXE 旁“报销资料”，可在设置中迁移。
2. 发票报销：导入 PDF/OFD/ZIP，或配置 IMAP 邮箱及收取日期。
3. 付款截图保存到电脑后直接拖入，或点击“导入付款截图”选择文件；也可复制图片后点击“粘贴截图”。
4. 核对金额、日期和图片，关联一张发票与一张实际付款截图。
5. 选择打印机和模式：仅发票是 N 个任务；配对齐全时是 N 个发票任务加 1 个付款记录任务，单面。
6. 日常长截图在“日常开销”单独核算，不混入付款 Word。

升级：退出旧版，将新版 EXE 放回原目录，保留 InvoiceAssistant.private.json 和完整资料目录。
隐私：邮箱在资料目录 config/accounts.private.json，密钥为 config/.key，两者不可对外分发。
分享：仅发送公开 EXE、使用说明、手册与许可证，不打包自己的整个运行目录。
许可：原创内容 MIT；第三方组件另见 THIRD_PARTY_NOTICES.md 和 third-party-licenses/。

识别结果需人工核对；OFD 需补充 PDF 后批量打印。“已提交”不等于已经出纸。
`);
console.log('已生成离线手册及便携版简明说明（内嵌图片，无需网络）。');
