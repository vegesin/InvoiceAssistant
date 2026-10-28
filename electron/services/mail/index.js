'use strict';

const path = require('path');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { DIRS, decrypt } = require('../../store');
const { contentHash, saveContentFile } = require('../files');

const INVOICE_EXTS = new Set(['.pdf', '.ofd']);
const NON_INVOICE_HINTS = ['结账单', '对账单', '账单', '结算单', '消费明细', '详情'];
const INVOICE_KEYWORDS = ['发票', 'invoice', '电子发票', '行程单', '客票', '报销'];
const fetching = new Set();
const {inRange,addDays}=require('../../store/dates');
const RULE_VERSION='zip-tickets-v4';

// deps 仅用于离线回归；正常业务使用真实 IMAP 客户端。
async function fetchInvoices(account, store, hooks = {}, deps = {}) {
  const key = String(account.id);
  if (fetching.has(key)) throw new Error('该邮箱正在收取发票，请等待完成');
  fetching.add(key);
  let client;
  let connected = false;
  try {
    const token = (deps.decrypt || (value => store.decryptToken(value)))(account.auth_token);
    if (!token) throw new Error('账号「' + account.email + '」缺少授权码/密码');
    client = deps.client || new ImapFlow({
      host: account.imap_host, port: account.imap_port, secure: !!account.imap_secure,
      auth: { user: account.email, pass: token }, logger: false,
    });
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock('INBOX',{readOnly:true});
    let downloaded = 0;
    let skipped = 0;
    let lastUid = account.last_uid || 0;
    try {
      const validity = String(client.mailbox?.uidValidity || '');
      if (!/^\d+$/.test(validity)) throw new Error('邮箱没有返回有效 UIDVALIDITY，未推进同步进度');
      if (String(account.uid_validity || '') !== validity) {
        // 旧版本没有 UIDVALIDITY：保守重扫一次，内容指纹避免重复保存。
        lastUid = 0;
        store.updateAccount(account.id, { uid_validity: validity, last_uid: 0 });
      }
      const settings=store.getSettings();
      const rangeKey=JSON.stringify([settings.mailReceivedFrom,settings.mailReceivedTo||null,RULE_VERSION]);
      const rescan=account.last_range_key!==rangeKey||String(account.uid_validity||'')!==validity;
      if(rescan)lastUid=0;
      const query={since:new Date(addDays(settings.mailReceivedFrom,-1)+'T00:00:00Z')};
      if(settings.mailReceivedTo)query.before=new Date(addDays(settings.mailReceivedTo,2)+'T00:00:00Z');
      if(lastUid)query.uid=(lastUid+1)+':*';
      const uids=typeof client.search==='function'?await client.search(query,{uid:true}):null;
      const scanned = new Map();
      const range=uids?uids.join(','):(lastUid+1)+':*';
      if(range)for await (const msg of client.fetch(range, { uid: true, envelope: true, bodyStructure: true,internalDate:true }, { uid: true })) {
        // IMAP 的 n:* 可能包含最后一封旧邮件，必须显式排除。
        if (!Number.isSafeInteger(msg.uid) || msg.uid <= lastUid) continue;
        scanned.set(msg.uid,{candidate:bodyHasInvoiceAttachment(msg.bodyStructure)&&inRange(msg.internalDate,settings),received:msg.internalDate});
      }
      const messages = [...scanned.entries()].sort((a, b) => a[0] - b[0]);
      if (hooks.onProgress) hooks.onProgress({ total: messages.length, phase: 'scan' });
      for (let index = 0; index < messages.length; index++) {
        const [uid, info] = messages[index];const {candidate,received}=info;
        if (candidate) {
          let parsed;
          for await (const msg of client.fetch(String(uid), { uid: true, envelope: true, source: true }, { uid: true })) {
            if (msg.uid !== uid) throw new Error('邮箱返回了非预期邮件，已停止同步');
            if (hooks.onMail) hooks.onMail({ uid, subject: msg.envelope?.subject });
            parsed = await (deps.parse || simpleParser)(msg.source);
            break;
          }
          if (!parsed) throw new Error('未能读取邮件 #' + uid + '，请重新收取');
          const attachments = await require('./attachments').invoiceAttachments(parsed.attachments);
          for (const attachment of attachments) {
            const hash = contentHash(attachment.content);
            if (store.findInvoiceByHash(hash)) { store.persist(); skipped++; continue; }
            const safeName = sanitizeFilename(attachment.filename);
            const dir = path.join(store.dirs.temp,'mail-stage', 'acct_' + account.id, 'uidvalidity_' + validity, 'mail_' + uid);
            const saved = saveContentFile(dir, safeName, attachment.content);
            const ingest=deps.ingest||require('../documents/ingest').ingestInvoice;
            let record;
            try{record=await ingest(store,saved.filePath,deps.ocr||hooks.ocr,{account_id:account.id,mail_uid:uid,mail_received_at:received?new Date(received).toISOString():null});}
            finally{if(fsExists(saved.filePath))require('fs').unlinkSync(saved.filePath);}
            if(record.deleted_at){skipped++;continue;}
            const {id,amount,invoice_type:invoiceType}=record;
            downloaded++;
            if (hooks.onInvoice) hooks.onInvoice({ id, accountId: account.id, mailUid: uid, filePath: record.file_path, amount, invoiceType });
          }
        }
        // 只在整封邮件成功后前移；无发票邮件同样推进，避免反复扫描。
        store.updateAccount(account.id, { last_uid: uid, uid_validity: validity });
        lastUid = uid;
        if (hooks.onProgress) hooks.onProgress({ done: index + 1, total: messages.length, phase: 'download' });
      }
      store.updateAccount(account.id,{last_range_key:rangeKey});
      return { downloaded, skipped, lastUid, uidValidity: validity };
    } finally { lock.release(); }
  } finally {
    if (connected) {
      try { await client.logout(); }
      catch (_) { if (typeof client.close === 'function') client.close(); }
    }
    fetching.delete(key);
  }
}
function fsExists(file){return require('fs').existsSync(file);}

function bodyHasInvoiceAttachment(node) {
  if (!node) return false;
  const name = extractFilename(node);
  if (/\.(pdf|ofd|zip)$/i.test(name)) return true;
  return Array.isArray(node.childNodes) && node.childNodes.some(bodyHasInvoiceAttachment);
}

function extractFilename(part) {
  let name = part.dispositionParameters?.filename || part.parameters?.filename || part.filename || '';
  if (typeof name === 'string' && name.startsWith('{')) {
    try { const value = JSON.parse(name); name = value.filename || value.name || ''; } catch (_) {}
  }
  return typeof name === 'string' ? name : '';
}

function isNonInvoice(name) { return NON_INVOICE_HINTS.some(hint => name.includes(hint)); }
function sanitizeFilename(name) { return String(name).replace(/[\\/:*?"<>|\x00-\x1F]/g, '_').replace(/[. ]+$/g, '') || 'invoice.pdf'; }

function inferAmountFromName(name) {
  const match = name.match(/(\d+\.\d{1,2})(?:元|(?=[_.-]|$))/);
  return match ? Number(match[1]) : null;
}

function inferTypeFromName(name) {
  const lower = name.toLowerCase();
  if (/铁路|客票|火车/.test(lower)) return '铁路电子客票';
  if (/机票|航空|行程单/.test(lower)) return '航空行程单';
  if (lower.includes('酒店')) return '酒店';
  if (/出租|打车|t3|滴滴/.test(lower)) return '打车票';
  return '电子发票';
}

module.exports = { fetchInvoices, sanitizeFilename, inferAmountFromName, inferTypeFromName, INVOICE_KEYWORDS,RULE_VERSION };
