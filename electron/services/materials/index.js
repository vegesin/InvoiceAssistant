'use strict';
const fs = require('fs');
const path = require('path');
const { contentHash, saveContentFile } = require('../files');

function id(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('材料编号无效');
  return number;
}
function amount(value, nullable = true) {
  if (value === '' || value === null || value === undefined) {
    if (nullable) return null;
    throw new Error('请填写金额');
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 999999999 || Math.abs(result * 100 - Math.round(result * 100)) > 0.00001) throw new Error('金额需为非负数，最多两位小数');
  return Math.round(result * 100) / 100;
}
function tableFor(type) {
  if (type === 'invoice') return 'invoices';
  if (type === 'screenshot') return 'screenshots';
  throw new Error('材料类型无效');
}
function getMaterial(store, type, materialId, includeDeleted = false) {
  const record = store.db.prepare('SELECT * FROM ' + tableFor(type) + ' WHERE id = ?').get(id(materialId));
  if (!record) throw new Error('材料不存在');
  if (type === 'invoice' && record.deleted_at && !includeDeleted) throw new Error('发票已删除，请先在“已删除”中恢复');
  return record;
}
function assertEditable(store, type, materialId) {
  if(store.printingIds&&(type==='invoice'?store.printingIds.has(Number(materialId)):store.db.prepare('SELECT invoice_id FROM invoice_payments WHERE screenshot_id=?').all(id(materialId)).some(p=>store.printingIds.has(p.invoice_id))))throw new Error('正在生成打印文件，请稍候');
  const active=store.db.prepare("SELECT j.id FROM print_jobs j JOIN print_batches b ON b.id=j.batch_id WHERE b.status IN ('preparing','printing') AND j.invoice_id "+(type==='invoice'?"=?":"IN (SELECT invoice_id FROM invoice_payments WHERE screenshot_id=?)")+' LIMIT 1').get(id(materialId));
  if(active)throw new Error('正在打印，请等待本批次完成后修改');
  const reports = store.db.prepare(
    "SELECT DISTINCT r.id, r.status FROM reimbursement r JOIN reimbursement_items i ON i.reimbursement_id=r.id WHERE (i.item_type=? AND i.item_id=?) " +
    (type === 'screenshot' ? "OR (i.item_type='invoice' AND i.item_id IN (SELECT invoice_id FROM invoice_payments WHERE screenshot_id=?))" : '')
  ).all(...(type === 'screenshot' ? [type, id(materialId), id(materialId)] : [type, id(materialId)]));
  if (reports.some(report => report.status !== 'unsubmitted' || store.busyReports?.has(report.id))) throw new Error('材料已提交、已到账或正在导出，不能修改；请先检查所属报销单');
}
function syncDraftPayments(store) {
  store.db.exec("UPDATE reimbursement SET word_path=NULL,exported_path=NULL WHERE status='unsubmitted'");
  const drafts = store.db.prepare("SELECT id FROM reimbursement WHERE kind='with_invoice' AND status='unsubmitted'").all();
  for (const report of drafts) {
    store.db.prepare("DELETE FROM reimbursement_items WHERE reimbursement_id=? AND item_type='screenshot'").run(report.id);
    const payments = store.db.prepare("SELECT p.screenshot_id, i.seq FROM reimbursement_items i JOIN invoice_payments p ON p.invoice_id=i.item_id WHERE i.reimbursement_id=? AND i.item_type='invoice' ORDER BY i.seq").all(report.id);
    for (const payment of payments) store.db.prepare("INSERT INTO reimbursement_items (reimbursement_id,item_type,item_id,seq) VALUES (?,'screenshot',?,?)").run(report.id, payment.screenshot_id, payment.seq);
  }
}
function bindPayment(store, invoiceId, screenshotId) {
  const invoice = getMaterial(store, 'invoice', invoiceId);
  assertEditable(store, 'invoice', invoice.id);
  const previous = store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(invoice.id);
  if (previous) assertEditable(store, 'screenshot', previous.screenshot_id);
  const shot = screenshotId ? getMaterial(store, 'screenshot', screenshotId) : null;
  if (shot) {
    assertEditable(store, 'screenshot', shot.id);
    if (shot.purpose !== 'payment') throw new Error('日常开销图片不能作为发票付款截图');
    if(shot.payment_state==='invalid'||shot.payment_state==='refund')throw new Error('这张图片是失败或退款记录，请核对后再关联');
    const used = store.db.prepare('SELECT invoice_id FROM invoice_payments WHERE screenshot_id=? AND invoice_id<>?').get(shot.id, invoice.id);
    if (used) throw new Error('这张付款截图已关联其他发票');
  }
  store.db.transaction(() => {
    store.db.prepare('DELETE FROM invoice_payments WHERE invoice_id=?').run(invoice.id);
    if (shot) store.db.prepare('INSERT INTO invoice_payments (invoice_id,screenshot_id) VALUES (?,?)').run(invoice.id, shot.id);
    store.db.prepare('UPDATE invoices SET status=? WHERE id=?').run(shot ? 'matched' : 'new', invoice.id);
    if (previous) store.db.prepare("UPDATE screenshots SET status='new' WHERE id=?").run(previous.screenshot_id);
    if (shot) store.db.prepare("UPDATE screenshots SET status='matched' WHERE id=?").run(shot.id);
    syncDraftPayments(store);
  });
  return listMaterials(store);
}
function updateMaterial(store, type, materialId, patch) {
  const record = getMaterial(store, type, materialId);
  assertEditable(store, type, record.id);
  const allowed = type === 'invoice' ? ['amount','seller','issue_date','invoice_no','invoice_type'] : ['amount','merchant','pay_date','channel','purpose'];
  const values = [];
  const sets = [];
  for (const key of allowed) {
    if (patch[key] === undefined) continue;
    let value = key === 'amount' ? amount(patch[key]) : String(patch[key]).trim();
    if((key==='issue_date'||key==='pay_date')&&value&&!require('../../store/dates').validDate(value))throw new Error('日期格式无效');
    if (key === 'purpose') {
      if (!['payment','expense'].includes(value)) throw new Error('图片用途无效');
      if (value === 'expense' && store.db.prepare('SELECT invoice_id FROM invoice_payments WHERE screenshot_id=?').get(record.id)) throw new Error('请先解除发票关联，再改为日常开销图片');
      const inReport = store.db.prepare("SELECT r.kind FROM reimbursement r JOIN reimbursement_items i ON r.id=i.reimbursement_id WHERE i.item_type='screenshot' AND i.item_id=?").get(record.id);
      if (inReport && ((inReport.kind === 'no_invoice') !== (value === 'expense'))) throw new Error('请先从所属报销单移除此图片，再修改用途');
    }
    if (typeof value === 'string' && value.length > 500) throw new Error('字段过长');
    sets.push(key + '=?'); values.push(value);
  }
  if (sets.length) {
    const manual=new Set(JSON.parse(record.manual_fields||'[]'));for(const key of allowed)if(patch[key]!==undefined)manual.add(key);
    sets.push('manual_fields=?');values.push(JSON.stringify([...manual]));
    store.db.prepare('UPDATE ' + tableFor(type) + ' SET ' + sets.join(',') + ' WHERE id=?').run(...values, record.id);
    store.persist();
    store.db.exec("UPDATE reimbursement SET word_path=NULL,exported_path=NULL WHERE status='unsubmitted'");
    store.persist();
  }
  return getMaterial(store, type, record.id);
}
function listMaterials(store) {
  const membership = store.db.prepare('SELECT i.item_type,i.item_id,r.id AS report_id,r.title AS report_title,r.status AS report_status FROM reimbursement_items i JOIN reimbursement r ON r.id=i.reimbursement_id').all();
  const pairs = store.db.prepare('SELECT * FROM invoice_payments').all();
  const decorate = (row, type) => ({ ...row, reports: membership.filter(item => item.item_type === type && item.item_id === row.id) });
  return {
    invoices: store.listInvoices().filter(row=>!row.duplicate_of&&row.document_kind!=='supporting').map(row => ({ ...decorate(row, 'invoice'), screenshot_id: pairs.find(pair => pair.invoice_id === row.id)?.screenshot_id || null })),
    deletedInvoices: store.listInvoices('',[],true).filter(row=>!row.duplicate_of&&row.document_kind!=='supporting'),
    screenshots: store.listScreenshots().map(row => ({ ...decorate(row, 'screenshot'), invoice_id: pairs.find(pair => pair.screenshot_id === row.id)?.invoice_id || null })),
  };
}
function importInvoices(store, paths) {
  if (!Array.isArray(paths) || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('请选择有效文件');
  const result = [];
  const { inferAmountFromName, inferTypeFromName } = require('../mail');
  for (const file of paths) {
    if (!['.pdf','.ofd'].includes(path.extname(file).toLowerCase())) throw new Error('只支持 PDF 或 OFD 发票');
    const data = fs.readFileSync(file);
    const hash = contentHash(data);
    const existing = store.findInvoiceByHash(hash);
    if (existing) { result.push({ ...existing, duplicate: true }); continue; }
    const saved = saveContentFile(path.join(store.dirs.inbox, 'local'), path.basename(file), data);
    const invoiceId = store.addInvoice({ file_path: saved.filePath, file_name: path.basename(file), content_hash: hash,
      amount: inferAmountFromName(path.basename(file)), invoice_type: inferTypeFromName(path.basename(file)) });
    result.push({ ...getMaterial(store, 'invoice', invoiceId), duplicate: false });
  }
  return result;
}
function preview(store, type, materialId) {
  const record = getMaterial(store, type, materialId);
  const ext = path.extname(record.file_path).toLowerCase();
  if (!fs.existsSync(record.file_path)) throw new Error('原始文件不存在');
  const mime = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.pdf':'application/pdf' }[ext];
  if (!mime) return { name: record.file_name, dataUrl: null };
  if (fs.statSync(record.file_path).size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请使用打开原件');
  return { name: record.file_name, dataUrl: 'data:' + mime + ';base64,' + fs.readFileSync(record.file_path).toString('base64'), mime };
}
function paymentImages(store, invoiceIds) {
  if (!Array.isArray(invoiceIds) || !invoiceIds.length) throw new Error('请先选择发票并关联实际付款截图');
  return invoiceIds.map(value => {
    const invoice = getMaterial(store, 'invoice', value);
    const pair = store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(invoice.id);
    if (!pair) throw new Error('发票 #' + invoice.id + ' 尚未关联付款截图');
    const shot = getMaterial(store, 'screenshot', pair.screenshot_id);
    if (shot.purpose !== 'payment') throw new Error('日常开销图片不进入支付记录 Word');
    return { invoice, screenshot: shot };
  });
}
module.exports = { id, amount, getMaterial, assertEditable, bindPayment, updateMaterial, listMaterials, importInvoices, preview, paymentImages,
  deleteInvoices:(store,ids)=>require('./invoices').deleteInvoices(store,ids),
  restoreInvoices:(store,ids)=>require('./invoices').restoreInvoices(store,ids),
};
