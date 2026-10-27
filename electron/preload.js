// preload：暴露安全 API 给渲染进程
'use strict';

const { contextBridge, ipcRenderer,webUtils } = require('electron');

function subscribe(channel, cb) {
  const listener = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('api', {
  filePath:file=>webUtils.getPathForFile(file),
  importDropped:(items,purpose='payment',invoiceId=null)=>ipcRenderer.invoke('material:drop',items,purpose,invoiceId),
  fetchAllMail:()=>ipcRenderer.invoke('mail:fetchAll'),
  recommend:()=>ipcRenderer.invoke('match:recommend'),
  thumbnail:(type,id)=>ipcRenderer.invoke('material:thumbnail',type,id),
  printBatch:(ids,printer,mode='invoices')=>ipcRenderer.invoke('print:batch',ids,printer,mode),
  printBatches:()=>ipcRenderer.invoke('print:batches'),
  qaPrintPreview:id=>ipcRenderer.invoke('print:qaPreview',id),
  retryPrint:id=>ipcRenderer.invoke('print:retry',id),
  resolvePrint:(id,submitted)=>ipcRenderer.invoke('print:resolve',id,submitted),
  listDaily:()=>ipcRenderer.invoke('daily:list'),
  saveDaily:input=>ipcRenderer.invoke('daily:save',input),
  relocate:()=>ipcRenderer.invoke('app:relocate'),
  onProgress:cb=>subscribe('app:progress',cb),
  onPrintProgress:cb=>subscribe('print:progress',cb),
  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  getDirs: () => ipcRenderer.invoke('app:dirs'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openHelp: () => ipcRenderer.invoke('app:help'),
  openDir: (dir) => ipcRenderer.invoke('app:openDir', dir),

  // 邮箱
  listAccounts: () => ipcRenderer.invoke('mail:list'),
  addAccount: (acc) => ipcRenderer.invoke('mail:add', acc),
  updateAccount: (id, fields) => ipcRenderer.invoke('mail:update', id, fields),
  removeAccount: (id) => ipcRenderer.invoke('mail:remove', id),
  fetchMail: (accountId) => ipcRenderer.invoke('mail:fetch', accountId),
  onMailFetchMail: (cb) => subscribe('mail:onMail', cb),
  onMailFetchInvoice: (cb) => subscribe('mail:onInvoice', cb),

  // 发票
  listInvoices: (where) => ipcRenderer.invoke('invoice:list', where),
  pickInvoices: () => ipcRenderer.invoke('invoice:pick'),
  importInvoices: (paths) => ipcRenderer.invoke('invoice:import', paths),

  // 截图
  listScreenshots: (where) => ipcRenderer.invoke('screenshot:list', where),
  pickScreenshots: () => ipcRenderer.invoke('screenshot:pick'),
  importScreenshots: (paths, purpose = 'payment') => ipcRenderer.invoke('screenshot:import', paths, purpose),
  pasteScreenshot: (purpose = 'payment') => ipcRenderer.invoke('screenshot:paste', purpose),
  onScreenshotNew: (cb) => subscribe('screenshot:new', cb),
  onScreenshotError: (cb) => subscribe('screenshot:error', cb),

  // OCR
  sumLongText: (text) => ipcRenderer.invoke('ocr:sumLongText', text),
  parseText: (text) => ipcRenderer.invoke('ocr:parseText', text),
  ocrRecognize: (filePath) => ipcRenderer.invoke('ocr:recognize', filePath),

  // 配对
  runMatch: (invoices, screenshots) => ipcRenderer.invoke('match:run', invoices, screenshots),

  listMaterials: () => ipcRenderer.invoke('material:list'),
  updateMaterial: (type, id, patch) => ipcRenderer.invoke('material:update', type, id, patch),
  bindPayment: (invoiceId, screenshotId) => ipcRenderer.invoke('material:bind', invoiceId, screenshotId),
  previewMaterial: (type, id) => ipcRenderer.invoke('material:preview', type, id),
  openMaterial: (type, id) => ipcRenderer.invoke('material:open', type, id),
  revealMaterial: (type, id) => ipcRenderer.invoke('material:reveal', type, id),
  listReports: () => ipcRenderer.invoke('report:list'),
  getReport: (id) => ipcRenderer.invoke('report:get', id),
  saveReport: (input) => ipcRenderer.invoke('report:save', input),
  setReportStatus: (id, status, payment) => ipcRenderer.invoke('report:status', id, status, payment),
  removeReport: (id) => ipcRenderer.invoke('report:remove', id),
  generateReportWord: (id, perPage) => ipcRenderer.invoke('report:word', id, perPage),
  exportReport: (id, perPage) => ipcRenderer.invoke('report:export', id, perPage),

  // Word
  generateWord: (selection) => ipcRenderer.invoke('word:generate', selection),
  previewWord: (selection) => ipcRenderer.invoke('word:preview', selection),

  // 打印
  listPrinters: () => ipcRenderer.invoke('print:list'),
  printPdf: (filePath, printerName) => ipcRenderer.invoke('print:pdf', filePath, printerName),
  printImage: (filePath, printerName) => ipcRenderer.invoke('print:image', filePath, printerName),
  printWord: (filePath, printerName) => ipcRenderer.invoke('print:word', filePath, printerName),

  // 台账
  calcLedger: (invoiceTotal, subsidyPerDay, subsidyDays) => ipcRenderer.invoke('ledger:calc', invoiceTotal, subsidyPerDay, subsidyDays),
  isTripClosed: (types) => ipcRenderer.invoke('ledger:isTripClosed', types),

  // 归档
  archiveFiles: (title, files, sub) => ipcRenderer.invoke('archive:files', title, files, sub),
});
