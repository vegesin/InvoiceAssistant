'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const materials = require('../materials');
const { generatePaymentWord } = require('../word');

function selectedIds(values) {
  if (!Array.isArray(values)) throw new Error('材料选择无效');
  const ids = values.map(materials.id);
  if (new Set(ids).size !== ids.length) throw new Error('材料不能重复选择');
  return ids;
}
function getReport(store, reportId) {
  const report = store.db.prepare('SELECT * FROM reimbursement WHERE id=?').get(materials.id(reportId));
  if (!report) throw new Error('报销单不存在');
  const invoices = store.db.prepare("SELECT v.* FROM reimbursement_items i JOIN invoices v ON v.id=i.item_id WHERE i.reimbursement_id=? AND i.item_type='invoice' ORDER BY i.seq,i.id").all(report.id);
  const shots = store.db.prepare("SELECT s.* FROM reimbursement_items i JOIN screenshots s ON s.id=i.item_id WHERE i.reimbursement_id=? AND i.item_type='screenshot' ORDER BY i.seq,i.id").all(report.id);
  const missingAmounts = invoices.filter(invoice => invoice.amount === null).length;
  const invoiceCents = invoices.reduce((sum, invoice) => sum + Math.round((invoice.amount || 0) * 100), 0);
  const subsidyCents = Math.round((report.subsidy_per_day || 0) * 100) * (report.subsidy_days || 0);
  const baseCents = report.kind === 'with_invoice' ? invoiceCents : Math.round((report.expense_total || 0) * 100);
  const grandTotal = (baseCents + subsidyCents) / 100;
  const pairs = invoices.map(invoice => ({ invoiceId: invoice.id, screenshotId: store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(invoice.id)?.screenshot_id || null }));
  return { ...report, invoices, screenshots: shots, pairs, invoice_total: invoiceCents / 100, subsidy_total: subsidyCents / 100,
    grand_total: grandTotal, missingAmounts, missingPayments: pairs.filter(pair => !pair.screenshotId).length,
    difference: report.actual_received === null ? null : Math.round((report.actual_received - grandTotal) * 100) / 100 };
}
function listReports(store) {
  return store.db.prepare('SELECT id FROM reimbursement ORDER BY id DESC').all().map(row => getReport(store, row.id));
}
function editable(store, reportId) {
  const report = getReport(store, reportId);
  if (report.status !== 'unsubmitted' || store.busyReports?.has(report.id)) throw new Error('仅未提交且未在导出的报销单可编辑');
  return report;
}
function saveReport(store, input) {
  const existing = input.id ? editable(store, input.id) : null;
  const title = String(input.title || '').trim();
  const kind = input.kind || existing?.kind || 'with_invoice';
  if (!title || title.length > 120) throw new Error('请输入不超过 120 字的报销名称');
  if (!['with_invoice','no_invoice'].includes(kind)) throw new Error('报销类型无效');
  if (existing && existing.kind !== kind) throw new Error('已有报销单不能修改类型');
  const invoiceIds = kind === 'with_invoice' ? selectedIds(input.invoiceIds || []) : [];
  const screenshotIds = kind === 'no_invoice' ? selectedIds(input.screenshotIds || []) : [];
  const dayAmount = materials.amount(input.subsidyPerDay ?? existing?.subsidy_per_day ?? store.getSettings().subsidyPerDay, false);
  const days = Number(input.subsidyDays ?? existing?.subsidy_days ?? 0);
  if (!Number.isInteger(days) || days < 0 || days > 3660) throw new Error('补贴天数需为 0–3660 的整数');
  const expense = kind === 'no_invoice' ? materials.amount(input.expenseTotal ?? 0, false) : 0;
  const items = [];
  for (const [index, invoiceId] of invoiceIds.entries()) {
    materials.getMaterial(store, 'invoice', invoiceId);
    items.push({ type: 'invoice', id: invoiceId, seq: index });
    const pair = store.db.prepare('SELECT screenshot_id FROM invoice_payments WHERE invoice_id=?').get(invoiceId);
    if (pair) items.push({ type: 'screenshot', id: pair.screenshot_id, seq: index });
  }
  for (const [index, screenshotId] of screenshotIds.entries()) {
    const shot = materials.getMaterial(store, 'screenshot', screenshotId);
    if (shot.purpose !== 'expense') throw new Error('无票日常开销请选择用途为日常开销的图片');
    items.push({ type: 'screenshot', id: screenshotId, seq: index });
  }
  for (const item of items) {
    const other = store.db.prepare('SELECT reimbursement_id FROM reimbursement_items WHERE item_type=? AND item_id=? AND reimbursement_id<>?').get(item.type, item.id, existing?.id || 0);
    if (other) throw new Error('材料已在报销单 #' + other.reimbursement_id + ' 中，不能重复报销');
  }
  let reportId = existing?.id;
  store.db.transaction(() => {
    if (reportId) {
      store.db.prepare('UPDATE reimbursement SET title=?,subsidy_per_day=?,subsidy_days=?,expense_total=?,remark=?,word_path=NULL,exported_path=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(title, dayAmount, days, expense, String(input.remark || ''), reportId);
      store.db.prepare('DELETE FROM reimbursement_items WHERE reimbursement_id=?').run(reportId);
    } else {
      reportId = store.db.prepare('INSERT INTO reimbursement (title,kind,subsidy_per_day,subsidy_days,expense_total,remark) VALUES (?,?,?,?,?,?)')
        .run(title, kind, dayAmount, days, expense, String(input.remark || '')).lastInsertRowid;
    }
    for (const item of items) store.db.prepare('INSERT INTO reimbursement_items (reimbursement_id,item_type,item_id,seq) VALUES (?,?,?,?)').run(reportId, item.type, item.id, item.seq);
    persistTotals(store, reportId);
  });
  return getReport(store, reportId);
}
function persistTotals(store, reportId) {
  const report = getReport(store, reportId);
  store.db.prepare('UPDATE reimbursement SET invoice_total=?,subsidy_total=?,grand_total=? WHERE id=?').run(report.invoice_total, report.subsidy_total, report.grand_total, report.id);
}
function setStatus(store, reportId, status, payment = {}) {
  const report = getReport(store, reportId);
  if (store.busyReports?.has(report.id)) throw new Error('正在导出，请稍后再修改状态');
  const allowed = { unsubmitted: ['submitted'], submitted: ['unsubmitted','paid'], paid: [] };
  if (!allowed[report.status]?.includes(status)) throw new Error('不支持的状态变更');
  if (status === 'submitted') {
    if ([...report.invoices,...report.screenshots].some(record => !fs.existsSync(record.file_path))) throw new Error('原始材料丢失，请先恢复文件再提交');
    if (report.kind === 'with_invoice' && (!report.invoices.length || report.missingAmounts || report.missingPayments)) throw new Error('提交前需补齐发票金额及对应付款截图');
    if (report.kind === 'no_invoice' && !report.screenshots.length) throw new Error('请先添加日常开销截图');
  }
  let received = null;
  let date = null;
  if (status === 'paid') {
    received = materials.amount(payment.actualReceived, false);
    date = String(payment.paidDate || new Date().toISOString().slice(0,10));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error('到账日期无效');
  }
  store.db.transaction(() => {
    persistTotals(store, report.id);
    store.db.prepare('UPDATE reimbursement SET status=?,actual_received=?,paid_date=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, received, date, report.id);
  });
  return getReport(store, report.id);
}
function removeReport(store, reportId) {
  const report = editable(store, reportId);
  store.db.transaction(() => {
    store.db.prepare('DELETE FROM reimbursement_items WHERE reimbursement_id=?').run(report.id);
    store.db.prepare('DELETE FROM reimbursement WHERE id=?').run(report.id);
  });
}
function safeName(value) { return String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,60) || '材料'; }
async function locked(store, reportId, action) {
  store.busyReports ||= new Set();
  const id = materials.id(reportId);
  if (store.busyReports.has(id)) throw new Error('报销单正在导出');
  store.busyReports.add(id);
  try { return await action(getReport(store, id)); } finally { store.busyReports.delete(id); }
}
async function generateReportWord(store, reportId, perPage) {
  return locked(store, reportId, async report => {
    if (report.kind !== 'with_invoice') throw new Error('日常开销长截图只统计留底，不导出支付记录 Word');
    const payments = materials.paymentImages(store, report.invoices.map(invoice => invoice.id));
    const directory = path.join(store.dirs.export, 'report_' + report.id);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, '支付记录_' + crypto.randomUUID().slice(0,8) + '.docx');
    await generatePaymentWord(payments.map(payment => payment.screenshot.file_path), file, { perPage });
    store.db.prepare('UPDATE reimbursement SET word_path=? WHERE id=?').run(file, report.id); store.persist();
    return file;
  });
}
async function exportPackage(store, reportId, perPage) {
  return locked(store, reportId, async report => {
    const payments = report.kind === 'with_invoice' ? materials.paymentImages(store, report.invoices.map(invoice => invoice.id)) : [];
    const files = [...report.invoices, ...report.screenshots];
    if (files.some(file => !fs.existsSync(file.file_path))) throw new Error('部分原件丢失，请先检查材料');
    const directory = path.join(store.dirs.export, safeName(report.title) + '_报销' + report.id + '_' + crypto.randomUUID().slice(0,8));
    fs.mkdirSync(directory, { recursive: true });
    const incomplete = path.join(directory, '导出未完成.txt');
    fs.writeFileSync(incomplete, '导出尚未完成，请勿提交这个文件夹。');
    const manifest = { id:report.id, title:report.title, kind:report.kind, status:report.status, invoiceTotal:report.invoice_total,
      expenseTotal:report.expense_total, subsidyTotal:report.subsidy_total, grandTotal:report.grand_total, files:[] };
    const copy = (record, sub, name) => {
      const target = path.join(directory, sub, name + path.extname(record.file_path).toLowerCase());
      fs.mkdirSync(path.dirname(target), { recursive:true });
      fs.copyFileSync(record.file_path, target, fs.constants.COPYFILE_EXCL);
      manifest.files.push({ sourceId:record.id, file:path.relative(directory,target), originalName:record.file_name, amount:record.amount });
    };
    if (report.kind === 'with_invoice') {
      payments.forEach((payment, index) => {
        const prefix = String(index+1).padStart(2,'0') + '_' + safeName(payment.invoice.seller || payment.invoice.invoice_type || '发票') + '_' + (payment.invoice.amount === null ? '待核对' : payment.invoice.amount.toFixed(2));
        copy(payment.invoice,'发票',prefix + '_发票');
        copy(payment.screenshot,'付款截图',prefix + '_付款');
      });
      await generatePaymentWord(payments.map(payment => payment.screenshot.file_path), path.join(directory,'支付记录.docx'), { perPage });
    } else report.screenshots.forEach((shot,index) => copy(shot,'日常开销原图',String(index+1).padStart(2,'0') + '_开销'));
    fs.writeFileSync(path.join(directory,'材料清单.json'),JSON.stringify(manifest,null,2));
    fs.writeFileSync(path.join(directory,'报销摘要.txt'),report.title + '\r\n应报总额：' + report.grand_total.toFixed(2) + ' 元\r\n补贴：' + report.subsidy_total.toFixed(2) + ' 元\r\n' + (report.kind === 'no_invoice' ? '日常开销长截图仅用于统计与留底，不生成打印 Word。' : '同编号的发票与付款截图对应；Word 中截图顺序与编号一致。'));
    fs.unlinkSync(incomplete);
    store.db.prepare('UPDATE reimbursement SET exported_path=? WHERE id=?').run(directory,report.id); store.persist();
    return directory;
  });
}
module.exports = { getReport, listReports, saveReport, setStatus, removeReport, generateReportWord, exportPackage };
