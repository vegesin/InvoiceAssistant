import React, { useEffect, useState } from 'react';

export default function MailTab() {
  const [accounts, setAccounts] = useState([]);
  const [log, setLog] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', imap_host: '', imap_port: 993, imap_secure: true, auth_token: '' });
  const [fetching, setFetching] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const refresh = () => window.api.listAccounts().then(setAccounts);

  useEffect(() => {
    refresh().catch(error => appendLog(error.message));
    const offMail = window.api.onMailFetchMail(m => appendLog(`邮件 #${m.uid}：${m.subject || '(无主题)'}`));
    const offInv = window.api.onMailFetchInvoice(inv => appendLog(`已收到一份发票，返回发票报销页即可核对。`));
    return () => { offMail?.(); offInv?.(); };
  }, []);

  const appendLog = (line) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  const add = async () => {
    if (!form.email || !form.imap_host || (!editingId && !form.auth_token)) { alert('请填写邮箱、服务器和授权码'); return; }
    try {
      const payload = { ...form, name: form.name.trim() || form.email };
      if (editingId) await window.api.updateAccount(editingId, payload);
      else await window.api.addAccount(payload);
      setEditingId(null);
      setForm({ name: '', email: '', imap_host: '', imap_port: 993, imap_secure: true, auth_token: '' });
      await refresh();
    } catch (error) { appendLog(`添加失败：${error.message}`); }
  };

  const remove = async (id) => {
    if (confirm('确认删除该邮箱账号？原始发票会保留。')) {
      try { await window.api.removeAccount(id); await refresh(); }
      catch (error) { appendLog(error.message); }
    }
  };

  const fetchOne = async (id) => {
    setFetching(true);
    try {
      const r = await window.api.fetchMail(id);
      appendLog(`完成：新增 ${r.downloaded} 个发票附件，跳过 ${r.skipped || 0} 个重复附件`);
      refresh();
    } catch (e) {
      appendLog(`错误：${e.message}`);
    } finally {
      setFetching(false);
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>邮箱账号</h2>
        <table>
          <thead>
            <tr><th>名称</th><th>邮箱</th><th>服务器</th><th>操作</th></tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{a.email}</td>
                <td>{a.imap_host}:{a.imap_port}</td>
                <td>
                  <button className="btn sm primary" disabled={fetching} onClick={() => fetchOne(a.id)}>收取发票</button>{' '}
                  <button className="btn sm" disabled={fetching} onClick={() => { setEditingId(a.id); setForm({ name:a.name,email:a.email,imap_host:a.imap_host,imap_port:a.imap_port,imap_secure:!!a.imap_secure,auth_token:'' }); }}>编辑</button>{' '}
                  <button className="btn sm danger" disabled={fetching} onClick={() => remove(a.id)}>删除</button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && <tr><td colSpan={5} className="empty">尚未添加邮箱</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>{editingId ? '编辑邮箱（授权码留空则保留）' : '添加邮箱'}</h2>
        <div className="form-grid">
          <div className="field"><label>显示名称</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如：工作QQ邮箱" /></div>
          <div className="field"><label>邮箱地址</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="xxx@qq.com" /></div>
          <div className="field"><label>IMAP 服务器</label><input value={form.imap_host} onChange={e => setForm({ ...form, imap_host: e.target.value })} placeholder="imap.qq.com" /></div>
          <div className="field"><label>端口</label><input type="number" value={form.imap_port} onChange={e => setForm({ ...form, imap_port: parseInt(e.target.value) || 993 })} /></div>
          <div className="field full"><label>授权码 / 密码（本地加密存储）</label><input type="password" value={form.auth_token} onChange={e => setForm({ ...form, auth_token: e.target.value })} placeholder="QQ邮箱需前往 设置→账户 生成授权码" /></div>
        </div>
        <button className="btn primary" disabled={fetching} onClick={add}>{editingId ? '保存邮箱配置' : '添加邮箱'}</button>
        {editingId && <button className="btn" onClick={() => { setEditingId(null); setForm({name:'',email:'',imap_host:'',imap_port:993,imap_secure:true,auth_token:''}); }}>取消编辑</button>}
        <p className="muted">邮箱与加密授权码保存在当前用户的私人配置文件中。更换邮箱或服务器后会重新扫描，重复发票按内容跳过。</p>
      </div>

      <div className="panel">
        <h2>拉取日志</h2>
        <div className="log">{log.length ? log.join('\n') : '（暂无日志）'}</div>
      </div>
    </div>
  );
}
