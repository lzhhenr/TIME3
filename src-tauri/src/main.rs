#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod native;
mod store;
use chrono::Local;
use serde_json::{json, Value};
use std::{collections::{HashMap, VecDeque}, path::PathBuf, sync::{Mutex, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WebviewWindowBuilder, WebviewUrl, PhysicalPosition, PhysicalSize};

struct Popup { payload: Value, opened: Instant, regions: Vec<Value> }
#[derive(Default)]
struct Runtime { popups: HashMap<String,Popup>, queue: VecDeque<(Value,bool)>, mini: native::MiniController }
struct Backend { store: Mutex<store::Store>, runtime: Mutex<Runtime>, data: PathBuf }
static SERIAL: AtomicU64 = AtomicU64::new(1);
fn backend(app:&AppHandle)->tauri::State<'_,Backend>{app.state::<Backend>()}
fn settings(app:&AppHandle)->Value{backend(app).store.lock().unwrap().settings()}
fn clock()->Value { let n=Local::now();json!({"epoch":n.timestamp_millis(),"date":n.format("%Y-%m-%d").to_string(),"time":n.format("%H:%M").to_string(),"offset":-n.offset().local_minus_utc()/60}) }
fn emit_state(app:&AppHandle){ let b=backend(app);let s=b.store.lock().unwrap();let _=app.emit("calendar:state-changed",s.get());let _=app.emit("wellness:state",s.wellness_status(Local::now())); }
fn base<'a>(app:&'a AppHandle,label:&str,url:&str)->WebviewWindowBuilder<'a,tauri::Wry,AppHandle>{
 WebviewWindowBuilder::new(app,label,WebviewUrl::App(url.into())).title("TIME³ · WebView2 试用版").decorations(false).transparent(true).shadow(false).visible(false).focused(false).maximizable(false).disable_drag_drop_handler().data_directory(backend(app).data.join("WebView2")).additional_browser_args("--autoplay-policy=no-user-gesture-required").on_navigation(|url|url.host_str()==Some("tauri.localhost")||url.scheme()=="tauri").on_page_load(|w,p|{if p.event()==tauri::webview::PageLoadEvent::Finished{let _=w.show();}})
}
fn place(w:&WebviewWindow,position:&str){
 let a=native::area(Some(w));let z=w.outer_size().unwrap_or(PhysicalSize::new(1180,820));let m=(16.0*a.scale) as i32;
 let x=if position.ends_with("left"){a.x+m}else if position.ends_with("right"){a.x+a.width as i32-z.width as i32-m}else{a.x+(a.width as i32-z.width as i32)/2};
 let y=if position.starts_with("top"){a.y+m}else if position.starts_with("bottom"){a.y+a.height as i32-z.height as i32-m}else{a.y+(a.height as i32-z.height as i32)/2};
 let _=w.set_position(PhysicalPosition::new(x.max(a.x),y.max(a.y)));
}
fn show_main(app:&AppHandle,date:Value){
 if let Some(w)=app.get_webview_window("mini"){let _=w.hide();backend(app).runtime.lock().unwrap().mini.on_hide(&w);}
 if let Some(w)=app.get_webview_window("main"){let _=w.unminimize();let _=w.show();let _=w.set_focus();let _=w.emit("calendar:open-date",date);}
}
fn show_mini(app:&AppHandle)->Result<(),String>{
 let w=if let Some(w)=app.get_webview_window("mini"){w}else{
  let a=native::area(None);
  let w=base(app,"mini","index.html?mode=mini").inner_size(112.0,112.0).resizable(false).skip_taskbar(true).always_on_top(true).build().map_err(|e|e.to_string())?;
  let _=w.set_position(PhysicalPosition::new(a.x+a.width as i32-(144.0*a.scale) as i32,a.y+a.height as i32-(144.0*a.scale) as i32));w
 };
 let _=w.show();backend(app).runtime.lock().unwrap().mini.on_show(&w);Ok(())
}
fn hide_main(app:&AppHandle){if let Some(w)=app.get_webview_window("main"){let _=w.hide();}if settings(app)["miniMode"]==true{let _=show_mini(app);}}
fn sync_settings(app:&AppHandle,old:&Value){
 let s=settings(app);if let Some(w)=app.get_webview_window("main"){let _=w.set_always_on_top(s["alwaysOnTop"]==true);if old["windowPosition"]!=s["windowPosition"]{place(&w,s["windowPosition"].as_str().unwrap_or("center"));}}
 if s["miniMode"]!=true {if let Some(w)=app.get_webview_window("mini"){let _=w.hide();}}
 prune(app);emit_state(app);
}
fn prune(app:&AppHandle){
 let b=backend(app);let s=b.store.lock().unwrap();let r=b.runtime.lock().unwrap();
 let stale:Vec<_>=r.popups.iter().filter(|(_,p)|p.payload["kind"]=="wellness"&&p.payload["preview"]!=true&&!s.is_pending(p.payload["wellnessType"].as_str().unwrap_or(""),p.payload["id"].as_str().unwrap_or(""))).map(|(k,_)|k.clone()).collect();drop(r);drop(s);
 for k in stale{close_popup(app,&k,false);}
}
fn close_popup(app:&AppHandle,label:&str,ack:bool){
 let p=backend(app).runtime.lock().unwrap().popups.remove(label);
 if let Some(p)=p {if ack&&p.payload["kind"]=="wellness"&&p.payload["preview"]!=true{let _=backend(app).store.lock().unwrap().ack(p.payload["wellnessType"].as_str().unwrap_or(""),p.payload["id"].as_str().unwrap_or(""),Local::now());}}
 if let Some(w)=app.get_webview_window(label){let _=w.destroy();}emit_state(app);
}
fn enqueue(app:&AppHandle,p:Value,preview:bool){let b=backend(app);let mut r=b.runtime.lock().unwrap();if !preview&&(r.queue.iter().any(|(q,_)|q["id"]==p["id"])||r.popups.values().any(|q|q.payload["id"]==p["id"])){return;}r.queue.push_back((p,preview));}
fn present_next(app:&AppHandle)->Result<(),String>{
 let s=settings(app);let roll=s["motion"]=="roll";
 let next={let b=backend(app);let mut r=b.runtime.lock().unwrap();if roll&&!r.popups.is_empty(){return Ok(());}r.queue.pop_front()};
 let Some((mut p,preview))=next else{return Ok(())};
 if !preview&&p["kind"]=="wellness"&&!backend(app).store.lock().unwrap().is_pending(p["wellnessType"].as_str().unwrap_or(""),p["id"].as_str().unwrap_or("")){return Ok(());}
 let label=format!("reminder-{}",SERIAL.fetch_add(1,Ordering::Relaxed));let a=native::area(None);let scale=a.scale;
 p["preview"]=json!(preview);p["language"]=s["language"].clone();p["soundEnabled"]=s["soundEnabled"].clone();p["motion"]=s["motion"].clone();p["deliveredAt"]=json!(Local::now().to_rfc3339());
 p["floor"]=json!((a.y as f64+a.height as f64)/scale);p["area"]=json!({"x":a.x as f64/scale,"y":a.y as f64/scale,"width":a.width as f64/scale,"height":a.height as f64/scale});
 let (width,height,x,y)=if roll {(a.width as f64/scale,360.0,a.x,a.y+a.height as i32-(360.0*scale) as i32)}else{let count=backend(app).runtime.lock().unwrap().popups.len().min(3);(420.0,180.0,a.x+a.width as i32-(442.0*scale) as i32,a.y+a.height as i32-((202+164*count)as f64*scale)as i32)};
 backend(app).runtime.lock().unwrap().popups.insert(label.clone(),Popup{payload:p.clone(),opened:Instant::now(),regions:vec![]});
 let result=base(app,&label,if roll{"roller.html"}else{"index.html?mode=toast"}).inner_size(width,height).resizable(false).skip_taskbar(true).always_on_top(true).focusable(false).build();
 match result {
  Ok(w)=>{let _=w.set_position(PhysicalPosition::new(x,y));if roll{let _=w.set_ignore_cursor_events(true);}if !preview{backend(app).store.lock().unwrap().mark_delivered(&p,Local::now())?;}let _=app.emit("reminder:fired",p.clone());
   if s["alwaysOnTop"]==true&&s["miniMode"]==true {if let Some(m)=app.get_webview_window("mini"){if m.is_visible().unwrap_or(false){backend(app).runtime.lock().unwrap().mini.reveal(&m,3200);let _=m.emit("mini:alert",p);}}}emit_state(app);Ok(())},
  Err(e)=>{backend(app).runtime.lock().unwrap().popups.remove(&label);Err(e.to_string())}
 }
}
fn require(role:&str,allowed:&[&str])->Result<(),String>{if allowed.contains(&role){Ok(())}else{Err("This window cannot perform that action".into())}}
#[tauri::command]
async fn desktop(app:AppHandle,window:WebviewWindow,method:String,args:Vec<Value>)->Result<Value,String>{
 let label=window.label().to_owned();let role=if label.starts_with("reminder-"){"reminder"}else{label.as_str()};require(role,&["main","mini","reminder"])?;
 let a=args.first().cloned().unwrap_or(Value::Null);let b=backend(&app);
 match method.as_str(){
 "system:get-clock"=>Ok(clock()),"calendar:get-state"=>Ok(b.store.lock().unwrap().get()),"app:version"=>Ok(json!(env!("CARGO_PKG_VERSION"))),
 "calendar:save-state"=>{require(role,&["main"])?;let old=settings(&app);let saved=b.store.lock().unwrap().save(a,Local::now())?;sync_settings(&app,&old);Ok(saved)},
 "location:get"=>{require(role,&["main"])?;if settings(&app)["useLocation"]!=true{return Err("Location is disabled".into());}let result=tauri::async_runtime::spawn_blocking(native::locate).await.map_err(|e|e.to_string())??;if settings(&app)["useLocation"]!=true{return Err("Location is disabled".into());}Ok(result)},
 "window:drag"=>{require(role,&["main"])?;window.start_dragging().map_err(|e|e.to_string())?;Ok(Value::Null)},
 "window:hide"=>{require(role,&["main"])?;hide_main(&app);Ok(Value::Null)},
 "window:show"=>{require(role,&["main","mini"])?;show_main(&app,a);Ok(Value::Null)},
 "window:top"|"window:mini"=>{require(role,&["main"])?;if !a.is_boolean(){return Err("Invalid setting".into());}let old=settings(&app);let mut state=b.store.lock().unwrap().get();if state.is_null(){state=json!({"reminders":[],"settings":old});}state["settings"][if method=="window:top"{"alwaysOnTop"}else{"miniMode"}]=a.clone();let saved=b.store.lock().unwrap().save(state,Local::now())?;sync_settings(&app,&old);if method=="window:mini"&&a==true{hide_main(&app);}Ok(saved)},
 "mini:get-state"=>{require(role,&["mini"])?;Ok(b.runtime.lock().unwrap().mini.state(&window))},
 "mini:begin-drag"=>{require(role,&["mini"])?;Ok(b.runtime.lock().unwrap().mini.start_drag(&window))},
 "mini:end-drag"=>{require(role,&["mini"])?;Ok(b.runtime.lock().unwrap().mini.end_drag(&window,a==true))},
 "wellness:get-status"=>{require(role,&["main"])?;Ok(b.store.lock().unwrap().wellness_status(Local::now()))},
 "wellness:acknowledge"=>{require(role,&["main"])?;let ok=b.store.lock().unwrap().ack(a.as_str().unwrap_or(""),args.get(1).and_then(Value::as_str).unwrap_or(""),Local::now())?;prune(&app);emit_state(&app);Ok(json!(ok))},
 "wellness:redisplay"=>{require(role,&["main"])?;let p=b.store.lock().unwrap().redisplay(a.as_str().unwrap_or(""),Local::now())?;if let Some(p)=p{enqueue(&app,p,false);}Ok(json!(true))},
 "wellness:test"=>{require(role,&["main"])?;let p=b.store.lock().unwrap().wellness_preview(a.as_str().unwrap_or(""),Local::now())?;enqueue(&app,p,true);Ok(json!(true))},
 "reminder:test"=>{require(role,&["main"])?;let c=clock();let title=a["title"].as_str().unwrap_or("留一点时间，给自己。");if title.len()>1200{return Err("Title too long".into());}let p=json!({"id":format!("preview-{}",SERIAL.fetch_add(1,Ordering::Relaxed)),"title":title,"date":a.get("date").unwrap_or(&c["date"]),"time":a.get("time").unwrap_or(&c["time"]),"done":false});enqueue(&app,p,true);Ok(json!(true))},
 "reminder:get-toast"=>{require(role,&["reminder"])?;Ok(b.runtime.lock().unwrap().popups.get(&label).map(|p|p.payload.clone()).unwrap_or(Value::Null))},
 "reminder:dismiss"|"reminder:acknowledge"=>{require(role,&["reminder"])?;close_popup(&app,&label,true);Ok(Value::Null)},
 "reminder:open"=>{require(role,&["reminder"])?;show_main(&app,a);close_popup(&app,&label,false);Ok(Value::Null)},
 "reminder:interactive"=>{require(role,&["reminder"])?;window.set_ignore_cursor_events(a!=true).map_err(|e|e.to_string())?;Ok(Value::Null)},
 "reminder:hit-regions"=>{require(role,&["reminder"])?;if let Some(p)=b.runtime.lock().unwrap().popups.get_mut(&label){p.regions=a.as_array().filter(|x|x.len()<20).cloned().unwrap_or_default();}Ok(Value::Null)},
 "app:diagnostic"=>{if std::env::var_os("TIME3_SMOKE_DATA").is_some(){let _=std::fs::write(b.data.join(format!("diagnostic-{}.json",label)),a.to_string());}Ok(Value::Null)},
 _=>Err(format!("Unknown desktop command: {method}"))
 }
}
fn poll(app:AppHandle){
 let mut second=Instant::now()-Duration::from_secs(2);let mut raise_at=Instant::now();
 loop{std::thread::sleep(Duration::from_millis(32));let b=backend(&app);
  if let Some(w)=app.get_webview_window("mini"){b.runtime.lock().unwrap().mini.tick(&w);}
  let mut expired=vec![];{let r=b.runtime.lock().unwrap();for (label,p) in &r.popups{
   if p.opened.elapsed().as_secs()>=if p.payload["motion"]=="roll"{45}else{18}{expired.push(label.clone());continue;}
   if p.payload["motion"]=="roll"{if let Some(w)=app.get_webview_window(label){let cursor=native::cursor();let pos=w.outer_position().unwrap_or_default();let scale=w.scale_factor().unwrap_or(1.0);let x=(cursor.0-pos.x)as f64/scale;let y=(cursor.1-pos.y)as f64/scale;
    let hit=p.regions.iter().any(|v|{let rx=v["x"].as_f64().unwrap_or(-9999.);let ry=v["y"].as_f64().unwrap_or(-9999.);x>=rx&&y>=ry&&x<=rx+v["width"].as_f64().unwrap_or(0.)&&y<=ry+v["height"].as_f64().unwrap_or(0.)});let _=w.set_ignore_cursor_events(!hit);
   }}
  }}for l in expired{close_popup(&app,&l,false);}
  if second.elapsed()>=Duration::from_secs(1){second=Instant::now();let due=b.store.lock().unwrap().tick(Local::now());match due{Ok(due)=>for p in due{enqueue(&app,p,false)},Err(e)=>eprintln!("Timer: {e}")}let _=app.emit("system:clock",clock());let status=b.store.lock().unwrap().wellness_status(Local::now());let _=app.emit("wellness:state",status);prune(&app);}
  if let Err(e)=present_next(&app){eprintln!("Reminder: {e}");}
  if raise_at.elapsed()>=Duration::from_millis(700){raise_at=Instant::now();let pin=settings(&app)["alwaysOnTop"]==true;for (label,w) in app.webview_windows(){if w.is_visible().unwrap_or(false)&&(label!="main"||pin){native::raise(&w);}}}
 }
}
fn main(){
 tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app,_,_|show_main(app,Value::Null))).invoke_handler(tauri::generate_handler![desktop]).setup(|app|{
  let root=PathBuf::from(std::env::var_os("APPDATA").ok_or("APPDATA unavailable")?);let smoke=std::env::var_os("TIME3_SMOKE_DATA");let data=smoke.clone().map(PathBuf::from).unwrap_or(root.join("TIME3-Tauri"));std::fs::create_dir_all(&data)?;
  if smoke.is_none()&&!data.join("migration-complete").exists(){for name in ["calendar-state.json","wellness-state.json"]{let old=root.join("TIME3").join(name);let new=data.join(name);if old.exists()&&!new.exists(){std::fs::copy(&old,&new)?;}}std::fs::write(data.join("migration-complete"),"Copied from TIME3; original data unchanged.")?;}
  let store=store::Store::load(data.clone()).map_err(std::io::Error::other)?;app.manage(Backend{store:Mutex::new(store),runtime:Mutex::new(Runtime::default()),data});let h=app.handle();let a=native::area(None);
  let w=base(h,"main","index.html").inner_size((a.width as f64/a.scale-24.0).min(1180.0),(a.height as f64/a.scale-24.0).min(820.0)).min_inner_size(720.0,600.0).always_on_top(settings(h)["alwaysOnTop"]==true).build()?;place(&w,settings(h)["windowPosition"].as_str().unwrap_or("center"));
  let open=tauri::menu::MenuItem::with_id(app,"open","打开 TIME³",true,None::<&str>)?;let mini=tauri::menu::MenuItem::with_id(app,"mini","悬浮方块",true,None::<&str>)?;let quit=tauri::menu::MenuItem::with_id(app,"quit","退出（停止提醒）",true,None::<&str>)?;let menu=tauri::menu::Menu::with_items(app,&[&open,&mini,&quit])?;
  tauri::tray::TrayIconBuilder::new().icon(app.default_window_icon().unwrap().clone()).tooltip("TIME³ · WebView2 试用版").menu(&menu).show_menu_on_left_click(false).on_menu_event(|app,e|match e.id.as_ref(){"open"=>show_main(app,Value::Null),"mini"=>{if let Some(w)=app.get_webview_window("main"){let _=w.hide();}let _=show_mini(app);},"quit"=>app.exit(0),_=>{}}).on_tray_icon_event(|tray,event|{if matches!(event,tauri::tray::TrayIconEvent::Click{button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..}){show_main(tray.app_handle(),Value::Null);}}).build(app)?;
  let handle=app.handle().clone();std::thread::spawn(move||poll(handle));Ok(())
 }).on_window_event(|w,event|{if w.label()=="main"{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();hide_main(w.app_handle());}}}).build(tauri::generate_context!()).expect("Unable to start TIME3").run(|_,event|{if let tauri::RunEvent::ExitRequested{code:None,api,..}=event{api.prevent_exit();}});
}
