//! Win32 geometry, non-activating stacking, and mini-cube interaction.
//! All native geometry is physical pixels; CSS coordinates must divide by scale.
use serde::Serialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{Emitter, PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[cfg(windows)]
pub fn cursor() -> (i32, i32) {
    use windows_sys::Win32::{Foundation::POINT, UI::WindowsAndMessaging::GetCursorPos};
    let mut point = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut point) };
    (point.x, point.y)
}

#[cfg(not(windows))]
pub fn cursor() -> (i32, i32) { (0, 0) }

#[cfg(windows)]
pub fn left_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON as i32) < 0 }
}

#[cfg(not(windows))]
pub fn left_button_down() -> bool { false }

#[cfg(windows)]
pub fn area(window: Option<&WebviewWindow>) -> Area {
    use windows_sys::Win32::{
        Foundation::{HWND, POINT},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI},
    };
    let (x, y) = cursor();
    let hwnd = window.and_then(|win| win.hwnd().ok());
    let monitor = unsafe {
        match hwnd {
            Some(handle) => MonitorFromWindow(handle.0 as HWND, MONITOR_DEFAULTTONEAREST),
            None => MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST),
        }
    };
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    let mut dpi_x = 96;
    let mut dpi_y = 96;
    let scale = unsafe {
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) == 0 && dpi_x > 0 {
            dpi_x as f64 / 96.0
        } else {
            window.and_then(|win| win.scale_factor().ok()).unwrap_or(1.0)
        }
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) } != 0 {
        let rect = info.rcWork;
        return Area { x: rect.left, y: rect.top, width: (rect.right - rect.left).max(1) as u32,
            height: (rect.bottom - rect.top).max(1) as u32, scale };
    }
    Area { x: 0, y: 0, width: 1920, height: 1040, scale }
}

#[cfg(not(windows))]
pub fn area(window: Option<&WebviewWindow>) -> Area {
    if let Some(monitor) = window.and_then(|win| win.current_monitor().ok().flatten()) {
        return Area { x: monitor.position().x, y: monitor.position().y,
            width: monitor.size().width, height: monitor.size().height, scale: monitor.scale_factor() };
    }
    Area { x: 0, y: 0, width: 1920, height: 1040, scale: 1.0 }
}

/// Reinsert the window in the topmost band without stealing typing focus.
/// The caller decides whether a window is supposed to be pinned.
#[cfg(windows)]
pub fn raise(window: &WebviewWindow) {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    }};
    if !window.is_visible().unwrap_or(false) { return; }
    if let Ok(handle) = window.hwnd() {
        unsafe { SetWindowPos(handle.0 as HWND, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE); }
    }
}

#[cfg(not(windows))]
pub fn raise(window: &WebviewWindow) { let _ = window.set_always_on_top(true); }

/// Show an auxiliary window without activating it. Tauri's regular show() can
/// activate a Windows WebView even when the builder used focusable(false).
#[cfg(windows)]
pub fn show_inactive(window: &WebviewWindow) {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE,
        WS_EX_NOACTIVATE, SW_SHOWNOACTIVATE,
    }};
    if let Ok(handle) = window.hwnd() {
        let hwnd = handle.0 as HWND;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }
}
#[cfg(not(windows))]
pub fn show_inactive(window: &WebviewWindow) { let _ = window.show(); }

// Auxiliary windows are shown with ShowWindow(SW_SHOWNOACTIVATE), outside
// Tao's cached VISIBLE flag. Its style setters would reapply that stale flag
// and hide the window. Keep auxiliary visibility and mouse styles in Win32,
// preserving all unrelated styles and the foreground application.
#[cfg(windows)]
pub fn hide_auxiliary(window: &WebviewWindow) {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{ShowWindow, SW_HIDE}};
    if let Ok(handle) = window.hwnd() {
        let hwnd = handle.0 as usize;
        let _ = window.run_on_main_thread(move || unsafe { ShowWindow(hwnd as HWND, SW_HIDE); });
    }
}
#[cfg(not(windows))]
pub fn hide_auxiliary(window: &WebviewWindow) { let _ = window.hide(); }

#[cfg(windows)]
pub fn set_cursor_passthrough(window: &WebviewWindow, ignored: bool) {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TRANSPARENT, WS_EX_LAYERED,
    }};
    if let Ok(handle) = window.hwnd() {
        let hwnd = handle.0 as usize;
        let _ = window.run_on_main_thread(move || unsafe {
            let hwnd = hwnd as HWND;
            let old = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let mask = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
            let next = if ignored { old | mask } else { old & !mask };
            if old != next { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next); }
        });
    }
}
#[cfg(not(windows))]
pub fn set_cursor_passthrough(window: &WebviewWindow, ignored: bool) {
    let _ = window.set_ignore_cursor_events(ignored);
}

/// Called only after the user enables system location. No network/IP lookup.
/// Keep the existing Windows permission prompt and a bounded helper lifetime.
#[cfg(windows)]
pub fn locate() -> Result<Value, String> {
    use std::{io::Read, os::windows::process::CommandExt, process::{Command, Stdio}};
    let executable = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from).unwrap_or_else(|| "C:\\Windows".into())
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let unavailable = || "Windows 未能提供位置，请开启系统定位服务和桌面应用访问，或手动选择城市。".to_string();
    let mut child = Command::new(executable)
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
            include_str!("../../electron/location.ps1")])
        .creation_flags(0x0800_0000)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| unavailable())?;
    let started = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < Duration::from_secs(25) =>
                std::thread::sleep(Duration::from_millis(50)),
            _ => { let _ = child.kill(); let _ = child.wait(); return Err(unavailable()); }
        }
    };
    if !result.success() { return Err(unavailable()); }
    let mut output = String::new();
    child.stdout.take().ok_or_else(unavailable)?.take(8192)
        .read_to_string(&mut output).map_err(|_| unavailable())?;
    let value: Value = serde_json::from_str(output.trim_start_matches('\u{feff}').trim())
        .map_err(|_| unavailable())?;
    let latitude = value["latitude"].as_f64().filter(|x| x.is_finite() && x.abs() <= 90.0);
    let longitude = value["longitude"].as_f64().filter(|x| x.is_finite() && x.abs() <= 180.0);
    match (latitude, longitude) {
        (Some(latitude), Some(longitude)) => Ok(json!({ "latitude": latitude, "longitude": longitude })),
        _ => Err(unavailable()),
    }
}

#[cfg(not(windows))]
pub fn locate() -> Result<Value, String> { Err("系统定位仅支持 Windows。".into()) }

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
struct Bounds { x: i32, y: i32, width: u32, height: u32 }

fn bounds(window: &WebviewWindow) -> Option<Bounds> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    Some(Bounds { x: position.x, y: position.y, width: size.width, height: size.height })
}

fn clamped(mut bounds: Bounds, area: Area) -> Bounds {
    bounds.x = bounds.x.clamp(area.x, area.x + area.width.saturating_sub(bounds.width) as i32);
    bounds.y = bounds.y.clamp(area.y, area.y + area.height.saturating_sub(bounds.height) as i32);
    bounds
}

#[derive(Clone, Copy)]
enum Edge { Left, Right, Top, Bottom }
impl Edge {
    fn name(self) -> &'static str { match self {
        Self::Left => "left", Self::Right => "right", Self::Top => "top", Self::Bottom => "bottom",
    }}
}

fn choose_edge(bounds: Bounds, area: Area) -> Option<Edge> {
    let distances = [
        ((bounds.x - area.x).abs(), Edge::Left),
        ((area.x + area.width as i32 - bounds.x - bounds.width as i32).abs(), Edge::Right),
        ((bounds.y - area.y).abs(), Edge::Top),
        ((area.y + area.height as i32 - bounds.y - bounds.height as i32).abs(), Edge::Bottom),
    ];
    distances.into_iter().min_by_key(|(distance, _)| *distance)
        .filter(|(distance, _)| *distance as f64 <= 24.0 * area.scale).map(|(_, edge)| edge)
}

fn docked(bounds: Bounds, area: Area, edge: Option<Edge>) -> Bounds {
    let mut result = clamped(bounds, area);
    match edge {
        Some(Edge::Left) => result.x = area.x,
        Some(Edge::Right) => result.x = area.x + area.width.saturating_sub(bounds.width) as i32,
        Some(Edge::Top) => result.y = area.y,
        Some(Edge::Bottom) => result.y = area.y + area.height.saturating_sub(bounds.height) as i32,
        None => {},
    }
    result
}

fn contains(bounds: Bounds, point: (i32, i32), margin: i32) -> bool {
    point.0 >= bounds.x - margin && point.0 <= bounds.x + bounds.width as i32 + margin
        && point.1 >= bounds.y - margin && point.1 <= bounds.y + bounds.height as i32 + margin
}

fn near_handle(bounds: Bounds, point: (i32, i32), edge: Edge, scale: f64) -> bool {
    let length = (50.0 * scale).round() as u32;
    let thickness = (5.0 * scale).round() as u32;
    let cx = bounds.x + bounds.width as i32 / 2;
    let cy = bounds.y + bounds.height as i32 / 2;
    let handle = match edge {
        Edge::Left => Bounds { x: bounds.x, y: cy - length as i32 / 2, width: thickness, height: length },
        Edge::Right => Bounds { x: bounds.x + bounds.width as i32 - thickness as i32,
            y: cy - length as i32 / 2, width: thickness, height: length },
        Edge::Top => Bounds { x: cx - length as i32 / 2, y: bounds.y, width: length, height: thickness },
        Edge::Bottom => Bounds { x: cx - length as i32 / 2,
            y: bounds.y + bounds.height as i32 - thickness as i32, width: length, height: thickness },
    };
    contains(handle, point, (14.0 * scale).round() as i32)
}

fn move_window(window: &WebviewWindow, target: Bounds) {
    if let Some(current) = bounds(window) {
        // Never round the current physical width back to logical width each frame.
        // That feedback loop grows windows at 125%/150% display scaling.
        if current.width != target.width || current.height != target.height {
            let _ = window.set_size(PhysicalSize::new(target.width, target.height));
        }
        if current.x != target.x || current.y != target.y {
            let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
        }
    }
}

struct Drag {
    start: (i32, i32),
    offset: (f64, f64),
    initial_scale: f64,
    moved: bool,
    started: Instant,
}

/// The parent owns this behind its mutex and calls tick every 30–60 ms.
/// Hidden cubes remain inside the display and leave a narrow rendered handle.
#[derive(Default)]
pub struct MiniController {
    edge: Option<Edge>,
    hidden: bool,
    drag: Option<Drag>,
    last_moved: bool,
    leave_at: Option<Instant>,
    hold_until: Option<Instant>,
    last_area: Option<(i32, i32, u32, u32, u32)>,
}

impl MiniController {
    pub fn state(&self, window: &WebviewWindow) -> Value {
        json!({ "edge": self.edge.map(Edge::name), "hidden": self.hidden,
            "dragging": self.drag.is_some(), "moved": self.drag.as_ref().map(|x| x.moved).unwrap_or(self.last_moved),
            "visible": window.is_visible().unwrap_or(false), "bounds": bounds(window) })
    }

    fn publish(&self, window: &WebviewWindow) { let _ = window.emit("mini:state", self.state(window)); }

    pub fn reveal(&mut self, window: &WebviewWindow, hold_ms: u64) {
        let until = Instant::now() + Duration::from_millis(hold_ms);
        self.hold_until = Some(self.hold_until.map(|old| old.max(until)).unwrap_or(until));
        self.hidden = false;
        self.leave_at = None;
        set_cursor_passthrough(window, false);
        self.publish(window);
    }

    pub fn start_drag(&mut self, window: &WebviewWindow) -> Value {
        if !window.is_visible().unwrap_or(false) || self.drag.is_some() { return self.state(window); }
        let Some(current) = bounds(window) else { return self.state(window); };
        self.reveal(window, 0);
        let point = cursor();
        let scale = area(Some(window)).scale;
        self.drag = Some(Drag { start: point,
            offset: ((point.0 - current.x) as f64 / scale, (point.1 - current.y) as f64 / scale),
            initial_scale: scale, moved: false, started: Instant::now() });
        self.edge = None;
        self.last_moved = false;
        self.leave_at = None;
        self.publish(window);
        self.state(window)
    }

    fn update_drag(&mut self, window: &WebviewWindow) {
        let Some(drag) = self.drag.as_mut() else { return; };
        let point = cursor();
        let distance = ((point.0 - drag.start.0) as f64).hypot((point.1 - drag.start.1) as f64);
        let first_move = !drag.moved && distance >= 5.0 * drag.initial_scale;
        if first_move { drag.moved = true; }
        if !drag.moved { return; }
        let area = area(None);
        let size = (112.0 * area.scale).round().max(1.0) as u32;
        let target = clamped(Bounds {
            x: point.0 - (drag.offset.0 * area.scale).round() as i32,
            y: point.1 - (drag.offset.1 * area.scale).round() as i32,
            width: size, height: size,
        }, area);
        move_window(window, target);
        if first_move { self.publish(window); }
    }

    pub fn end_drag(&mut self, window: &WebviewWindow, cancelled: bool) -> Value {
        if self.drag.is_some() {
            self.update_drag(window);
            self.last_moved = self.drag.take().map(|drag| drag.moved).unwrap_or(false);
            if let Some(current) = bounds(window) {
                let area = area(Some(window));
                self.edge = choose_edge(current, area);
                move_window(window, docked(current, area, self.edge));
            }
            self.leave_at = Some(Instant::now());
            self.publish(window);
        }
        let mut value = self.state(window);
        value["cancelled"] = json!(cancelled);
        value
    }

    pub fn on_show(&mut self, window: &WebviewWindow) {
        self.hidden = false;
        self.leave_at = Some(Instant::now());
        set_cursor_passthrough(window, false);
        self.publish(window);
    }

    pub fn on_hide(&mut self, window: &WebviewWindow) {
        self.drag = None;
        self.hidden = false;
        self.leave_at = None;
        set_cursor_passthrough(window, false);
        self.publish(window);
    }

    pub fn tick(&mut self, window: &WebviewWindow) {
        if !window.is_visible().unwrap_or(false) { return; }
        if let Some(drag) = self.drag.as_ref() {
            // Recover when pointer capture is lost to another native window.
            if drag.started.elapsed() >= Duration::from_millis(150) && !left_button_down() {
                self.end_drag(window, false);
            } else { self.update_drag(window); }
            return;
        }
        let Some(mut current) = bounds(window) else { return; };
        let area = area(Some(window));
        let key = (area.x, area.y, area.width, area.height, (area.scale * 1000.0).round() as u32);
        if self.last_area != Some(key) {
            self.last_area = Some(key);
            let size = (112.0 * area.scale).round().max(1.0) as u32;
            current.width = size;
            current.height = size;
            current = docked(current, area, self.edge);
            move_window(window, current);
            self.publish(window);
        }
        let Some(edge) = self.edge else { return; };
        let now = Instant::now();
        if self.hold_until.map(|until| now < until).unwrap_or(false) {
            self.leave_at = Some(now);
            return;
        }
        let point = cursor();
        if self.hidden {
            if near_handle(current, point, edge, area.scale) { self.reveal(window, 0); }
        } else if contains(current, point, (12.0 * area.scale).round() as i32) {
            self.leave_at = None;
        } else if let Some(left) = self.leave_at {
            if now.duration_since(left) >= Duration::from_millis(900) {
                self.hidden = true;
                self.leave_at = None;
                set_cursor_passthrough(window, true);
                self.publish(window);
            }
        } else { self.leave_at = Some(now); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scaled_monitor() -> Area {
        Area { x: -2560, y: -120, width: 2560, height: 1380, scale: 1.5 }
    }

    #[test]
    fn negative_coordinate_monitor_preserves_taskbar_floor() {
        let area = scaled_monitor();
        let cube = Bounds { x: -100, y: 1300, width: 168, height: 168 };
        let clamped = clamped(cube, area);
        assert_eq!(clamped.x, -168);
        assert_eq!(clamped.y + clamped.height as i32, 1260);
    }

    #[test]
    fn dock_threshold_is_scaled_and_nearest_edge_wins() {
        let area = scaled_monitor();
        let cube = Bounds { x: area.x + 35, y: 300, width: 168, height: 168 };
        assert_eq!(choose_edge(cube, area).map(Edge::name), Some("left"));
        assert!(choose_edge(Bounds { x: area.x + 37, ..cube }, area).is_none());
        let corner = Bounds { x: area.x + 20, y: area.y + 5, ..cube };
        assert_eq!(choose_edge(corner, area).map(Edge::name), Some("top"));
    }

    #[test]
    fn docked_cube_stays_inside_monitor() {
        let area = scaled_monitor();
        let cube = Bounds { x: -1000, y: 100, width: 168, height: 168 };
        for edge in [Edge::Left, Edge::Right, Edge::Top, Edge::Bottom] {
            let placed = docked(cube, area, Some(edge));
            assert!(placed.x >= area.x && placed.y >= area.y);
            assert!(placed.x + placed.width as i32 <= area.x + area.width as i32);
            assert!(placed.y + placed.height as i32 <= area.y + area.height as i32);
            assert_eq!(placed.width, 168);
        }
    }

    #[test]
    fn hidden_handle_only_reveals_near_its_position() {
        let cube = Bounds { x: -2560, y: 200, width: 168, height: 168 };
        assert!(near_handle(cube, (-2560, 284), Edge::Left, 1.5));
        assert!(!near_handle(cube, (-2500, 284), Edge::Left, 1.5));
        assert!(!near_handle(cube, (-2560, 450), Edge::Left, 1.5));
    }

    #[test]
    fn undersized_monitor_does_not_panic() {
        let area = Area { x: 100, y: 200, width: 80, height: 80, scale: 1.0 };
        let cube = Bounds { x: 300, y: 400, width: 112, height: 112 };
        assert_eq!(clamped(cube, area), Bounds { x: 100, y: 200, ..cube });
    }
}
