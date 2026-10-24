//! Electron-compatible local calendar and wellness storage.
//! All deadlines use the system wall clock. A delivered wellness reminder stays
//! pending until the user acknowledges or dismisses its native reminder window.
use chrono::{DateTime, Datelike, Local, NaiveDate, NaiveTime, TimeZone};
use serde_json::{json, Map, Value};
use std::{collections::HashSet, fs, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};

const DAY_MS: i64 = 86_400_000;
const MINUTE_MS: i64 = 60_000;
const KINDS: [&str; 3] = ["sedentary", "eye", "codex"];
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

pub fn default_settings() -> Value {
    json!({"motion":"roll","alwaysOnTop":false,"miniMode":false,"city":"厦门",
        "palette":"butter","blockShape":"classic","language":"en","useLocation":false,
        "bgEnabled":true,"bgColor":"#f0e9e2","bgOpacity":0.92,"textMode":"dark",
        "soundEnabled":true,"windowPosition":"center","sedentaryEnabled":false,
        "sedentaryMinutes":30,"eyeEnabled":false,"eyeMinutes":20,"codexEnabled":false,"codexMinutes":300})
}

fn one_of(value: &Value, choices: &[&str]) -> bool {
    value.as_str().is_some_and(|s| choices.contains(&s))
}

fn valid_date(value: &Value) -> bool {
    let Some(s) = value.as_str() else { return false };
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .is_ok_and(|d| (2020..=2200).contains(&d.year()) && d.format("%Y-%m-%d").to_string() == s)
}

fn valid_time(value: &Value) -> bool {
    let Some(s) = value.as_str() else { return false };
    s.len() == 5 && NaiveTime::parse_from_str(s, "%H:%M")
        .is_ok_and(|t| t.format("%H:%M").to_string() == s)
}

fn valid_id(value: &str, max_len: usize) -> bool {
    !value.is_empty() && value.len() <= max_len
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn validate(input: Value, previous: &Value, trusted: bool) -> Result<Value, String> {
    let reminders = input.get("reminders").and_then(Value::as_array).ok_or("日历数据格式无效")?;
    let settings = input.get("settings").and_then(Value::as_object).ok_or("日历数据格式无效")?;
    if reminders.len() > 2000 { return Err("提醒数量过多".into()) }
    let mut ids = HashSet::new();
    let mut cleaned_reminders = Vec::with_capacity(reminders.len());
    for reminder in reminders {
        let id = reminder["id"].as_str().ok_or("提醒 ID 无效")?;
        let title = reminder["title"].as_str().ok_or("提醒内容无效")?;
        if !valid_id(id, 100) || !ids.insert(id.to_owned()) || !valid_date(&reminder["date"])
            || !valid_time(&reminder["time"]) || title.trim().is_empty()
            || title.encode_utf16().count() > 300 || !reminder["done"].is_boolean() {
            return Err("提醒日期、时间或内容无效".into());
        }
        let mut clean = json!({"id":id,"date":reminder["date"],"time":reminder["time"],
            "title":title.trim(),"done":reminder["done"]});
        let old = previous["reminders"].as_array().and_then(|items| items.iter().find(|r| r["id"] == id));
        let marker = if trusted { reminder.get("notifiedAt") } else {
            old.filter(|r| r["date"] == reminder["date"] && r["time"] == reminder["time"])
                .and_then(|r| r.get("notifiedAt"))
        };
        if let Some(marker) = marker.filter(|v| v.as_str().is_some_and(|s| DateTime::parse_from_rfc3339(s).is_ok())) {
            clean["notifiedAt"] = marker.clone();
        }
        cleaned_reminders.push(clean);
    }
    let mut clean = default_settings();
    for (key, value) in settings {
        if clean.get(key).is_none() { continue }
        let valid = match key.as_str() {
            "motion" => one_of(value, &["roll", "smooth"]),
            "palette" => one_of(value, &["butter", "rose", "lavender", "monochrome", "green", "klein", "macaron", "garden", "dusk"]),
            "blockShape" => one_of(value, &["classic", "slab"]),
            "language" => one_of(value, &["zh", "en"]),
            "textMode" => one_of(value, &["light", "dark"]),
            "windowPosition" => one_of(value, &["center", "top-left", "bottom-left", "top-right", "bottom-right"]),
            "city" => value.as_str().is_some_and(|s| !s.trim().is_empty() && s.encode_utf16().count() <= 80),
            "bgColor" => value.as_str().is_some_and(|s| s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())),
            "bgOpacity" => value.as_f64().is_some_and(|n| n.is_finite() && (0.0..=1.0).contains(&n)),
            "sedentaryMinutes" => matches!(value.as_i64(), Some(30 | 60)),
            "eyeMinutes" => matches!(value.as_i64(), Some(20 | 30)),
            "codexMinutes" => value.as_i64() == Some(300),
            _ => value.is_boolean(),
        };
        if !valid { return Err(format!("设置值无效: {key}")) }
        clean[key] = value.clone();
    }
    clean["palette"] = match clean["palette"].as_str().unwrap_or("butter") {
        "macaron" => json!("butter"), "garden" => json!("rose"), "dusk" => json!("lavender"), _ => clean["palette"].clone(),
    };
    clean["city"] = json!(clean["city"].as_str().unwrap_or("厦门").trim());
    Ok(json!({"reminders":cleaned_reminders,"settings":clean}))
}

#[derive(Clone, Debug)]
struct Pending { id: String, raised_at: i64 }
#[derive(Clone, Debug)]
struct Timer { enabled: bool, minutes: i64, due_at: Option<i64>, pending: Option<Pending> }
impl Timer {
    fn empty(index: usize) -> Self { Self { enabled: false, minutes: [30, 20, 300][index], due_at: None, pending: None } }
    fn value(&self) -> Value {
        json!({"enabled":self.enabled,"minutes":self.minutes,"dueAt":self.due_at,
            "pending":self.pending.as_ref().map(|p| json!({"id":p.id,"raisedAt":p.raised_at}))})
    }
}

fn nonnegative_stamp(value: &Value) -> Result<Option<i64>, String> {
    if value.is_null() { return Ok(None) }
    value.as_i64().filter(|n| *n >= 0).map(Some).ok_or_else(|| "Invalid wellness timestamp".into())
}
fn valid_minutes(index: usize, minutes: i64) -> bool {
    match index { 0 => [30, 60].contains(&minutes), 1 => [20, 30].contains(&minutes), _ => minutes == 300 }
}
fn read_timers(value: Value) -> Result<[Timer; 3], String> {
    if value["version"] != 1 || !value["timers"].is_object() { return Err("Invalid wellness state".into()) }
    let mut timers = std::array::from_fn(Timer::empty);
    for (index, kind) in KINDS.iter().enumerate() {
        let Some(raw) = value["timers"].get(kind) else {
            if index == 2 { continue }
            return Err("Missing wellness timer".into());
        };
        let enabled = raw["enabled"].as_bool().ok_or("Invalid wellness switch")?;
        let minutes = raw["minutes"].as_i64().filter(|m| valid_minutes(index, *m)).ok_or("Invalid wellness interval")?;
        let due_at = nonnegative_stamp(raw.get("dueAt").ok_or("Missing wellness deadline")?)?;
        if raw.get("pending").is_none() { return Err("Missing wellness acknowledgement state".into()) }
        let pending = if raw["pending"].is_null() { None } else {
            let id = raw["pending"]["id"].as_str().filter(|id| id.starts_with("wellness-") && valid_id(&id[9..], 120))
                .ok_or("Invalid wellness acknowledgement")?;
            Some(Pending { id: id.to_owned(), raised_at: nonnegative_stamp(&raw["pending"]["raisedAt"])?.ok_or("Missing wellness timestamp")? })
        };
        if !enabled && (due_at.is_some() || pending.is_some()) { return Err("Disabled wellness timer has active state".into()) }
        timers[index] = Timer { enabled, minutes, due_at: if pending.is_some() { None } else { due_at }, pending };
    }
    Ok(timers)
}

fn atomic_write(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing storage folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn load_preserving_invalid<T>(path: &Path, parse: impl FnOnce(Value) -> Result<T, String>) -> Result<Option<T>, String> {
    if !path.exists() { return Ok(None) }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    match serde_json::from_slice(&bytes).map_err(|e| e.to_string()).and_then(parse) {
        Ok(value) => Ok(Some(value)),
        Err(error) => {
            let name = format!("{}.corrupt-{}-{}", path.file_name().unwrap_or_default().to_string_lossy(), Local::now().timestamp_millis(), NEXT_ID.fetch_add(1, Ordering::Relaxed));
            fs::rename(path, path.with_file_name(name)).map_err(|e| format!("Cannot preserve damaged data: {e}"))?;
            eprintln!("Preserved invalid TIME3 data: {error}");
            Ok(None)
        }
    }
}

pub struct Store {
    folder: PathBuf,
    state: Value,
    timers: [Timer; 3],
    delivered: HashSet<String>,
}

impl Store {
    /// `folder` holds the legacy-compatible filenames. The trial uses its own
    /// directory with a first-run copy of the original application's data.
    pub fn load(folder: PathBuf) -> Result<Self, String> { Self::load_at(folder, Local::now()) }

    fn load_at(folder: PathBuf, now: DateTime<Local>) -> Result<Self, String> {
        let state = load_preserving_invalid(&folder.join("calendar-state.json"), |v| validate(v, &Value::Null, true))?.unwrap_or(Value::Null);
        let timers = load_preserving_invalid(&folder.join("wellness-state.json"), read_timers)?.unwrap_or_else(|| std::array::from_fn(Timer::empty));
        let mut store = Self { folder, state, timers, delivered: HashSet::new() };
        store.sync_settings(now)?;
        Ok(store)
    }

    pub fn get(&self) -> Value { self.state.clone() }
    pub fn settings(&self) -> Value { self.state.get("settings").cloned().unwrap_or_else(default_settings) }

    pub fn save(&mut self, input: Value, now: DateTime<Local>) -> Result<Value, String> {
        let next = validate(input, &self.state, false)?;
        atomic_write(&self.folder.join("calendar-state.json"), &next)?;
        self.state = next;
        self.sync_settings(now)?;
        Ok(self.get())
    }

    fn persist_timers(&self) -> Result<(), String> {
        let timers: Map<String, Value> = KINDS.iter().enumerate().map(|(i, k)| (k.to_string(), self.timers[i].value())).collect();
        atomic_write(&self.folder.join("wellness-state.json"), &json!({"version":1,"timers":timers}))
    }

    pub fn sync_settings(&mut self, now: DateTime<Local>) -> Result<(), String> {
        let settings = self.settings();
        let old = self.timers.clone();
        let mut changed = false;
        for (index, kind) in KINDS.iter().enumerate() {
            let enabled = settings[format!("{kind}Enabled")].as_bool().unwrap_or(false);
            let minutes = settings[format!("{kind}Minutes")].as_i64().filter(|m| valid_minutes(index, *m)).unwrap_or([30, 20, 300][index]);
            let timer = &self.timers[index];
            if enabled != timer.enabled || minutes != timer.minutes || (enabled && timer.pending.is_none() && timer.due_at.is_none()) {
                self.timers[index] = Timer { enabled, minutes, due_at: enabled.then_some(now.timestamp_millis() + minutes * MINUTE_MS), pending: None };
                changed = true;
            }
        }
        if changed {
            if let Err(error) = self.persist_timers() { self.timers = old; return Err(error) }
            self.delivered.retain(|id| self.timers.iter().any(|t| t.pending.as_ref().is_some_and(|p| &p.id == id)));
        }
        Ok(())
    }

    /// Call `mark_delivered` after successfully showing or accepting each payload.
    /// Failed delivery remains due on the next tick instead of dropping a reminder.
    pub fn tick(&mut self, now: DateTime<Local>) -> Result<Vec<Value>, String> {
        self.sync_settings(now)?;
        let mut due = self.state["reminders"].as_array().into_iter().flatten().filter(|r| {
            if r["done"].as_bool().unwrap_or(true) || !r["notifiedAt"].is_null() { return false }
            let date = r["date"].as_str().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
            let time = r["time"].as_str().and_then(|t| NaiveTime::parse_from_str(t, "%H:%M").ok());
            let stamp = date.zip(time).and_then(|(d, t)| Local.from_local_datetime(&d.and_time(t)).earliest());
            stamp.is_some_and(|stamp| { let age = now.timestamp_millis() - stamp.timestamp_millis(); (0..=DAY_MS).contains(&age) })
        }).cloned().collect::<Vec<_>>();
        due.sort_by(|a,b| (a["date"].as_str(), a["time"].as_str()).cmp(&(b["date"].as_str(), b["time"].as_str())));
        let old = self.timers.clone();
        let mut changed = false;
        for (i, timer) in self.timers.iter_mut().enumerate() {
            if timer.enabled && timer.pending.is_none() && timer.due_at.is_some_and(|due| due <= now.timestamp_millis()) {
                timer.pending = Some(Pending { id: new_id(KINDS[i], now), raised_at: now.timestamp_millis() });
                timer.due_at = None;
                changed = true;
            }
        }
        if changed {
            if let Err(error) = self.persist_timers() { self.timers = old; return Err(error) }
        }
        for (index, timer) in self.timers.iter().enumerate() {
            if let Some(pending) = &timer.pending {
                if !self.delivered.contains(&pending.id) {
                    let raised = Local.timestamp_millis_opt(pending.raised_at).single().unwrap_or(now);
                    due.push(make_wellness(KINDS[index], &self.settings(), raised, &pending.id)?);
                }
            }
        }
        Ok(due)
    }

    pub fn mark_delivered(&mut self, reminder: &Value, now: DateTime<Local>) -> Result<(), String> {
        if reminder["preview"] == true { return Ok(()) }
        if reminder["kind"] == "wellness" {
            if let (Some(kind), Some(id)) = (reminder["wellnessType"].as_str(), reminder["id"].as_str()) {
                if self.is_pending(kind, id) { self.delivered.insert(id.to_owned()); }
            }
            return Ok(());
        }
        let mut next = self.state.clone();
        if let Some(item) = next["reminders"].as_array_mut().and_then(|items| items.iter_mut().find(|r|
            r["id"] == reminder["id"] && r["date"] == reminder["date"] && r["time"] == reminder["time"]
                && r["done"] == false && r["notifiedAt"].is_null())) {
            item["notifiedAt"] = json!(now.to_utc().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            atomic_write(&self.folder.join("calendar-state.json"), &next)?;
            self.state = next;
        }
        Ok(())
    }

    pub fn is_pending(&self, kind: &str, id: &str) -> bool {
        KINDS.iter().position(|k| *k == kind).is_some_and(|index| {
            let timer = &self.timers[index];
            let settings = self.settings();
            settings[format!("{kind}Enabled")] == true && settings[format!("{kind}Minutes")] == timer.minutes
                && timer.enabled && timer.pending.as_ref().is_some_and(|p| p.id == id)
        })
    }

    pub fn ack(&mut self, kind: &str, id: &str, now: DateTime<Local>) -> Result<bool, String> {
        self.sync_settings(now)?;
        if !self.is_pending(kind, id) { return Ok(false) }
        let index = KINDS.iter().position(|k| *k == kind).unwrap();
        let old = self.timers[index].clone();
        self.timers[index].pending = None;
        self.timers[index].due_at = Some(now.timestamp_millis() + self.timers[index].minutes * MINUTE_MS);
        if let Err(error) = self.persist_timers() { self.timers[index] = old; return Err(error) }
        self.delivered.remove(id);
        Ok(true)
    }

    pub fn redisplay(&mut self, kind: &str, now: DateTime<Local>) -> Result<Option<Value>, String> {
        self.sync_settings(now)?;
        let index = KINDS.iter().position(|k| *k == kind).ok_or("Unknown wellness reminder")?;
        let Some(pending) = &self.timers[index].pending else { return Ok(None) };
        let reminder = make_wellness(kind, &self.settings(), now, &pending.id)?;
        self.delivered.remove(&pending.id);
        Ok(Some(reminder))
    }

    pub fn wellness_preview(&self, kind: &str, now: DateTime<Local>) -> Result<Value, String> {
        let mut value = make_wellness(kind, &self.settings(), now, &new_id(kind, now))?;
        value["preview"] = json!(true);
        Ok(value)
    }

    pub fn wellness_status(&self, now: DateTime<Local>) -> Value {
        let entries: Map<String, Value> = KINDS.iter().enumerate().map(|(i, k)| {
            let timer = &self.timers[i];
            (k.to_string(), json!({"enabled":timer.enabled,"minutes":timer.minutes,
                "phase":if !timer.enabled {"off"} else if timer.pending.is_some() {"awaiting"} else {"counting"},
                "dueAt":timer.due_at,"remainingMs":if timer.enabled && timer.pending.is_none() { timer.due_at.map(|due| (due-now.timestamp_millis()).max(0)) } else { None },
                "pending":timer.pending.is_some(),"pendingId":timer.pending.as_ref().map(|p| &p.id),"raisedAt":timer.pending.as_ref().map(|p| p.raised_at)}))
        }).collect();
        Value::Object(entries)
    }
}

fn new_id(kind: &str, now: DateTime<Local>) -> String {
    format!("wellness-{kind}-{}-{}-{}", now.timestamp_millis(), std::process::id(), NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn make_wellness(kind: &str, settings: &Value, now: DateTime<Local>, id: &str) -> Result<Value, String> {
    let english = settings["language"] == "en";
    let title = match (kind, english) {
        ("sedentary", false) => "起身活动，舒展片刻；让身体与心情一起轻松。",
        ("eye", false) => "用眼有度，光明在前；远眺片刻，视界清晰。",
        ("codex", false) => "codex复活，继续创造。",
        ("sedentary", true) => "Stand up, stretch a little, and give your body a refreshing break.",
        ("eye", true) => "Rest your eyes. Look into the distance and give your vision a moment to refresh.",
        ("codex", true) => "Codex is back. Time to create again.",
        _ => return Err("Unknown wellness reminder".into()),
    };
    Ok(json!({"kind":"wellness","wellnessType":kind,"id":id,"date":now.format("%Y-%m-%d").to_string(),"time":now.format("%H:%M").to_string(),"title":title}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("time3-store-test-{}-{}-{}", std::process::id(), Local::now().timestamp_nanos_opt().unwrap_or_default(), NEXT_ID.fetch_add(1, Ordering::Relaxed))))
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
    fn now() -> DateTime<Local> { Local.with_ymd_and_hms(2026, 10, 24, 12, 0, 0).single().unwrap() }
    fn state() -> Value { json!({"settings":default_settings(),"reminders":[]}) }
    fn reminder(date: &str, time: &str) -> Value { json!({"id":"test-1","date":date,"time":time,"title":" Drink water ","done":false}) }

    #[test]
    fn roundtrip_legacy_calendar_and_delivery_marker() {
        let dir = Temp::new();
        let mut store = Store::load_at(dir.0.clone(), now()).unwrap();
        assert_eq!(store.get(), Value::Null);
        let mut value = state();
        value["reminders"] = json!([reminder("2026-10-24", "12:00")]);
        store.save(value.clone(), now()).unwrap();
        let due = store.tick(now()).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(store.tick(now()).unwrap().len(), 1, "failed delivery retries");
        store.mark_delivered(&due[0], now()).unwrap();
        assert!(store.tick(now()).unwrap().is_empty());
        store.save(value.clone(), now()).unwrap();
        assert!(store.get()["reminders"][0]["notifiedAt"].is_string(), "stale UI cannot clear delivery marker");
        let reloaded = Store::load_at(dir.0.clone(), now()).unwrap();
        assert_eq!(reloaded.get(), store.get());
        assert_eq!(reloaded.get()["reminders"][0]["title"], "Drink water");
        value["reminders"][0]["time"] = json!("12:01");
        store.save(value, now()).unwrap();
        assert!(store.get()["reminders"][0]["notifiedAt"].is_null());
    }

    #[test]
    fn wall_clock_deadline_and_one_day_catchup() {
        let dir = Temp::new();
        let mut store = Store::load_at(dir.0.clone(), now()).unwrap();
        let mut value = state();
        value["reminders"] = json!([reminder("2026-10-24", "12:00")]);
        store.save(value, now()).unwrap();
        assert!(store.tick(now() - Duration::seconds(1)).unwrap().is_empty());
        assert_eq!(store.tick(now() + Duration::hours(24)).unwrap().len(), 1);
        assert!(store.tick(now() + Duration::hours(24) + Duration::milliseconds(1)).unwrap().is_empty());
    }

    #[test]
    fn wellness_waits_for_ack_and_survives_restart() {
        let dir = Temp::new();
        let mut store = Store::load_at(dir.0.clone(), now()).unwrap();
        let mut value = state(); value["settings"]["eyeEnabled"] = json!(true);
        store.save(value, now()).unwrap();
        let deadline = now() + Duration::minutes(20);
        assert!(store.tick(deadline - Duration::milliseconds(1)).unwrap().is_empty());
        let due = store.tick(deadline).unwrap();
        assert_eq!(due.len(), 1);
        let id = due[0]["id"].as_str().unwrap();
        store.mark_delivered(&due[0], deadline).unwrap();
        assert!(store.tick(deadline + Duration::hours(3)).unwrap().is_empty());
        let mut store = Store::load_at(dir.0.clone(), deadline).unwrap();
        assert_eq!(store.tick(deadline).unwrap()[0]["id"], id);
        assert!(!store.ack("eye", "wrong-id", deadline).unwrap());
        assert!(store.ack("eye", id, deadline + Duration::minutes(10)).unwrap());
        assert_eq!(store.wellness_status(deadline)["eye"]["dueAt"], (deadline + Duration::minutes(30)).timestamp_millis());
    }

    #[test]
    fn preview_does_not_restart_timer_and_disable_clears_pending() {
        let dir = Temp::new();
        let mut store = Store::load_at(dir.0.clone(), now()).unwrap();
        let mut value = state(); value["settings"]["codexEnabled"] = json!(true);
        store.save(value.clone(), now()).unwrap();
        let before = store.wellness_status(now());
        let preview = store.wellness_preview("codex", now()).unwrap();
        store.mark_delivered(&preview, now()).unwrap();
        assert!(!store.ack("codex", preview["id"].as_str().unwrap(), now()).unwrap());
        assert_eq!(before, store.wellness_status(now()));
        let due = store.tick(now()+Duration::hours(5)).unwrap();
        let id = due[0]["id"].as_str().unwrap();
        assert!(store.is_pending("codex", id));
        value["settings"]["codexEnabled"] = json!(false);
        store.save(value, now()+Duration::hours(5)).unwrap();
        assert!(!store.is_pending("codex", id));
        assert_eq!(store.wellness_status(now())["codex"]["phase"], "off");
    }

    #[test]
    fn invalid_data_is_backed_up_and_bad_saves_are_rejected() {
        let dir = Temp::new(); fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join("calendar-state.json"), "{broken}").unwrap();
        let mut store = Store::load_at(dir.0.clone(), now()).unwrap();
        assert!(store.get().is_null());
        assert!(fs::read_dir(&dir.0).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().starts_with("calendar-state.json.corrupt-")));
        let mut value = state(); value["reminders"] = json!([reminder("2026-02-30", "12:00")]);
        assert!(store.save(value, now()).is_err());
        let mut value = state(); value["settings"]["codexMinutes"] = json!(5);
        assert!(store.save(value, now()).is_err());
        let mut value = state(); value["settings"]["palette"] = json!("garden");
        value["settings"]["injected"] = json!("ignored");
        let clean = store.save(value, now()).unwrap();
        assert_eq!(clean["settings"]["palette"], "rose");
        assert!(clean["settings"].get("injected").is_none());
    }
}
