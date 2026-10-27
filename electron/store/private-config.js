'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DIRS } = require('./paths');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function keyFor(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
}
function encrypt(plain, keyFile = path.join(DIRS.config, '.key')) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(keyFile), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v2', iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('hex')].join(':');
}
function decrypt(payload, keyFile = path.join(DIRS.config, '.key')) {
  if (!payload || !fs.existsSync(keyFile)) return '';
  try {
    const parts = String(payload).split(':');
    if (parts[0] === 'v2') {
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(keyFile), Buffer.from(parts[1], 'hex'));
      decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8');
    }
    // 兼容旧版 CBC 密文；原密钥仍使用相同派生规则。
    const decipher = crypto.createDecipheriv('aes-256-cbc', keyFor(keyFile), Buffer.from(parts[0], 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(parts[1], 'hex')), decipher.final()]).toString('utf8');
  } catch (_) { return ''; }
}

class PrivateAccounts {
  constructor(directory) {
    this.file = path.join(directory, 'accounts.private.json');
    this.keyFile = path.join(directory, '.key');
    if (fs.existsSync(this.file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(this.data.accounts) || !Number.isInteger(this.data.next_id)) throw new Error();
        const ids = new Set();
        const emails = new Set();
        for (const account of this.data.accounts) {
          this.validate(account);
          if (!Number.isInteger(account.id) || account.id < 1 || ids.has(account.id) || emails.has(account.email.toLowerCase())) throw new Error();
          ids.add(account.id); emails.add(account.email.toLowerCase());
        }
        this.data.next_id = Math.max(this.data.next_id, ...this.data.accounts.map(account => account.id + 1), 1);
      } catch (_) { throw new Error('私人邮箱配置无法读取，请保留原文件并检查 accounts.private.json'); }
    } else {
      this.data = { version: 1, next_id: 1, accounts: [] };
      this.save(this.data);
    }
  }
  validate(account) {
    if (!account.email || !/^[^\s@]+@[^\s@]+$/.test(account.email) || !account.imap_host || /[\s/\\]/.test(account.imap_host)) throw new Error('邮箱地址或 IMAP 服务器无效');
    const port = Number(account.imap_port ?? 993);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1–65535');
  }
  save(next) { writeJson(this.file, next); this.data = next; }
  list() { return this.data.accounts.map(account => ({ ...account })); }
  get(id) { return this.list().find(account => account.id === Number(id)); }
  add(input) {
    this.validate(input);
    if (!input.auth_token) throw new Error('请输入邮箱授权码');
    if (this.data.accounts.some(account => account.email.toLowerCase() === input.email.trim().toLowerCase())) throw new Error('该邮箱已经配置');
    const id = this.data.next_id;
    const account = { id, name: String(input.name || input.email), email: input.email.trim(), imap_host: input.imap_host.trim(),
      imap_port: Number(input.imap_port || 993), imap_secure: input.imap_secure === false || input.imap_secure === 0 ? 0 : 1,
      enabled: 1, auth_token: encrypt(input.auth_token, this.keyFile) };
    this.save({ ...this.data, next_id: id + 1, accounts: [...this.list(), account] });
    return id;
  }
  update(id, patch) {
    const current = this.get(id);
    if (!current) throw new Error('邮箱账号不存在');
    const next = { ...current };
    for (const key of ['name', 'email', 'imap_host', 'imap_port', 'imap_secure', 'enabled']) if (patch[key] !== undefined) next[key] = patch[key];
    this.validate(next);
    if (this.data.accounts.some(account => account.id !== current.id && account.email.toLowerCase() === next.email.toLowerCase())) throw new Error('该邮箱已经配置');
    if (patch.auth_token) next.auth_token = encrypt(patch.auth_token, this.keyFile);
    this.save({ ...this.data, accounts: this.list().map(account => account.id === current.id ? next : account) });
  }
  remove(id) { this.save({ ...this.data, accounts: this.list().filter(account => account.id !== Number(id)) }); }
  importLegacy(accounts) {
    const next = this.list();
    for (const account of accounts) {
      const sameId = next.find(value => value.id === account.id);
      const sameEmail = next.find(value => value.email.toLowerCase() === account.email.toLowerCase());
      if ((sameId && sameId.email !== account.email) || (sameEmail && sameEmail.id !== account.id)) throw new Error('旧版邮箱与私人配置的编号冲突，请保留两份数据后检查');
      if (!sameId) {
        const { last_uid, uid_validity, created_at, ...configuration } = account;
        next.push(configuration);
      }
    }
    this.save({ ...this.data, next_id: Math.max(this.data.next_id, ...next.map(account => account.id + 1), 1), accounts: next });
  }
}
module.exports = { PrivateAccounts, writeJson, encrypt, decrypt };
