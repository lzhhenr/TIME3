# TIME³ 1.6.0 — Windows portable

Extract the ZIP to a writable folder, then double-click TIME3.exe. Requires Windows x64 and the Microsoft Edge WebView2 Runtime. This is a Tauri desktop application.

English is the default for new records. Settings → General → Language switches between English and Chinese. Existing language preferences are preserved.

Records live in data beside TIME3.exe:
- calendar-state.json: reminders and settings.
- wellness-state.json: health reminder timers and pending reminders.
- WebView2: local browser profile/cache.

If data has no records on first launch, existing records are copied from %APPDATA%/TIME3-Tauri, falling back to %APPDATA%/TIME3. Existing portable files and original files are retained.

Quit the running app before replacing TIME3.exe; preserve data when updating. To move or back up the app, quit it and copy the entire folder.

Right-click the tray icon to toggle Floating cube or choose Quit (stop reminders). Closing the main window keeps reminders running in the tray.

Design by NEXT Studio
