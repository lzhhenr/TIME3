const {app,BrowserWindow}=require('electron');
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.resolve(process.env.TIME3_TEST_OUTPUT || 'output/tauri-smoke');
const pid=Number(fs.readFileSync(path.join(output,'process-id.txt'),'utf8'));
app.setPath('userData',path.join(output,'competitor-profile'));
app.whenReady().then(async()=>{
 let rival,browser;const checks=[];
 try{
 browser=await chromium.connectOverCDP('http://127.0.0.1:9223');const ctx=browser.contexts()[0];const main=ctx.pages().find(p=>p.url()==='http://tauri.localhost/');
 const rpc=(p,method,...args)=>p.evaluate(({method,args})=>__TAURI__.core.invoke('desktop',{method,args}),{method,args});
 const probe={nativeProbe:Date.now()};await rpc(main,'app:diagnostic',probe);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'data/diagnostic-main.json'),'utf8')),probe);
 await rpc(main,'window:show');await rpc(main,'window:top',true);const mainBounds=(await rpc(main,'app:diagnostic',{})).bounds;
 rival=new BrowserWindow({show:false,fullscreen:true,alwaysOnTop:true,skipTaskbar:true,webPreferences:{sandbox:true}});
 await rival.loadURL('data:text/html,<body style="background:%2326282f;color:white;font:24px Segoe UI;padding:50px">TIME3 fullscreen reminder test — closes automatically</body>');rival.show();rival.focus();rival.moveTop();await wait(1100);
 const stack=()=>JSON.parse(execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-File',path.resolve('scripts/read-native-stack.ps1'),'-TargetProcess',String(pid),'-RivalProcess',String(process.pid)],{encoding:'utf8',windowsHide:true}));
 const match=(list,b)=>list.find(w=>w.pid===pid&&Math.abs(w.x-b.x)<3&&Math.abs(w.y-b.y)<3&&Math.abs(w.width-b.width)<3&&Math.abs(w.height-b.height)<3);
 let list=stack();let other=list.find(w=>w.handle===rival.getNativeWindowHandle().readBigUInt64LE().toString());let cal=match(list,mainBounds);fs.writeFileSync(path.join(output,'native-baseline.json'),JSON.stringify(list));assert(cal.z<other.z);const focusBefore=list[0]?.foreground;assert(focusBefore,'Baseline foreground window must be known');checks.push('Pinned calendar recovers above fullscreen topmost competitor');
 for(const motion of ['smooth','roll']){
  await main.evaluate(async motion=>{let s=await desktop.getState();s.settings.motion=motion;await desktop.saveState(s);await desktop.testNotification({title:'Fullscreen layering test'});},motion);
  let popup;for(let i=0;i<100;i++){popup=ctx.pages().find(p=>p.url().includes(motion==='roll'?'roller.html':'mode=toast'));if(popup)break;await wait(100);}assert(popup);
  await popup.waitForFunction(()=>window.desktop);await wait(1500);const diag=await rpc(popup,'app:diagnostic',{});rival.moveTop();await wait(1100);list=stack();other=list.find(w=>w.handle===rival.getNativeWindowHandle().readBigUInt64LE().toString());const rem=match(list,diag.bounds);cal=match(list,mainBounds);fs.writeFileSync(path.join(output,'native-'+motion+'.json'),JSON.stringify(list));assert(rem.z<other.z);assert(rem.z<cal.z);assert.equal(list[0]?.foreground,focusBefore);checks.push(motion+' reminder recovers above competitor and pinned calendar without taking focus');
  await rpc(popup,'reminder:dismiss').catch(e=>{if(!/closed/.test(e.message))throw e;});
 }
 fs.writeFileSync(path.join(output,'native-report.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
 }catch(e){fs.writeFileSync(path.join(output,'native-report.json'),JSON.stringify({passed:false,checks,error:e.stack},null,2));console.error(e);process.exitCode=1;}
 finally{rival?.destroy();await browser?.close();app.exit(process.exitCode||0);}
});
