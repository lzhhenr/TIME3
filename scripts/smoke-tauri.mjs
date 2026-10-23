import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const output=path.resolve('output/tauri-smoke');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
const context=browser.contexts()[0];
const main=context.pages().find(p=>p.url()==='http://tauri.localhost/'||p.url().endsWith('/index.html'));
assert(main,'Main TIME3 WebView is present');
const checks=[],errors=[];
const watch=p=>p.on('pageerror',e=>errors.push(e.message));context.pages().forEach(watch);context.on('page',watch);
const rpc=(p,method,...args)=>p.evaluate(({method,args})=>window.__TAURI__.core.invoke('desktop',{method,args}),{method,args});
const dismiss=async(p,method)=>{await rpc(p,method).catch(e=>{if(!/closed/.test(e.message))throw e;});};
async function test(name,fn){const result=await fn();checks.push({name,passed:true,...(result?{detail:result}:{})});console.log('PASS '+name);}
async function newPage(match){for(let i=0;i<100;i++){const p=context.pages().find(p=>!p.isClosed()&&match(p.url()));if(p){await p.waitForFunction(()=>!!window.desktop);return p;}await new Promise(r=>setTimeout(r,100));}throw Error('Reminder window not created');}
const probe={isolatedSmoke:Date.now()};await rpc(main,'app:diagnostic',probe);
assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,'data/diagnostic-main.json'),'utf8')),probe,'Must use isolated test profile');
try{
 await test('Native bridge and rendered calendar',async()=>{await main.waitForFunction(()=>document.querySelectorAll('#dateGrid button').length>=28);assert.equal(await main.evaluate(()=>desktop.runtime),'tauri');await main.screenshot({path:path.join(output,'main.png')});return await main.locator('#dateGrid button').count();});
 await test('Clock matches OS',async()=>{const c=await rpc(main,'system:get-clock');assert(Math.abs(Date.now()-c.epoch)<2000);return c;});
 if ((await rpc(main,'wellness:get-status')).codex.enabled) await test('Closing a real health reminder restarts five-hour timer',async()=>{const popup=await newPage(u=>u.includes('roller.html'));await popup.waitForFunction(()=>document.getElementById('roller').dataset.phase==='bouncing');const p=await rpc(popup,'reminder:get-toast');assert.equal(p.wellnessType,'codex');assert(!p.preview);await dismiss(popup,'reminder:dismiss');const s=(await rpc(main,'wellness:get-status')).codex;assert.equal(s.phase,'counting');assert(s.remainingMs>299*60000&&s.remainingMs<=300*60000);return s;});
 let raw=await rpc(main,'calendar:get-state');if(!raw)raw={reminders:[],settings:{}};
 raw.settings={...raw.settings,soundEnabled:false,sedentaryEnabled:false,eyeEnabled:false,codexEnabled:false,alwaysOnTop:false,miniMode:false};
 raw.reminders=[{id:'smoke-future',date:'2099-01-01',time:'09:00',title:'Local persistence check',done:false}];
 await test('Local persistence and validation',async()=>{await rpc(main,'calendar:save-state',raw);const saved=JSON.parse(await fs.readFile(path.join(output,'data/calendar-state.json'),'utf8'));assert.equal(saved.reminders[0].title,raw.reminders[0].title);await assert.rejects(rpc(main,'calendar:save-state',{reminders:[{id:'bad'}],settings:{}}));});
 await test('Palette language and background settings',async()=>{raw=await rpc(main,'calendar:get-state');raw.settings={...raw.settings,palette:'lavender',language:'en',bgEnabled:false,textMode:'dark'};await rpc(main,'calendar:save-state',raw);await main.waitForTimeout(400);await main.screenshot({path:path.join(output,'appearance.png')});assert.equal((await rpc(main,'calendar:get-state')).settings.language,'en');});
 await test('Pin and native mini window',async()=>{await rpc(main,'window:top',true);await rpc(main,'window:mini',true);const mini=await newPage(u=>u.includes('mode=mini'));await mini.waitForFunction(()=>!document.getElementById('miniView').hidden);const dragging=await rpc(mini,'mini:begin-drag');assert(dragging.dragging);const ended=await rpc(mini,'mini:end-drag',true);assert(!ended.dragging);await assert.rejects(rpc(mini,'calendar:save-state',raw));await mini.evaluate(()=>document.getElementById('expandMini').click());await main.waitForTimeout(300);});
 await test('Smooth reminder and dismissal',async()=>{raw=await rpc(main,'calendar:get-state');raw.settings.motion='smooth';await rpc(main,'calendar:save-state',raw);await rpc(main,'reminder:test',{title:'Smooth reminder test'});const toast=await newPage(u=>u.includes('mode=toast'));await toast.waitForFunction(()=>document.getElementById('toastTitle').textContent==='Smooth reminder test');await toast.screenshot({path:path.join(output,'toast.png')});await dismiss(toast,'reminder:dismiss');});
 await test('Rolling reminder movement, floor, hit regions and acknowledgement',async()=>{raw=await rpc(main,'calendar:get-state');raw.settings.motion='roll';await rpc(main,'calendar:save-state',raw);await rpc(main,'wellness:test','eye');const roller=await newPage(u=>u.includes('roller.html'));await roller.waitForFunction(()=>document.getElementById('roller').dataset.phase==='bouncing');const p=await rpc(roller,'reminder:get-toast');assert(p.preview&&p.wellnessType==='eye');const diag=await rpc(roller,'app:diagnostic',{stage:'roller'});assert(diag.visible);assert(diag.regionCount>0);const d=await roller.evaluate(()=>({...document.getElementById('roller').dataset}));assert(Math.abs(Number(d.contactY)+Number(d.jump)-Number(d.floor))<3);assert.equal(diag.bounds.y+diag.bounds.height,diag.workArea.y+diag.workArea.height);await roller.screenshot({path:path.join(output,'roller.png')});await dismiss(roller,'reminder:acknowledge');return diag;});
 await test('Preview leaves wellness timers off',async()=>{const s=await rpc(main,'wellness:get-status');for(const k of ['eye','sedentary','codex'])assert.equal(s[k].phase,'off');});
 await test('Due reminder recorded only after display',async()=>{raw=await rpc(main,'calendar:get-state');const c=await rpc(main,'system:get-clock');raw.settings.motion='smooth';raw.reminders.push({id:'smoke-due',date:c.date,time:c.time,title:'System clock delivery',done:false});await rpc(main,'calendar:save-state',raw);const toast=await newPage(u=>u.includes('mode=toast'));await toast.waitForFunction(()=>document.getElementById('toastTitle').textContent==='System clock delivery');await main.waitForTimeout(300);const s=await rpc(main,'calendar:get-state');assert(s.reminders.find(r=>r.id==='smoke-due').notifiedAt);await dismiss(toast,'reminder:dismiss');});
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,manualChecks:['Physical drag distance and edge hover','Fullscreen competition and multi-monitor mixed DPI']},null,2));
}catch(error){await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:false,checks,errors,error:error.stack},null,2));throw error;}finally{await browser.close();}
