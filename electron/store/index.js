'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DIRS, DATA_ROOT, makeDirs } = require('./paths');
const { PrivateAccounts, writeJson, encrypt, decrypt } = require('./private-config');
const {localDate,validDate}=require('./dates');

// 默认全局设置
const DEFAULT_SETTINGS = {
  version: 1,
  // 出差补贴默认值：补贴金额 N 元/天
  subsidyPerDay: 0,
  // 默认支付渠道 OCR 服务（'local' 本地 PaddleOCR / 'cloud' 云）
  ocrMode: 'local',
  // 邮件拉取：是否保留服务器邮件（false 只标记已读，不删除）
  keepMailOnServer: true,
  // 归档策略
  archiveKeepOriginal: true,
  wordPerPage: 3,
};

class Store {
  constructor(options = {}) {
    this.dirs = options.root ? makeDirs(options.root) : DIRS;
    for (const directory of Object.values(this.dirs)) fs.mkdirSync(directory, {recursive:true});
    this.configFile = path.join(this.dirs.config, "settings.json");
    this.accounts = new PrivateAccounts(this.dirs.config);
    this.firstLaunchDate=options.firstLaunchDate||localDate();
    this.settings = this._loadSettings();
    this.db = null; // 由 init() 异步填充
  }

  // sql.js 是异步加载的，调用方需 await Store.create()
  static async create(options = {}) {
    const store = new Store(options);
    const { createDb } = require('./db');
    store.db = await createDb(path.join(store.dirs.db, 'app.db'));
    store.db.transaction(() => store._migrate());
    store._migrateAccounts();
    return store;
  }

  // 写操作后落盘（sql.js 内存库需手动持久化）
  persist() {
    if (this.db && this.db.persist) this.db.persist();
  }

  _loadSettings() {
    const defaults={...DEFAULT_SETTINGS,version:3,firstLaunchDate:this.firstLaunchDate,mailReceivedFrom:this.firstLaunchDate,mailReceivedTo:null,autoFetchWhenOpen:true};
    if (fs.existsSync(this.configFile)) {
      try {
        const stored=JSON.parse(fs.readFileSync(this.configFile,'utf8'));
        const settings=Object.assign({},defaults,stored,{version:3});
        if(!stored.firstLaunchDate||!stored.mailReceivedFrom)this._saveSettings(settings);
        return settings;
      } catch (e) {
        throw new Error('用户设置损坏，请保留 settings.json 后检查');
      }
    }
    const s = Object.assign({}, defaults);
    this._saveSettings(s);
    return s;
  }

  _saveSettings(s) {
    writeJson(this.configFile, s);
  }

  _migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS mail_sync (account_id INTEGER PRIMARY KEY, last_uid INTEGER DEFAULT 0, uid_validity TEXT)');

    // 发票（从邮件解析出的发票文件 + 结构化字段）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id    INTEGER,              -- 来源邮箱账号
        mail_uid      INTEGER,              -- 来源邮件 UID
        file_path     TEXT NOT NULL,        -- 原始下载路径
        file_name     TEXT,
        invoice_type  TEXT,                 -- 增值税/电子普通/铁路电子客票/行程单/酒店 等
        amount        REAL,                 -- 发票金额（价税合计）
        invoice_no    TEXT,                 -- 发票号码
        invoice_code  TEXT,                 -- 发票代码
        seller        TEXT,                 -- 销售方/收款方
        buyer         TEXT,                 -- 购买方
        issue_date    TEXT,                 -- 开票日期
        remark        TEXT,
        status        TEXT DEFAULT 'new',   -- new / matched / exported / archived
        created_at    TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_invoices_amount ON invoices(amount);
      CREATE INDEX IF NOT EXISTS idx_invoices_no ON invoices(invoice_no);
    `);

    // 支付截图
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path   TEXT NOT NULL,
        file_name   TEXT,
        channel     TEXT,                   -- wechat / alipay / bank / other
        amount      REAL,                   -- OCR 识别金额
        pay_date    TEXT,                   -- OCR 识别日期
        merchant    TEXT,                   -- 商户名
        raw_text    TEXT,                   -- OCR 原文（长截图时用于求和）
        status      TEXT DEFAULT 'new',     -- new / matched / exported
        created_at  TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_sshot_amount ON screenshots(amount);
    `);

    // 报销单（一次报销的一组发票+截图）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reimbursement (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        kind          TEXT DEFAULT 'with_invoice',  -- with_invoice 有票 / no_invoice 无票
        subsidy_per_day REAL DEFAULT 0,             -- 本次报销的补贴 N（覆盖全局）
        subsidy_days    INTEGER DEFAULT 0,          -- 出差天数
        invoice_total   REAL DEFAULT 0,             -- 发票金额合计
        subsidy_total   REAL DEFAULT 0,             -- 补贴合计 = 天数 × N
        grand_total     REAL DEFAULT 0,             -- 应报总额 = 发票 + 补贴
        trip_closed     INTEGER DEFAULT 0,          -- 差旅闭环标记（往返票+酒店齐全）
        status        TEXT DEFAULT 'unsubmitted',   -- unsubmitted / submitted / paid
        remark        TEXT,
        created_at    TEXT DEFAULT (datetime('now','localtime'))
      );
    `);

    // 报销单 ↔ 发票 / 截图 关联
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reimbursement_items (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        reimbursement_id INTEGER NOT NULL,
        item_type      TEXT NOT NULL,       -- invoice / screenshot
        item_id        INTEGER NOT NULL,    -- 对应 invoices.id 或 screenshots.id
        seq            INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_rb_items ON reimbursement_items(reimbursement_id);
    `);

    this._addColumn('invoices', 'content_hash', 'TEXT');
    this._addColumn('screenshots', 'content_hash', 'TEXT');
    // 历史重复记录及其关联原样保留，仅为每份内容的第一条记录补指纹。
    for (const table of ['invoices', 'screenshots']) {
      const used = new Set(this.db.prepare(`SELECT content_hash FROM ${table} WHERE content_hash IS NOT NULL`).all().map(row => row.content_hash));
      for (const row of this.db.prepare(`SELECT id, file_path FROM ${table} WHERE content_hash IS NULL ORDER BY id`).all()) {
        let hash;
        try {
          if (!fs.statSync(row.file_path).isFile()) continue;
          hash = hashFile(row.file_path);
        } catch (_) { continue; } // 旧原件离线或不可读时保留记录，不阻断启动。
        if (used.has(hash)) continue;
        this.db.prepare(`UPDATE ${table} SET content_hash = ? WHERE id = ?`).run(hash, row.id);
        used.add(hash);
      }
      this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_hash ON ${table}(content_hash) WHERE content_hash IS NOT NULL`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_path ON ${table}(file_path)`);
    }

    this._addColumn('screenshots', 'purpose', "TEXT NOT NULL DEFAULT 'payment'");
    for (const [column, type] of [
      ['expense_total','REAL DEFAULT 0'], ['actual_received','REAL'], ['paid_date','TEXT'],
      ['word_path','TEXT'], ['exported_path','TEXT'], ['updated_at','TEXT'],
    ]) this._addColumn('reimbursement', column, type);
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS invoice_payments (invoice_id INTEGER PRIMARY KEY, screenshot_id INTEGER NOT NULL UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP);'
    );

    for(const [name,type] of [
      ['mail_received_at','TEXT'],['raw_text','TEXT'],['recognition_state',"TEXT DEFAULT 'pending'"],['recognition_source','TEXT'],
      ['analysis_version','TEXT'],['document_kind',"TEXT DEFAULT 'invoice'"],['identity_key','TEXT'],['duplicate_of','INTEGER'],
      ['thumbnail_path','TEXT'],['printed_at','TEXT'],['notice','TEXT'],['manual_fields',"TEXT DEFAULT '[]'"]
    ])this._addColumn('invoices',name,type);
    for(const [name,type] of [
      ['recognition_state',"TEXT DEFAULT 'pending'"],['recognition_source','TEXT'],['payment_state',"TEXT DEFAULT 'ok'"],
      ['ocr_lines','TEXT'],['expense_items','TEXT'],['thumbnail_path','TEXT'],['manual_fields',"TEXT DEFAULT '[]'"]
    ])this._addColumn('screenshots',name,type);
    this._addColumn('mail_sync','last_range_key','TEXT');
    this.db.exec("CREATE TABLE IF NOT EXISTS invoice_variants (id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id INTEGER NOT NULL,file_path TEXT NOT NULL,file_name TEXT,format TEXT,content_hash TEXT UNIQUE,document_kind TEXT); CREATE INDEX IF NOT EXISTS idx_invoice_identity ON invoices(identity_key);");
    this.db.exec("CREATE TABLE IF NOT EXISTS print_batches (id TEXT PRIMARY KEY,created_at TEXT DEFAULT (datetime('now','localtime')),printer_name TEXT,status TEXT,word_path TEXT,pdf_path TEXT,error TEXT); CREATE TABLE IF NOT EXISTS print_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT,seq INTEGER,kind TEXT,invoice_id INTEGER,file_path TEXT,title TEXT,state TEXT DEFAULT 'pending',error TEXT,content_hash TEXT,submitted_at TEXT);");
    this.db.exec("CREATE TABLE IF NOT EXISTS daily_expenses (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,total REAL,items_json TEXT,screenshot_ids_json TEXT,created_at TEXT DEFAULT (datetime('now','localtime')));");
    this.db.exec('PRAGMA user_version = 3');


  }

  _addColumn(table, column, type) {
    if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some(field => field.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  // 私人账号配置与业务数据库分离，数据库只保存同步游标。
  _migrateAccounts() {
    const legacy = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mail_accounts'").get();
    if (legacy) {
      const accounts = this.db.prepare('SELECT * FROM mail_accounts').all();
      this.accounts.importLegacy(accounts);
      this.db.transaction(() => {
        for (const account of accounts) this.db.prepare('INSERT OR IGNORE INTO mail_sync (account_id, last_uid, uid_validity) VALUES (?, ?, ?)')
          .run(account.id, account.last_uid || 0, account.uid_validity || null);
        this.db.exec('DROP TABLE mail_accounts');
      });
      this.db.exec('VACUUM');
      this.persist();
    }
    for (const account of this.accounts.list()) this.db.prepare('INSERT OR IGNORE INTO mail_sync (account_id) VALUES (?)').run(account.id);
    this.persist();
  }
  listAccounts() {
    return this.accounts.list().map(account => {
      const { auth_token, ...visible } = this.getAccount(account.id);
      return { ...visible, has_token: !!auth_token };
    });
  }
  getAccount(id) {
    const account = this.accounts.get(id);
    if (!account) return undefined;
    const state = this.db.prepare('SELECT last_uid, uid_validity, last_range_key FROM mail_sync WHERE account_id = ?').get(Number(id));
    return { ...account, last_uid: state?.last_uid || 0, uid_validity: state?.uid_validity || null, last_range_key: state?.last_range_key||null };
  }
  addAccount(account) {
    const id = this.accounts.add(account);
    this.db.prepare('INSERT OR IGNORE INTO mail_sync (account_id) VALUES (?)').run(id);
    this.persist();
    return id;
  }
  updateAccount(id, fields) {
    const previous = this.accounts.get(id);
    if (!previous) throw new Error('邮箱账号不存在');
    const configuration = Object.fromEntries(Object.entries(fields).filter(([key]) => ['name','email','imap_host','imap_port','imap_secure','auth_token','enabled'].includes(key)));
    if (Object.keys(configuration).length) this.accounts.update(id, configuration);
    if (['email','imap_host','imap_port','imap_secure'].some(key => configuration[key] !== undefined && String(configuration[key]) !== String(previous[key]))) {
      this.db.prepare('INSERT OR REPLACE INTO mail_sync (account_id,last_uid,uid_validity) VALUES (?,0,NULL)').run(Number(id));
      this.persist();
    }
    if (fields.last_uid !== undefined || fields.uid_validity !== undefined || fields.last_range_key !== undefined) {
      const current = this.getAccount(id);
      const uid = fields.last_uid ?? current.last_uid;
      const validity = fields.uid_validity !== undefined ? fields.uid_validity : current.uid_validity;
      if (!Number.isSafeInteger(uid) || uid < 0 || (validity !== null && !/^\d+$/.test(String(validity)))) throw new Error('同步游标无效');
      this.db.prepare('INSERT OR REPLACE INTO mail_sync (account_id,last_uid,uid_validity,last_range_key) VALUES (?,?,?,?)').run(Number(id),uid,validity,fields.last_range_key!==undefined?fields.last_range_key:current.last_range_key||null);
      this.persist();
    }
  }
  removeAccount(id) {
    this.accounts.remove(id);
    this.db.prepare('DELETE FROM mail_sync WHERE account_id = ?').run(Number(id));
    this.persist();
  }
  decryptToken(payload) { return decrypt(payload, this.accounts.keyFile); }

  // ---- 全局设置 ----
  getSettings() {
    return Object.assign({}, this.settings);
  }

  setSettings(patch) {
    const next = { ...this.settings };
    if (patch.subsidyPerDay !== undefined) next.subsidyPerDay = require('../services/materials').amount(patch.subsidyPerDay, false);
    if (patch.ocrMode !== undefined) {
      if (!['local','paddle'].includes(patch.ocrMode)) throw new Error('OCR 模式无效');
      next.ocrMode = patch.ocrMode;
    }
    if (patch.wordPerPage !== undefined) {
      if (![2,3].includes(Number(patch.wordPerPage))) throw new Error('每页只能放 2 或 3 张');
      next.wordPerPage = Number(patch.wordPerPage);
    }
    if(patch.mailReceivedFrom!==undefined){if(!validDate(patch.mailReceivedFrom))throw new Error('开始日期无效');next.mailReceivedFrom=patch.mailReceivedFrom;}
    if(patch.mailReceivedTo!==undefined){if(patch.mailReceivedTo!==null&&patch.mailReceivedTo!==''&&!validDate(patch.mailReceivedTo))throw new Error('结束日期无效');next.mailReceivedTo=patch.mailReceivedTo||null;}
    if(next.mailReceivedTo&&next.mailReceivedTo<next.mailReceivedFrom)throw new Error('结束日期不能早于开始日期');
    if(patch.autoFetchWhenOpen!==undefined)next.autoFetchWhenOpen=!!patch.autoFetchWhenOpen;
    this.settings = next;
    this._saveSettings(this.settings);
    return this.settings;
  }

  // ---- 发票 ----
  addInvoice(rec) {
    const hash = rec.content_hash || (fs.existsSync(rec.file_path) ? hashFile(rec.file_path) : null);
    const existing = (hash && this.findInvoiceByHash(hash)) || this.db.prepare('SELECT * FROM invoices WHERE file_path = ?').get(rec.file_path);
    if (existing) { this.persist(); return existing.id; }
    const r = this.db.prepare(`
      INSERT INTO invoices (account_id, mail_uid, file_path, file_name, invoice_type,
        amount, invoice_no, invoice_code, seller, buyer, issue_date, remark, status, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.account_id ?? null, rec.mail_uid ?? null, rec.file_path, rec.file_name ?? null,
      rec.invoice_type ?? null, rec.amount ?? null, rec.invoice_no ?? null, rec.invoice_code ?? null,
      rec.seller ?? null, rec.buyer ?? null, rec.issue_date ?? null, rec.remark ?? null,
      rec.status ?? 'new', hash
    );
    this.persist();
    return r.lastInsertRowid;
  }

  listInvoices(where = '', params = []) {
    return this.db.prepare(`SELECT * FROM invoices ${where} ORDER BY COALESCE(NULLIF(issue_date,''),SUBSTR(mail_received_at,1,10),SUBSTR(created_at,1,10)) DESC, COALESCE(mail_received_at,created_at) DESC,id DESC`).all(...params);
  }

  findInvoiceByHash(hash) {
    return this.db.prepare('SELECT * FROM invoices WHERE content_hash=?').get(hash)||this.db.prepare('SELECT i.* FROM invoice_variants v JOIN invoices i ON i.id=v.invoice_id WHERE v.content_hash=?').get(hash);
  }

  // ---- 截图 ----
  addScreenshot(rec) {
    const hash = rec.content_hash || (fs.existsSync(rec.file_path) ? hashFile(rec.file_path) : null);
    const existing = (hash && this.findScreenshotByHash(hash)) || this.db.prepare('SELECT * FROM screenshots WHERE file_path = ?').get(rec.file_path);
    if (existing) { this.persist(); return existing.id; }
    const r = this.db.prepare(`
      INSERT INTO screenshots (file_path, file_name, channel, amount, pay_date, merchant, raw_text, status, content_hash, purpose)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.file_path, rec.file_name ?? null, rec.channel ?? null, rec.amount ?? null,
      rec.pay_date ?? null, rec.merchant ?? null, rec.raw_text ?? null, rec.status ?? 'new', hash, rec.purpose || 'payment'
    );
    this.persist();
    return r.lastInsertRowid;
  }

  listScreenshots(where = '', params = []) {
    return this.db.prepare(`SELECT * FROM screenshots ${where} ORDER BY COALESCE(NULLIF(pay_date,''),SUBSTR(created_at,1,10)) DESC,id DESC`).all(...params);
  }

  findScreenshotByHash(hash) {
    return this.db.prepare('SELECT * FROM screenshots WHERE content_hash = ?').get(hash);
  }
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

module.exports = { Store, DIRS, DATA_ROOT, encrypt, decrypt, hashFile };
