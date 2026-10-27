import React,{useEffect,useState} from 'react';
import Reimburse from './pages/Reimburse.jsx';
import Daily from './pages/Daily.jsx';
import Settings from './pages/Settings.jsx';
import brandIcon from '../../assets/brand/icon.svg';
export default function App(){
 const [tab,setTab]=useState('invoice'),[settings,setSettings]=useState(null),[showSettings,setShowSettings]=useState(false),[status,setStatus]=useState('资料保存在你选择的目录'),[revision,setRevision]=useState(0);
 const refresh=()=>setRevision(n=>n+1);
 useEffect(()=>{window.api.getSettings().then(setSettings).catch(e=>setStatus(e.message));
 const offs=[window.api.onProgress(p=>{setStatus(p.error||p.phase+(p.total?' '+(p.done||0)+' / '+p.total:''));refresh();}),window.api.onScreenshotNew(refresh),window.api.onMailFetchInvoice(refresh),window.api.onPrintProgress(p=>setStatus('正在提交打印 '+p.seq+'/'+p.total+'：'+p.title))];return()=>offs.forEach(off=>off());},[]);
 return <div className="app"><header className="topbar"><div className="brand"><img className="brand-mark" src={brandIcon} alt=""/><div><h1>发票报销助手</h1><small>把材料配齐，一次打印</small></div></div><nav><button className={tab==='invoice'?'active':''} onClick={()=>setTab('invoice')}>发票报销</button><button className={tab==='daily'?'active':''} onClick={()=>setTab('daily')}>日常开销</button></nav><div className="header-actions"><button className="settings-button" onClick={()=>window.api.openHelp().catch(e=>setStatus(e.message))}>使用帮助</button><button className="settings-button" onClick={()=>setShowSettings(true)}>⚙ 设置</button></div></header>
 <main className="content">{settings?<><div hidden={tab!=='invoice'}><Reimburse settings={settings} revision={revision} onStatus={setStatus}/></div><div hidden={tab!=='daily'}><Daily revision={revision} onStatus={setStatus}/></div></>:<div className="panel">正在读取资料…</div>}</main><footer className="app-status" role="status">{status}</footer>{showSettings&&settings&&<Settings settings={settings} onSave={value=>{setSettings(value);refresh();}} onClose={()=>setShowSettings(false)}/>}</div>;
}
