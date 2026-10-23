# TIME³ WebView2 试用版

双击 TIME3.exe。适用于 Windows 11 x64，使用系统 Microsoft Edge WebView2 Runtime；运行时缺失的电脑需要先安装微软官方 WebView2 Evergreen Runtime。

这是 Tauri + WebView2 迁移测试版，保留现有日期方块界面、天气、提醒、悬浮方块、托盘及本地数据。程序体积不再包含整套 Electron / Chromium。

首次启动会将 `%APPDATA%/TIME3` 中的提醒和健康计时复制到 `%APPDATA%/TIME3-Tauri`。之后两版数据独立，试用版不会覆盖原版数据。测试时建议从托盘退出原版，避免两个应用重复提醒。关闭主窗口后仍在托盘运行；托盘右键可退出。

源码构建：Node.js 22、Rust stable MSVC、Microsoft C++ Build Tools 和 Windows SDK；运行 `npm ci`、`npm run tauri:build`。默认生成独立 EXE，不捆绑 WebView2 Runtime。源码的 Electron 启动和打包命令继续可用。

Design by NEXT Studio
