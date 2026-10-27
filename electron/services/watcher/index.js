'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { DIRS } = require('../../store');
const { contentHash, saveContentFile } = require('../files');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif']);

// 手动导入与监听共用队列，避免 OCR 等待期间同一内容并发入库。
function createScreenshotIngestor(store, ocr, hooks = {}, directory = store.dirs?.screenshots || DIRS.screenshots) {
  let queue = Promise.resolve();
  async function ingest(filePath, purpose) {
    if (!['payment','expense'].includes(purpose)) throw new Error('请选择图片用途');
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) throw new Error('不支持的图片格式：' + ext);
    const data = fs.readFileSync(filePath);
    const hash = contentHash(data);
    const existing = store.findScreenshotByHash(hash);
    if (existing) { store.persist(); return { ...existing, duplicate: true }; }
    // 留存独立副本，用户之后覆盖收件夹里的同名图片不影响已入库材料。
    const originalName = path.basename(filePath);
    let result = {};
    try { if (ocr) result = await ocr.recognizeAmount(data); }
    catch (error) { result = { raw_text: 'OCR 失败：' + error.message, error: error.message }; }
    const displayName=[result.pay_date||require('../../store/dates').localDate(),purpose==='expense'?'开销账单':result.merchant||'付款截图',result.amount==null?'金额待核对':Number(result.amount).toFixed(2)+'元'].join(' · ')+ext;
    const saved = saveContentFile(purpose==='expense'?store.dirs.expenses:path.join(directory,'originals'), displayName, data);
    const rec = {
      file_path: saved.filePath, file_name: originalName, content_hash: hash,
      amount: result.amount ?? null,
      channel: result.channel || inferChannel(originalName),
      pay_date: result.pay_date, merchant: result.merchant, raw_text: result.raw_text, status: 'new', purpose,
    };
    const id = store.addScreenshot(rec);
    let thumb=null;try{thumb=await require('../documents/ingest').thumbnail(store,data,hash);}catch(error){result.error=result.error||'图片无法预览：'+error.message;}
    const expense=require('../ocr').sumLongScreenshot(result.raw_text);
    store.db.prepare('UPDATE screenshots SET recognition_state=?,recognition_source=?,payment_state=?,ocr_lines=?,expense_items=?,thumbnail_path=? WHERE id=?').run(result.recognition_state||'review',result.recognition_source||'local-ocr',result.payment_state||'ok',JSON.stringify(result.ocr_lines||[]),JSON.stringify(expense.items),thumb,id);
    store.persist();
    const output = { ...store.db.prepare('SELECT * FROM screenshots WHERE id=?').get(id), duplicate: false, recognitionError: result.error || null };
    if (result.error && hooks.onError) hooks.onError({ filePath, message: result.error });
    if (hooks.onNew) hooks.onNew(output);
    return output;
  }
  return {
    ingest(filePath, purpose = 'payment') {
      const job = queue.then(() => ingest(filePath, purpose));
      queue = job.catch(() => {});
      return job;
    },
    idle: () => queue,
  };
}

function startScreenshotWatcher(store, ocr, hooks = {}) {
  fs.mkdirSync(store.dirs.incoming, { recursive: true });
  const ingestor = createScreenshotIngestor(store, ocr, hooks);
  const watcher = chokidar.watch(store.dirs.incoming, {
    ignored: /(^|[\\/\\])\../,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    depth: 0,
  });
  const handle = filePath => {
    if (!IMAGE_EXTS.has(path.extname(filePath).toLowerCase())) return;
    ingestor.ingest(filePath).catch(error => hooks.onError?.({ filePath, message: error.message }));
  };
  watcher.on('add', handle).on('change', handle);
  watcher.on('error', error => hooks.onError?.({ message: error.message }));
  watcher.importFiles = async (filePaths, purpose = 'payment') => {
    const results = [];
    for (const filePath of filePaths) results.push(await ingestor.ingest(filePath, purpose));
    return results;
  };
  const close = watcher.close.bind(watcher);
  watcher.close = async () => { await close(); await ingestor.idle(); };
  return watcher;
}

function inferAmountFromName(name) {
  const match = name.match(/(\d+(?:\.\d{1,2})?)\s*元/);
  return match ? Number(match[1]) : null;
}
function inferChannel(filePath) {
  const name = path.basename(filePath).toLowerCase();
  if (/微信|wechat|wx/.test(name)) return 'wechat';
  if (/支付宝|alipay|zfb/.test(name)) return 'alipay';
  return 'other';
}

async function reanalyzeScreenshots(store,ocr,onProgress){
  const rows=store.listScreenshots().filter(s=>!s.recognition_source||!s.thumbnail_path);
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    try{
      require('../materials').assertEditable(store,'screenshot',row.id);
      const result=await ocr.recognizeAmount(row.file_path);
      const thumb=await require('../documents/ingest').thumbnail(store,fs.readFileSync(row.file_path),row.content_hash||'s'+row.id);
      require('../materials').assertEditable(store,'screenshot',row.id);
      const latest=store.db.prepare('SELECT manual_fields FROM screenshots WHERE id=?').get(row.id);
      const manual=JSON.parse(latest.manual_fields||'[]');
      const values={amount:result.amount??null,pay_date:result.pay_date,merchant:result.merchant,channel:result.channel,raw_text:result.raw_text,recognition_state:result.recognition_state,recognition_source:'local-ocr',payment_state:result.payment_state||'ok',ocr_lines:JSON.stringify(result.ocr_lines||[]),expense_items:JSON.stringify(require('../ocr').sumLongScreenshot(result.raw_text).items),thumbnail_path:thumb};
      const keys=Object.keys(values).filter(k=>!manual.includes(k));
      store.db.prepare('UPDATE screenshots SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>values[k]??null),row.id);store.persist();
    }catch(error){onProgress?.({error:'旧截图需要手动核对：'+error.message});}
    onProgress?.({phase:'历史截图识别',done:i+1,total:rows.length});
  }
}
module.exports = { startScreenshotWatcher, createScreenshotIngestor, inferAmountFromName, inferChannel, IMAGE_EXTS,reanalyzeScreenshots };
