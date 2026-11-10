'use strict';
/* Local ledger. All data lives in this device's IndexedDB. Nothing is sent anywhere. */
const DB_NAME='local-ledger', STORE='tx', META='meta';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db, rows=[], meta={}, state={tab:'home',scope:'all',month:'all',type:'all',cat:'all',q:'',limit:100};

function open(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,1);
  r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore(STORE,{keyPath:'id'});d.createObjectStore(META)};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const tx=(st,mode,fn)=>new Promise((res,rej)=>{const t=db.transaction(st,mode);let out;try{out=fn(t)}catch(e){rej(e);return}
  t.oncomplete=()=>res(out instanceof IDBRequest?out.result:out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)});
const loadAll=async()=>{rows=await tx(STORE,'readonly',t=>t.objectStore(STORE).getAll());
  const m=await tx(META,'readonly',t=>t.objectStore(META).get('m'));meta=m||{};rows.sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)))};
const saveMeta=()=>tx(META,'readwrite',t=>t.objectStore(META).put(meta,'m'));

/* money: integer agorot only */
const fmt=m=>{const neg=m<0,a=Math.abs(m);const s=Math.floor(a/100).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+String(a%100).padStart(2,'0');return (neg?'-':'')+'₪'+s};
function parseAmount(s){s=String(s).trim().replace(/,/g,'');if(!/^\d+(\.\d{1,2})?$/.test(s))return null;const [i,f='']=s.split('.');return parseInt(i,10)*100+parseInt((f+'00').slice(0,2),10)}
const heDate=d=>{const x=new Date(d+'T12:00:00');return isNaN(x)?d:x.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'})};
const isBiz=r=>r.businessSourceCategory===true;
const inScope=r=>state.scope==='all'||(state.scope==='biz'?isBiz(r):!isBiz(r));
const months=()=>[...new Set(rows.map(r=>r.date.slice(0,7)))].sort().reverse();
function filtered(){const q=state.q.trim();return rows.filter(r=>inScope(r)&&(state.month==='all'||r.date.startsWith(state.month))&&(state.type==='all'||r.type===state.type)&&(state.cat==='all'||r.category===state.cat)&&(!q||(r.note||'').includes(q)||(r.category||'').includes(q)||String(r.amountMinor/100).includes(q)))}
const sum=a=>a.reduce((s,r)=>s+r.amountMinor,0);
const incOf=a=>sum(a.filter(r=>r.amountMinor>0)),expOf=a=>-sum(a.filter(r=>r.amountMinor<0));

function scopeSeg(){return `<div class="seg">${[['all','הכול'],['house','בית (ללא עסק)'],['biz','עסק']].map(([k,l])=>`<button data-scope="${k}" class="${state.scope===k?'on':''}">${l}</button>`).join('')}</div>`}
function monthSel(){return `<select id="msel"><option value="all">כל התקופה</option>${months().map(m=>`<option ${state.month===m?'selected':''}>${m}</option>`).join('')}</select>`}

function render(){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.tab===state.tab));
  $('#sub').textContent=rows.length?`${rows.length.toLocaleString('he')} תנועות · נשמר רק במכשיר הזה`:'אין נתונים עדיין';
  $('#fab').style.display=state.tab==='data'?'none':'';
  const v=$('#view');
  if(!rows.length&&state.tab!=='data'){v.innerHTML=`<div class="card"><h2>התחלה</h2><p>האפליקציה ריקה. עבור ללשונית "נתונים" וייבא את קובץ ההיסטוריה (JSON) מהקבצים באייפון.</p></div>`;return}
  ({home:renderHome,list:renderList,cats:renderCats,data:renderData})[state.tab](v);
}
function backupBanner(){const d=meta.lastBackupAt;const days=d?Math.floor((Date.now()-Date.parse(d))/864e5):null;
  if(days===null)return `<div class="warn">עדיין לא בוצע גיבוי. הנתונים קיימים רק במכשיר הזה. עבור ל"נתונים" ושמור גיבוי.</div>`;
  if(days>=7||(meta.changesSinceBackup||0)>=20)return `<div class="warn">גיבוי אחרון לפני ${days} ימים, ${meta.changesSinceBackup||0} שינויים מאז. מומלץ לגבות.</div>`;return ''}

function renderHome(v){
  const a=rows.filter(r=>inScope(r)&&(state.month==='all'||r.date.startsWith(state.month)));
  const byM={};rows.filter(inScope).forEach(r=>{const k=r.date.slice(0,7);(byM[k]??={i:0,e:0});r.amountMinor>0?byM[k].i+=r.amountMinor:byM[k].e-=r.amountMinor});
  const ms=Object.keys(byM).sort().reverse().slice(0,12);const mx=Math.max(1,...ms.map(k=>Math.max(byM[k].i,byM[k].e)));
  v.innerHTML=backupBanner()+scopeSeg()+monthSel()+`
  <div class="card"><h2>תזרים נטו (הכנסות פחות יציאות)</h2><div class="big ${sum(a)<0?'exp':'inc'}">${fmt(sum(a))}</div>
   <div class="row"><span>הכנסות</span><span class="amt inc">${fmt(incOf(a))}</span></div>
   <div class="row"><span>יציאות כספיות</span><span class="amt exp">${fmt(expOf(a))}</span></div>
   <p class="muted">זה תזרים של התנועות שיובאו, לא יתרת בנק, ולא הוגדרה יתרת פתיחה. ״יציאות״ כוללות הכול כפי שנרשם במקור, גם חיסכון, השקעות, פנסיה, משכנתא וחוב, לא רק הוצאות מחיה.${meta.sourceCutoff?` נתוני המקור מסתיימים ב־${esc(heDate(meta.sourceCutoff))}.`:''}</p></div>
  <div class="card"><h2>12 חודשים אחרונים</h2>${ms.map(k=>`<div class="row"><div class="l"><b>${k}</b><div class="bar"><i style="width:${byM[k].i/mx*100}%;background:var(--inc)"></i></div><div class="bar"><i style="width:${byM[k].e/mx*100}%;background:var(--exp)"></i></div></div><div><div class="amt inc">${fmt(byM[k].i)}</div><div class="amt exp">${fmt(byM[k].e)}</div></div></div>`).join('')}</div>`;
  bindCommon();
}
function rowHtml(r){return `<div class="row" data-id="${esc(r.id)}"><div class="l"><div>${esc(r.category)}${isBiz(r)?'':''}${r.foreignCurrency?`<span class="tag">${esc(r.foreignAmount)} ${esc(r.foreignCurrency)}</span>`:''}${r.source==='local'?'<span class="tag">חדש</span>':''}${r.edited?'<span class="tag">נערך</span>':''}</div><div class="n">${esc(r.note)}</div><div class="n">${r.date}</div></div><div class="amt ${r.amountMinor<0?'exp':'inc'}">${fmt(r.amountMinor)}</div></div>`}
function renderList(v){
  const f=filtered(),cats=[...new Set(rows.map(r=>r.category))].sort();
  v.innerHTML=scopeSeg()+`<input id="q" placeholder="חיפוש בהערות / קטגוריה / סכום" value="${esc(state.q)}">${monthSel()}
  <select id="csel"><option value="all">כל הקטגוריות</option>${cats.map(c=>`<option ${state.cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
  <div class="seg">${[['all','הכול'],['expense','יציאות'],['income','הכנסות']].map(([k,l])=>`<button data-type="${k}" class="${state.type===k?'on':''}">${l}</button>`).join('')}</div>
  <div class="card"><h2>${f.length.toLocaleString('he')} תנועות · נטו <span class="amt">${fmt(sum(f))}</span></h2>${f.slice(0,state.limit).map(rowHtml).join('')}
  ${f.length>state.limit?`<button class="btn" id="more">הצג עוד</button>`:''}</div>`;
  bindCommon();
  const q=$('#q');q.oninput=()=>{state.q=q.value;state.limit=100;const p=q.selectionStart;renderList(v);const n=$('#q');n.focus();n.setSelectionRange(p,p)};
  $('#csel').onchange=e=>{state.cat=e.target.value;state.limit=100;render()};
  document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{state.type=b.dataset.type;state.limit=100;render()});
  const m=$('#more');if(m)m.onclick=()=>{state.limit+=200;render()};
  document.querySelectorAll('.row[data-id]').forEach(el=>el.onclick=()=>editDlg(rows.find(r=>r.id===el.dataset.id)));
}
function renderCats(v){
  const a=rows.filter(r=>inScope(r)&&(state.month==='all'||r.date.startsWith(state.month)));
  const g={};a.forEach(r=>{(g[r.category]??={n:0,s:0}).n++;g[r.category].s+=r.amountMinor});
  const list=Object.entries(g).sort((x,y)=>Math.abs(y[1].s)-Math.abs(x[1].s));const mx=Math.max(1,...list.map(x=>Math.abs(x[1].s)));
  v.innerHTML=scopeSeg()+monthSel()+`<div class="card"><h2>נטו לפי קטגוריית מקור (הכנסות פחות יציאות)</h2>${list.map(([c,x])=>`<div class="row" data-cat="${esc(c)}"><div class="l">${esc(c)} <span class="n">(${x.n})</span><div class="bar"><i style="width:${Math.abs(x.s)/mx*100}%;background:${x.s<0?'var(--exp)':'var(--inc)'}"></i></div></div><div class="amt ${x.s<0?'exp':'inc'}">${fmt(x.s)}</div></div>`).join('')}
  <p class="muted">הסכום לכל קטגוריה הוא נטו: הכנסות פחות יציאות באותה קטגוריה, לא סך הוצאות. הקטגוריות כפי שהיו במקור, ללא סיווג מחדש. ההשקעות, הפנסיה, המשכנתא והחוב מוצגים כפי שנרשמו; אין פיצול קרן וריבית.</p></div>`;
  bindCommon();document.querySelectorAll('[data-cat]').forEach(el=>el.onclick=()=>{state.cat=el.dataset.cat;state.tab='list';render()});
}
function bindCommon(){
  document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{state.scope=b.dataset.scope;state.limit=100;render()});
  const m=$('#msel');if(m)m.onchange=e=>{state.month=e.target.value;state.limit=100;render()};
}

/* add / edit */
function editDlg(r){
  const d=$('#dlg'),isNew=!r;const cats=[...new Set(rows.map(x=>x.category))].sort();
  const t=r||{type:'expense',date:new Date().toISOString().slice(0,10),category:cats[0]||'',note:'',amountMinor:0};
  d.innerHTML=`<h3>${isNew?'תנועה חדשה':'עריכת תנועה'}</h3>
  <div class="seg"><button data-t="expense" class="${t.type==='expense'?'on':''}">יציאה</button><button data-t="income" class="${t.type==='income'?'on':''}">הכנסה</button></div>
  <label>סכום (₪)</label><input id="f-amt" inputmode="decimal" value="${t.amountMinor?(Math.abs(t.amountMinor)/100).toFixed(2):''}" dir="ltr">
  <label>תאריך</label><input id="f-date" type="date" value="${t.date}">
  <label>קטגוריה</label><input id="f-cat" list="catlist" value="${esc(t.category)}"><datalist id="catlist">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
  <label>הערה</label><textarea id="f-note" rows="2">${esc(t.note)}</textarea><div id="f-err" class="warn" style="display:none"></div>
  <div class="seg"><button class="btn primary" id="f-save">שמירה</button><button class="btn" id="f-cancel">ביטול</button>${isNew?'':'<button class="btn danger" id="f-del">מחיקה</button>'}</div>`;
  let type=t.type;d.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{type=b.dataset.t;d.querySelectorAll('[data-t]').forEach(x=>x.classList.toggle('on',x===b))});
  $('#f-cancel').onclick=()=>d.close();
  $('#f-save').onclick=async()=>{const a=parseAmount($('#f-amt').value),date=$('#f-date').value,cat=$('#f-cat').value.trim();const err=$('#f-err');
    if(!a||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!cat){err.style.display='';err.textContent='נדרש סכום חיובי (עד 2 ספרות אחרי הנקודה), תאריך וקטגוריה.';return}
    const rec=isNew?{id:'LOCAL-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),sourceSheet:'',sourceRow:null,account:'ראשי',currency:'ILS',originalAmount:'',tagsOriginal:'',foreignAmount:'',foreignCurrency:'',source:'local'}:{...r,edited:true,previous:r.previous||{date:r.date,category:r.category,note:r.note,amountMinor:r.amountMinor,type:r.type}};
    Object.assign(rec,{type,date,sourceDateTime:r?.sourceDateTime&&r.date===date?r.sourceDateTime:date,category:cat,note:$('#f-note').value,amountMinor:type==='expense'?-a:a,businessSourceCategory:rows.some(x=>x.category===cat&&x.businessSourceCategory===true)});
    await tx(STORE,'readwrite',t=>t.objectStore(STORE).put(rec));meta.changesSinceBackup=(meta.changesSinceBackup||0)+1;await saveMeta();await loadAll();d.close();render()};
  const del=$('#f-del');if(del)del.onclick=async()=>{if(!confirm('למחוק את התנועה? הפעולה לא ניתנת לביטול (אלא משחזור מגיבוי).'))return;
    await tx(STORE,'readwrite',t=>t.objectStore(STORE).delete(r.id));(meta.tombstones??={})[r.id]=new Date().toISOString();meta.changesSinceBackup=(meta.changesSinceBackup||0)+1;await saveMeta();await loadAll();d.close();render()};
  d.showModal();
}

/* data: import / backup / restore */
function renderData(v){
  const bk=meta.lastBackupAt?new Date(meta.lastBackupAt).toLocaleString('he'):'אף פעם';
  v.innerHTML=backupBanner()+`<div class="card"><h2>גיבוי</h2><p>גיבוי אחרון: <b>${bk}</b>. שינויים מאז: ${meta.changesSinceBackup||0}.</p>
  <p class="muted">הנתונים נשמרים רק באייפון הזה. אם האפליקציה תימחק או שמאגר האתר ינוקה, הם יאבדו. שמור גיבוי לקבצים (iCloud Drive) באופן קבוע.</p>
  <button class="btn primary" id="b-json">שמירת גיבוי מלא (JSON)</button> <button class="btn" id="b-csv">ייצוא CSV</button></div>
  <div class="card"><h2>ייבוא / שחזור</h2><input type="file" id="imp" accept=".json,application/json">
  <p class="muted">מקבל קובץ היסטוריה ראשוני או קובץ גיבוי של האפליקציה. הקובץ נבדק (מספר תנועות, סכומים) לפני כל שינוי, ולא נשמר דבר עד אישור.</p><div id="impres"></div></div>
  <div class="card"><h2>מידע</h2>
  <div class="row"><span>מקור</span><span>${esc(meta.sourceNote||'—')}</span></div>
  <div class="row"><span>תקופת המקור</span><span>${meta.sourceFrom?heDate(meta.sourceFrom)+' עד '+heDate(meta.sourceCutoff):'—'}</span></div>
  <div class="row"><span>אחסון קבוע</span><span id="persist">בבדיקה…</span></div>
  <div class="n muted">טביעת SHA256 של קובץ המקור:<div class="hash" dir="ltr">${esc(meta.sourceSha256||'—')}</div></div></div>`;
  $('#b-json').onclick=exportJson;$('#b-csv').onclick=exportCsv;$('#imp').onchange=onFile;
  (navigator.storage&&navigator.storage.persisted?navigator.storage.persisted():Promise.resolve(false)).then(p=>{const e=$('#persist');if(e)e.textContent=p?'כן (הדפדפן הבטיח לא למחוק)':'לא מובטח. הוסף את האפליקציה למסך הבית וגבה באופן קבוע.'});
}
function download(name,type,text){const b=new Blob([text],{type});const f=new File([b],name,{type});
  if(navigator.canShare&&navigator.canShare({files:[f]})){navigator.share({files:[f],title:name}).then(()=>{if(name.endsWith('.json'))markBackup()}).catch(()=>{});return}
  const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);if(name.endsWith('.json'))markBackup()}
async function markBackup(){meta.lastBackupAt=new Date().toISOString();meta.changesSinceBackup=0;await saveMeta();render()}
function exportJson(){const all=[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  download(`ledger-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json',JSON.stringify({app:'local-ledger',schemaVersion:1,exportedAt:new Date().toISOString(),meta:{sourceSha256:meta.sourceSha256,sourceNote:meta.sourceNote,sourceCutoff:meta.sourceCutoff,sourceFrom:meta.sourceFrom,tombstones:meta.tombstones||{}},records:all}))}
function exportCsv(){const q=s=>'"'+String(s??'').replace(/"/g,'""')+'"';const h=['id','date','type','account','category','amount_ils','note','foreign_amount','foreign_currency'];
  const l=[h.join(',')].concat([...rows].sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[r.id,r.date,r.type,r.account,r.category,(r.amountMinor/100).toFixed(2),r.note,r.foreignAmount,r.foreignCurrency].map(q).join(',')));
  download(`ledger-${new Date().toISOString().slice(0,10)}.csv`,'text/csv','\ufeff'+l.join('\r\n'))}

function validate(o){
  const recs=Array.isArray(o)?o:o&&o.records;if(!Array.isArray(recs))throw new Error('אין שדה records בקובץ');
  const ids=new Set();let bad=0;
  for(const r of recs){if(!r||typeof r.id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date||'')||!Number.isSafeInteger(r.amountMinor)||r.amountMinor===0||typeof r.category!=='string'||!['income','expense'].includes(r.type)||(r.type==='income')!==(r.amountMinor>0)){bad++;continue}ids.add(r.id)}
  if(bad)throw new Error(`${bad} רשומות לא תקינות. לא נשמר דבר.`);if(ids.size!==recs.length)throw new Error('מזהים כפולים בקובץ. לא נשמר דבר.');
  if(o.sourceRecordCount!==undefined&&o.sourceRecordCount!==recs.length)throw new Error('מספר הרשומות לא תואם להצהרת הקובץ.');
  const rc=o.reconciliation;if(rc){const inc=recs.filter(r=>r.amountMinor>0).reduce((s,r)=>s+r.amountMinor,0),exp=-recs.filter(r=>r.amountMinor<0).reduce((s,r)=>s+r.amountMinor,0);
    if((rc.incomeMinor!==undefined&&rc.incomeMinor!==inc)||(rc.expenseMinor!==undefined&&rc.expenseMinor!==exp))throw new Error('סכומי ההכנסות/הוצאות לא תואמים להצהרת הקובץ. לא נשמר דבר.')}
  return recs}
async function onFile(e){
  const f=e.target.files[0];if(!f)return;const out=$('#impres');
  try{const o=JSON.parse(await f.text());const recs=validate(o);
    const inc=recs.filter(r=>r.amountMinor>0),exp=recs.filter(r=>r.amountMinor<0);
    const isBackup=o.app==='local-ledger';const existing=new Set(rows.map(r=>r.id));const tomb=meta.tombstones||{};
    const missing=recs.filter(r=>!existing.has(r.id));const fresh=missing.filter(r=>!tomb[r.id]);const blocked=missing.filter(r=>tomb[r.id]);
    out.innerHTML=`<div class="ok">הקובץ תקין: ${recs.length} תנועות · ${inc.length} הכנסות ${fmt(sum(inc))} · ${exp.length} יציאות ${fmt(-sum(exp))} · נטו ${fmt(sum(recs))}.<br>${fresh.length} חדשות, ${recs.length-missing.length} כבר קיימות${blocked.length?`, ${blocked.length} נמחקו אצלך בעבר ולכן לא יוחזרו`:''}.</div>
    <div class="seg"><button class="btn primary" id="do-merge">${isBackup?'שחזור: הוספת החסרות בלבד':'ייבוא: הוספת החסרות בלבד'}</button>${blocked.length?`<button class="btn" id="do-merge-all">הוספה כולל ${blocked.length} שנמחקו</button>`:''}${isBackup?'<button class="btn danger" id="do-replace">שחזור מלא: החלפת כל הנתונים</button>':''}</div>`;
    const apply=async(mode)=>{const replace=mode==='replace';if(replace&&!confirm(`להחליף את כל ${rows.length} התנועות הקיימות ב־${recs.length} מהקובץ?`))return;
      const add=replace?recs:(mode==='all'?missing:fresh);
      await tx(STORE,'readwrite',t=>{const st=t.objectStore(STORE);if(replace)st.clear();add.forEach(r=>st.put(r))});
      if(replace)meta.tombstones={...(o.meta&&o.meta.tombstones||{})};else if(mode==='all')blocked.forEach(r=>delete meta.tombstones[r.id]);
      const ds=recs.filter(r=>r.sourceSheet).map(r=>r.date).sort();
      meta.sourceSha256=o.sourceSha256||(o.meta&&o.meta.sourceSha256)||meta.sourceSha256;
      if(o.sourceSha256||(o.meta&&o.meta.sourceNote))meta.sourceNote=(o.meta&&o.meta.sourceNote)||'ייבוא מקובץ Money Manager';
      meta.sourceFrom=(o.meta&&o.meta.sourceFrom)||(ds[0]||meta.sourceFrom);meta.sourceCutoff=(o.meta&&o.meta.sourceCutoff)||(ds.length?ds[ds.length-1]:meta.sourceCutoff);
      meta.changesSinceBackup=(meta.changesSinceBackup||0)+1;await saveMeta();await loadAll();
      if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
      const msg=`<div class="ok">נשמר. במאגר כעת ${rows.length} תנועות, נטו ${fmt(sum(rows))}. שמור עכשיו גיבוי.</div>`;render();const o2=$('#impres');if(o2)o2.innerHTML=msg;};
    $('#do-merge').onclick=()=>apply('missing');const ma=$('#do-merge-all');if(ma)ma.onclick=()=>apply('all');const r=$('#do-replace');if(r)r.onclick=()=>apply('replace');
  }catch(err){out.innerHTML=`<div class="warn">${esc(err.message)}</div>`}
}

document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;window.scrollTo(0,0);render()});
$('#fab').onclick=()=>editDlg(null);
(async()=>{db=await open();await loadAll();render();if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});window.__ledger={rows:()=>rows,meta:()=>meta}})();
