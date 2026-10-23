import {dateObservances} from './observances.bundle.js';
import {dateKey,monthCells,shiftMonth,lunarLabel,occasion,fetchWeather,weatherLabel} from './calendar.mjs';
import {createScene} from './scene.bundle.js';
import {t,translate} from './i18n.mjs';
import {createSoundEngine} from './sound.mjs';
import {initMini} from './mini.mjs';

const $=id=>document.getElementById(id);
const icons={
 'chevron-left':'m12 5-7 7 7 7','chevron-right':'m8 5 7 7-7 7',
 'sliders':'M4 7h7m5 0h4M4 17h3m5 0h8M11 4v6m-4 4v6',
 'minus':'M5 12h14','x':'m6 6 12 12M18 6 6 18','plus':'M12 5v14M5 12h14',
 'bell':'M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8m4 11h4',
 'arrow-up-right':'M6 18 18 6M6 6h12v12','lock':'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z',
 'gift':'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C2 9 5 1 9 4l3 5c10 0 7-8 3-5z',
 'pin':'m8 3 8 0-1 7 4 4H5l4-4-1-7m4 11v7',
 'hand':'M9 12V5a2 2 0 0 1 4 0v5l5 1a3 3 0 0 1 3 3l-2 6H9l-5-6a2 2 0 0 1 3-2l2 2',
 'check':'m5 12 4 4 10-10','trash':'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7'
};
function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.plus}"/></svg>`;}
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
hydrateIcons();
const desktop=window.desktop;
const mode=new URLSearchParams(location.search).get('mode')||'main';
const today=()=>dateKey(new Date());
let selected=today(),viewYear=new Date().getFullYear(),viewMonth=new Date().getMonth();
let state={reminders:[],settings:{city:'厦门',motion:'roll',alwaysOnTop:false,miniMode:false,palette:'butter',blockShape:'classic',language:'zh',useLocation:false,bgEnabled:true,bgColor:'#f0e9e2',bgOpacity:0.92,textMode:'dark',soundEnabled:true,windowPosition:'center',sedentaryEnabled:false,sedentaryMinutes:30,eyeEnabled:false,eyeMinutes:20,codexEnabled:false,codexMinutes:300}};
const sound=createSoundEngine(true);let wellnessStatus={};
let scene=null,editing=null,weather=null,weatherError='',weatherLoading=false,weatherRequest=0,saveQueue=Promise.resolve(),statusTimer;
const weekdays=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
const parseDate=key=>new Date(key+'T12:00:00');
const T=(key,vars={})=>t(key,state.settings.language,vars);
const locale=()=>state.settings.language==='en'?'en-US':'zh-CN';
const staticText=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.textContent.trim()&&node.parentElement.tagName!=='SCRIPT')staticText.push([node,node.textContent]);}
const staticAttributes=[];document.querySelectorAll('[aria-label],[placeholder]').forEach(el=>{for(const attr of ['aria-label','placeholder'])if(el.hasAttribute(attr))staticAttributes.push([el,attr,el.getAttribute(attr)]);});
function localize(){
 document.documentElement.lang=state.settings.language==='en'?'en':'zh-CN';document.title=T('appTitle');
 for(const [node,original] of staticText)if(node.isConnected)node.textContent=translate(original,state.settings.language);
 for(const [el,attr,original] of staticAttributes)el.setAttribute(attr,translate(original,state.settings.language));
 document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=T(el.dataset.i18n));
 document.querySelector('[data-i18n="backgroundOpacity"]').textContent=state.settings.language==='en'?'Opacity':'不透明度';
 document.querySelectorAll('.weekdays span').forEach((el,i)=>el.textContent=new Intl.DateTimeFormat(locale(),{weekday:'short'}).format(new Date(2026,9,18+i)).replace('周',''));
 $('storageNote').textContent=T(desktop?'storageLocal':'storageBrowser');$('backgroundNote').textContent=T(desktop?'backgroundNote':'backgroundBrowser');
 $('rollDescription').textContent=state.settings.language==='en'?'A little cube rolls along the taskbar, then bounces at the center.':'独立方块沿任务栏滚入，在屏幕中间弹跳。';
 $('saveReminder').innerHTML=T(editing?'saveChanges':'addReminder')+' '+icon('arrow-up-right');
 $('testReminder').innerHTML=icon('bell')+T('testReminder');$('toastOpen').innerHTML=T('viewDay')+' '+icon('arrow-up-right');
}
function applyAppearance(){
 const s=state.settings;const color=/^#[0-9a-f]{6}$/i.test(s.bgColor)?s.bgColor:'#f0e9e2';const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)).join(',');
 document.body.dataset.palette=s.palette;document.body.classList.toggle('no-panel-background',!s.bgEnabled||s.bgOpacity===0);
 document.body.dataset.textMode=s.textMode;document.body.dataset.sound=s.soundEnabled?'enabled':'disabled';sound.setEnabled(s.soundEnabled);
 document.documentElement.style.setProperty('--panel-color',`rgba(${rgb},${s.bgEnabled?s.bgOpacity:0})`);
 const c=color.slice(1).match(/../g).map(v=>parseInt(v,16));document.body.classList.toggle('dark-panel',s.bgEnabled&&s.bgOpacity>.35&&(c[0]*.2126+c[1]*.7152+c[2]*.0722)<112);
 scene?.setTheme(s.palette);scene?.setShape(s.blockShape);$('blockShape').value=s.blockShape;$('bgEnabled').checked=s.bgEnabled;$('bgColor').value=color;$('bgOpacity').value=Math.round(s.bgOpacity*100);$('opacityValue').textContent=Math.round(s.bgOpacity*100)+'%';$('bgColor').disabled=!s.bgEnabled;$('bgOpacity').disabled=!s.bgEnabled;
 $('languageSelect').value=s.language;$('useLocation').checked=s.useLocation;document.querySelectorAll('.palette-option[data-palette]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.palette===s.palette)));
 $('textMode').value=s.textMode;$('textModeRow').hidden=s.bgEnabled&&s.bgOpacity>0;$('windowPosition').value=s.windowPosition;$('soundEnabled').checked=s.soundEnabled;
 for(const kind of ['sedentary','eye','codex']){$(kind+'Enabled').checked=s[kind+'Enabled'];$(kind+'Minutes').value=s[kind+'Minutes'];$(kind+'Minutes').disabled=!s[kind+'Enabled'];}renderWellness();
}
const safeState=raw=>{const next={reminders:Array.isArray(raw?.reminders)?raw.reminders.filter(r=>r&&typeof r.id==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)&&typeof r.title==='string'&&/^\d{2}:\d{2}$/.test(r.time)):[],settings:{...state.settings,...raw?.settings}};next.settings.palette=({macaron:'butter',garden:'rose',dusk:'lavender'})[next.settings.palette]||next.settings.palette;return next;};
function renderWellness(){for(const kind of ['sedentary','eye','codex']){const node=$(kind+'Status');if(!node)return;const status=wellnessStatus[kind];node.replaceChildren();const label=document.createElement('span');label.textContent=!state.settings[kind+'Enabled']?T('wellnessOff'):!desktop?T('wellnessDesktop'):status?.phase==='awaiting'?T('wellnessAwaiting'):T('wellnessNext',{minutes:Math.max(1,Math.ceil((status?.remainingMs??state.settings[kind+'Minutes']*60000)/60000))});node.append(label);if(status?.phase==='awaiting'&&state.settings[kind+'Enabled']){for(const [key,handler] of [['acknowledge',()=>desktop.acknowledgeWellness(kind,status.pendingId)],['redisplay',()=>desktop.redisplayWellness(kind)]]){const button=document.createElement('button');button.type='button';button.className='quiet-button';button.textContent=T(key);button.onclick=async()=>{if(key==='acknowledge')sound.acknowledge();await handler();await refreshWellness();};node.append(button);}}}}
async function refreshWellness(){if(desktop?.getWellnessStatus){wellnessStatus=await desktop.getWellnessStatus();renderWellness();}}
const announce=text=>{clearTimeout(statusTimer);$('status').textContent=text;$('status').hidden=false;statusTimer=setTimeout(()=>$('status').hidden=true,3500);};
async function persist(){
 const snapshot=structuredClone(state);
 const operation=saveQueue.then(async()=>{if(desktop){const saved=await desktop.saveState(snapshot);for(const current of state.reminders){const canonical=saved?.reminders?.find(r=>r.id===current.id&&r.date===current.date&&r.time===current.time);if(canonical?.notifiedAt)current.notifiedAt=canonical.notifiedAt;}}else localStorage.setItem('time3.state.v1',JSON.stringify(snapshot));});
 saveQueue=operation.catch(()=>{});await operation;
}
async function commitSettings(){try{await persist();}catch{announce(T('settingsSaveFailed'));}}
function updateSettings(){document.body.classList.remove('roll','smooth');document.body.classList.add(state.settings.motion==='smooth'?'smooth':'roll');$('cityInput').value=state.settings.city;$('pinButton').setAttribute('aria-pressed',String(state.settings.alwaysOnTop));document.querySelectorAll('[data-motion]').forEach(el=>el.classList.toggle('active',el.dataset.motion===state.settings.motion));localize();applyAppearance();}
function updateMonth(){
 $('monthTitle').textContent=state.settings.language==='en'?new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long'}).format(new Date(viewYear,viewMonth,1)):`${viewYear}年 ${viewMonth+1}月`;
 const cells=monthCells(viewYear,viewMonth).map(cell=>({...cell,notes:dateObservances(cell.date,state.settings.language)}));$('dateGrid').style.setProperty('--rows',cells.length/7);
 $('dateGrid').replaceChildren();
 cells.forEach((cell,index)=>{const btn=document.createElement('button');btn.className='date-cell'+(!cell.inMonth?' outside':'')+([0,6].includes(index%7)?' weekend':'')+(cell.key===selected?' selected':'');btn.dataset.date=cell.key;btn.textContent=cell.day;btn.title=cell.notes.join(' · ');if(cell.notes.length){const sub=document.createElement('small');sub.textContent=cell.notes.join(' · ');btn.append(sub);}btn.setAttribute('aria-label',`${cell.key} ${cell.notes.join(' · ')}${cell.key===today()?' '+T('today'):''}${state.reminders.some(r=>r.date===cell.key&&!r.done)?' '+T('hasReminders'):''}`);btn.setAttribute('aria-pressed',String(cell.key===selected));if(cell.key===today())btn.setAttribute('aria-current','date');btn.addEventListener('click',()=>selectDate(cell.key));btn.addEventListener('pointerenter',()=>scene?.setHover(cell.key));btn.addEventListener('pointerleave',()=>scene?.setHover(null));btn.addEventListener('focus',()=>scene?.setHover(cell.key));btn.addEventListener('blur',()=>scene?.setHover(null));btn.addEventListener('keydown',event=>{const jump={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];if(jump!==undefined){event.preventDefault();const d=parseDate(cell.key);d.setDate(d.getDate()+jump);selectDate(dateKey(d));requestAnimationFrame(()=>document.querySelector(`[data-date="${dateKey(d)}"]`)?.focus());}});$('dateGrid').append(btn);});
 $('dateGrid').querySelector('[aria-current="date"]')?.classList.add('today');
 scene?.setDates(cells,selected,today(),state.reminders);
 if(scene){positionTargets();setTimeout(positionTargets,800);}
 const prefix=`${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
 const count=state.reminders.filter(r=>r.date.startsWith(prefix)&&!r.done).length;
 $('monthCount').textContent=count?T('monthCount',{count}):T('monthEmpty');
}
function positionTargets(){const grid=$('dateGrid');if(!scene){document.querySelector('.weekdays').classList.add('fallback-weekdays');return;}grid.style.inset='0';grid.style.display='block';grid.querySelectorAll('button').forEach(btn=>{const r=scene.getCellRect(btn.dataset.date);if(r)Object.assign(btn.style,{position:'absolute',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});});const centers=scene.getColumnCenters();document.querySelectorAll('.weekdays span').forEach((el,i)=>el.style.left=centers[i]+'px');}
function selectDate(key){selected=key;const date=parseDate(key);viewYear=date.getFullYear();viewMonth=date.getMonth();cancelEdit();$('daySheet').hidden=false;$('reopenDetail').hidden=true;updateMonth();updateDay();$('daySheet').classList.remove('switching');void $('daySheet').offsetWidth;$('daySheet').classList.add('switching');}
function updateDay(){const date=parseDate(selected);$('dayContext').textContent=T(selected===today()?'dayContextToday':'dayContextOther',{year:viewYear});$('dayTitle').textContent=state.settings.language==='en'?new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric'}).format(date):`${date.getMonth()+1}月${date.getDate()}日`;$('daySubtitle').textContent=`${new Intl.DateTimeFormat(locale(),{weekday:'long'}).format(date)} · ${lunarLabel(date,state.settings.language)}`;$('dateToken').textContent=date.getDate();$('dateToken').classList.toggle('is-today',selected===today());const note=[...new Set([...dateObservances(date,state.settings.language),occasion(date,state.settings.language)].filter(Boolean))].join(' · ');$('occasion').hidden=!note;$('occasionText').textContent=note;renderReminders();renderWeather();}
function renderReminders(){const list=$('reminderList');list.replaceChildren();const reminders=state.reminders.filter(r=>r.date===selected).sort((a,b)=>a.time.localeCompare(b.time));$('agendaCount').textContent=reminders.length?T('agendaCount',{done:reminders.filter(r=>r.done).length,total:reminders.length}):T('agendaEmpty');if(!reminders.length){const empty=document.createElement('div');empty.className='empty-day';empty.innerHTML='<strong>'+T('emptyTitle')+'</strong>'+T('emptyBody');list.append(empty);return;}for(const r of reminders){const row=document.createElement('div');row.className='reminder-row'+(r.done?' done':'');const check=document.createElement('button');check.className='check-button';check.setAttribute('aria-label',r.done?T('markIncomplete'):T('markComplete'));check.setAttribute('aria-pressed',String(r.done));check.innerHTML=r.done?icon('check'):'';check.onclick=async()=>{const previous=r.done;r.done=!r.done;try{await persist();renderReminders();updateMonth();}catch{r.done=previous;announce(T('saveFailed'));}};const content=document.createElement('button');content.className='reminder-content';content.setAttribute('aria-label',T('editReminder',{title:r.title}));const title=document.createElement('strong');title.textContent=r.title;const time=document.createElement('small');time.textContent=`${r.time}${r.notifiedAt?' · '+T('reminded'):''}`;content.append(title,time);content.onclick=()=>{editing=r.id;$('reminderTitle').value=r.title;$('reminderTime').value=r.time;$('saveReminder').textContent=T('saveChanges');$('cancelEdit').hidden=false;$('reminderTitle').focus();};const del=document.createElement('button');del.className='icon-button delete-reminder';del.setAttribute('aria-label',T('deleteReminder',{title:r.title}));del.innerHTML=icon('trash');del.onclick=async()=>{const previous=[...state.reminders];state.reminders=state.reminders.filter(item=>item.id!==r.id);try{await persist();if(editing===r.id)cancelEdit();renderReminders();updateMonth();announce(T('reminderDeleted'));}catch{state.reminders=previous;announce(T('deleteFailed'));}};row.append(check,content,del);list.append(row);}}
function cancelEdit(){editing=null;$('reminderTitle').value='';$('saveReminder').innerHTML=T('addReminder')+' '+icon('arrow-up-right');$('cancelEdit').hidden=true;$('formError').hidden=true;const d=new Date();$('reminderTime').dataset.dirty='false';$('reminderTime').value=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
async function saveReminder(event){event.preventDefault();const title=$('reminderTitle').value.trim(),time=$('reminderTime').value;if(!title||!/^\d{2}:\d{2}$/.test(time))return;const existing=state.reminders.find(r=>r.id===editing);const r={id:editing||crypto.randomUUID(),title,time,date:selected,done:existing?.done||false};if(existing?.date===r.date&&existing?.time===r.time&&existing?.notifiedAt)r.notifiedAt=existing.notifiedAt;const previous=structuredClone(state.reminders);state.reminders=editing?state.reminders.map(item=>item.id===editing?r:item):[...state.reminders,r];$('saveReminder').disabled=true;try{await persist();cancelEdit();renderReminders();updateMonth();announce(new Date(`${r.date}T${r.time}:00`)<=new Date()?(desktop?T('savedCatchup'):T('savedPast')):T('savedUpcoming'));}catch{$('formError').textContent=T('reminderSaveFailed');$('formError').hidden=false;state.reminders=previous;}finally{$('saveReminder').disabled=false;}}
function renderWeather(){const w=weather?.days?.[selected];$('weather').classList.toggle('unavailable',!w);$('weather').classList.toggle('clear',w?.code===0);$('weather').classList.toggle('overcast',w?.code>=3&&w?.code<50);$('weather').classList.toggle('rainy',w?.code>=50);$('weatherTemp').textContent=w?(w.temp==null?`${Math.round(w.min)}–${Math.round(w.max)}°`:`${Math.round(w.temp)}°`):'—';let city=weather?.city||state.settings.city;if(state.settings.language==='en'&&city==='厦门')city='Xiamen';if(state.settings.language==='zh'&&city==='Xiamen')city='厦门';$('weatherLabel').textContent=`${city} · ${w?weatherLabel(w.code,state.settings.language)+(w.temp==null?' · '+T('forecast'):''):weatherLoading?T('weatherLoading'):weatherError?T('weatherUnavailable'):T('noForecast')}`;$('weatherRange').textContent=w&&w.temp!=null?`${Math.round(w.min)}° / ${Math.round(w.max)}°`:'';}
async function getCurrentLocation(){if(desktop)return desktop.getLocation();return new Promise((resolve,reject)=>{if(!navigator.geolocation)return reject(Error('Location unavailable'));navigator.geolocation.getCurrentPosition(pos=>resolve({latitude:pos.coords.latitude,longitude:pos.coords.longitude}),reject,{enableHighAccuracy:false,timeout:15000,maximumAge:300000});});}
async function loadWeather(){const request=++weatherRequest;weatherLoading=true;weatherError='';renderWeather();$('cityStatus').textContent=T('weatherLoadingStatus');let locationFailed=false;try{let target=state.settings.city;if(state.settings.useLocation){$('cityStatus').textContent=T('locationRequest');try{const coords=await getCurrentLocation();target={...coords,name:T('currentLocation')};}catch{locationFailed=true;}if(request!==weatherRequest)return;}const result=await fetchWeather(target,state.settings.language);if(request!==weatherRequest)return;weather=result;weatherError='';$('cityStatus').textContent=T(locationFailed?'locationUnavailable':'weatherUpdated');}catch(error){if(request!==weatherRequest)return;weather=null;weatherError=error.message;$('cityStatus').textContent=T(locationFailed?'locationUnavailable':'weatherRetry');}finally{if(request===weatherRequest){weatherLoading=false;renderWeather();}}}
function openSettings(open){$('settingsSheet').hidden=!open;$('settingsButton').setAttribute('aria-expanded',String(open));if(open){$('closeSettings').focus();refreshWellness();}}
function showToast(reminder){const health=reminder?.kind==='wellness';$('toastTitle').textContent=reminder?.title||T('defaultReminder');$('toastView').hidden=false;$('toastOpen').textContent=T(health?'acknowledge':'viewDay');$('toastOpen').onclick=async()=>{if(desktop){sound.acknowledge();if(health){await new Promise(resolve=>setTimeout(resolve,140));desktop.acknowledgeReminder();}else desktop.openReminder(reminder?.date||today());}else{$('toastView').hidden=true;expand();selectDate(reminder?.date||today());}};sound.notify();if(!desktop){$('toastView').style.cssText='position:fixed;right:20px;top:20px;width:380px;z-index:30';setTimeout(()=>$('toastView').hidden=true,9000);}}
async function collapse(){if(desktop){await desktop.setMini(true);}else{$('mainApp').classList.add('collapsed');$('miniView').hidden=false;document.body.classList.add('preview-mini');$('miniDay').textContent=new Date().getDate();}}
function expand(){if(desktop)desktop.show();else{$('mainApp').classList.remove('collapsed');$('miniView').hidden=true;document.body.classList.remove('preview-mini');scene?.resize();}}
async function boot(){
 if(desktop)document.body.classList.add('desktop');
 try{const raw=desktop?await desktop.getState():JSON.parse(localStorage.getItem('time3.state.v1')||'null');if(raw)state=safeState(raw);}catch{announce(T('dataReadFailed'));}
 updateSettings();
 document.addEventListener('click',event=>{if(event.target.closest('button,input[type="checkbox"],select'))sound.click();});
 desktop?.onStateChanged(raw=>{state=safeState(raw);updateSettings();if(mode==='main'){updateMonth();updateDay();}});
 if(mode==='mini'||mode==='toast'){document.body.classList.add('auxiliary');$('mainApp').hidden=true;if(mode==='mini'){$('miniView').hidden=false;$('miniDay').textContent=new Date().getDate();initMini({element:$('expandMini'),desktop,onClick:expand});desktop?.onMiniAlert?.(()=>{const el=$('expandMini');el.getAnimations().forEach(a=>a.cancel());const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;el.animate(reduced?[{opacity:1},{opacity:.65},{opacity:1}]:[{translate:'0 0',rotate:'0deg'},{translate:'0 -8px',rotate:'-9deg'},{translate:'0 -3px',rotate:'8deg'},{translate:'0 -6px',rotate:'-6deg'},{translate:'0 0',rotate:'0deg'}],{duration:700,iterations:3,easing:'ease-in-out'});});setInterval(()=>$('miniDay').textContent=new Date().getDate(),60000);}else{desktop?.onReminder(showToast);const reminder=await desktop?.getToast();showToast(reminder);$('toastClose').onclick=()=>desktop?.dismissToast();document.addEventListener('keydown',event=>{if(event.key==='Escape')desktop?.dismissToast();});}return;}
 try{scene=createScene($('scene'),{onSelect:selectDate});}catch(error){console.warn('3D unavailable; using tactile fallback',error);$('calendarStage').classList.add('fallback');}
 scene?.setTheme(state.settings.palette);scene?.setShape(state.settings.blockShape);cancelEdit();updateMonth();updateDay();loadWeather();
 new ResizeObserver(()=>{scene?.resize();positionTargets();}).observe($('scene'));
 $('prevMonth').onclick=()=>changeMonth(-1);$('nextMonth').onclick=()=>changeMonth(1);$('todayButton').onclick=()=>selectDate(today());
 $('settingsButton').onclick=()=>openSettings($('settingsSheet').hidden);$('closeSettings').onclick=()=>openSettings(false);
 document.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>{const scroller=document.querySelector('.settings-scroll'),section=$(button.dataset.section);scroller.scrollTo({top:section.offsetTop-scroller.offsetTop,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
 $('collapseDetail').onclick=()=>{$('daySheet').hidden=true;$('reopenDetail').hidden=false;};$('reopenDetail').onclick=()=>{$('daySheet').hidden=false;$('reopenDetail').hidden=true;};
 $('reminderForm').onsubmit=saveReminder;$('cancelEdit').onclick=cancelEdit;
 $('saveCity').onclick=async()=>{const city=$('cityInput').value.trim();if(!city)return;state.settings.city=city;await commitSettings();loadWeather();};
 $('blockShape').onchange=async()=>{state.settings.blockShape=$('blockShape').value;applyAppearance();await commitSettings();};
 document.querySelectorAll('.palette-option[data-palette]').forEach(btn=>btn.onclick=async()=>{state.settings.palette=btn.dataset.palette;applyAppearance();await commitSettings();});
 $('languageSelect').onchange=async event=>{state.settings.language=event.target.value;updateSettings();updateMonth();updateDay();await commitSettings();loadWeather();};
 $('useLocation').onchange=async event=>{state.settings.useLocation=event.target.checked;await commitSettings();loadWeather();};
 $('bgEnabled').onchange=async event=>{state.settings.bgEnabled=event.target.checked;applyAppearance();await commitSettings();};
 $('bgColor').oninput=event=>{state.settings.bgColor=event.target.value;applyAppearance();};$('bgColor').onchange=commitSettings;
 $('bgOpacity').oninput=event=>{state.settings.bgOpacity=Number(event.target.value)/100;applyAppearance();};$('bgOpacity').onchange=commitSettings;
 for(const key of ['textMode','windowPosition'])$(key).onchange=async event=>{state.settings[key]=event.target.value;applyAppearance();await commitSettings();if(key==='windowPosition'&&!desktop)announce(T('desktopOnly'));};
 $('soundEnabled').onchange=async event=>{state.settings.soundEnabled=event.target.checked;applyAppearance();await commitSettings();};
 for(const kind of ['sedentary','eye','codex']){for(const suffix of ['Enabled','Minutes'])$(kind+suffix).onchange=async event=>{state.settings[kind+suffix]=suffix==='Enabled'?event.target.checked:Number(event.target.value);applyAppearance();await commitSettings();await refreshWellness();};}
 document.querySelectorAll('[data-wellness-preview]').forEach(button=>button.onclick=()=>desktop?desktop.testWellness(button.dataset.wellnessPreview):announce(T('desktopOnly')));
 desktop?.onWellnessState(status=>{wellnessStatus=status;renderWellness();});refreshWellness();setInterval(()=>{if(!$('settingsSheet').hidden)refreshWellness();},10000);
 document.querySelectorAll('[data-motion]').forEach(btn=>btn.onclick=async()=>{state.settings.motion=btn.dataset.motion;updateSettings();await commitSettings();});
 $('pinButton').onclick=async()=>{if(!desktop){announce(T('pinDesktopOnly'));return;}state.settings.alwaysOnTop=!state.settings.alwaysOnTop;await desktop.setAlwaysOnTop(state.settings.alwaysOnTop);updateSettings();await commitSettings();};
 $('miniButton').onclick=collapse;$('hideButton').onclick=()=>desktop?desktop.hide():collapse();$('expandMini').onclick=expand;
 $('testReminder').onclick=()=>{const reminder={title:T('defaultReminder'),date:selected,time:$('reminderTime').value};if(desktop)desktop.testNotification(reminder);else if(state.settings.motion==='roll')announce(state.settings.language==='en'?'Try the rolling cube in the desktop app.':'请在桌面版中体验沿任务栏翻滚的独立方块。');else showToast(reminder);};$('toastClose').onclick=()=>$('toastView').hidden=true;
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!$('settingsSheet').hidden)openSettings(false);else if(editing)cancelEdit();}});
 let lastSystemDay=today();
 function syncSystemClock(clock){if(!clock)return;const previous=lastSystemDay;lastSystemDay=clock.date;if(clock.date!==previous){if(selected===previous){selected=clock.date;const date=parseDate(selected);viewYear=date.getFullYear();viewMonth=date.getMonth();}updateMonth();updateDay();}if(!editing&&$('reminderTime').dataset.dirty!=='true')$('reminderTime').value=clock.time;}
 $('reminderTime').addEventListener('input',()=>{$('reminderTime').dataset.dirty='true';});
 desktop?.onSystemClock?.(syncSystemClock);if(desktop?.getSystemClock)syncSystemClock(await desktop.getSystemClock());
 desktop?.onOpenDate(key=>{if(key&&key!==selected)selectDate(key);});
 desktop?.onReminder(()=>{desktop.getState().then(raw=>{if(raw){state=safeState(raw);renderReminders();}});});
 if(!desktop){$('backgroundNote').textContent=T('backgroundBrowser');$('storageNote').textContent=T('storageBrowser');setInterval(async()=>{const now=Date.now();const due=state.reminders.filter(r=>!r.done&&!r.notifiedAt&&new Date(`${r.date}T${r.time}:00`).getTime()<=now&&now-new Date(`${r.date}T${r.time}:00`).getTime()<60000);for(const r of due){r.notifiedAt=new Date().toISOString();showToast(r);}if(due.length){await persist();renderReminders();}},1000);}
 let lastDay=today();setInterval(()=>{const current=today();if(current!==lastDay){lastDay=current;updateMonth();updateDay();loadWeather();}},30000);
}
function changeMonth(delta){const next=shiftMonth(viewYear,viewMonth,delta);viewYear=next.year;viewMonth=next.month;const day=Math.min(parseDate(selected).getDate(),new Date(viewYear,viewMonth+1,0).getDate());selected=dateKey(new Date(viewYear,viewMonth,day));cancelEdit();updateMonth();updateDay();}
boot().catch(error=>{console.error(error);announce(T('startupFailed'));});
