const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../electron/store/db');
const { Store } = require('../electron/store');

function temporaryDirectory(t, beforeCleanup = () => {}) {
  const base = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(base, 'invoice-tests-'));
  t.after(() => {
    beforeCleanup();
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(base + path.sep) || !path.basename(resolved).startsWith('invoice-tests-')) throw new Error('Invalid cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function fixture(t) {
  let store;
  const directory = temporaryDirectory(t, () => { if (store?.db) store.db.close(); });
  store = await Store.create({ root: directory });
  const databasePath = path.join(store.dirs.db, 'app.db');
  return { directory, databasePath, store };
}

function seedAccount(store, fields = {}) {
  store.addAccount({ name:'Synthetic', email:'test@example.invalid', imap_host:'localhost', auth_token:'synthetic-token' });
  store.updateAccount(1,{last_uid:fields.last_uid||0,uid_validity:fields.uid_validity||'1'});
  return store.getAccount(1);
}

module.exports = { temporaryDirectory, fixture, seedAccount };
