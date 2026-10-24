# TIME³ WebView2 试用版

双击 TIME3.exe。适用于 Windows 11 x64，使用系统 Microsoft Edge WebView2 Runtime；运行时缺失的电脑需要先安装微软官方 WebView2 Evergreen Runtime。

这是 Tauri + WebView2 迁移测试版，保留现有日期方块界面、天气、提醒、悬浮方块、托盘及本地数据。程序体积不再包含整套 Electron / Chromium。

记录保存在 TIME3.exe 同目录的 `data` 文件夹：`calendar-state.json` 保存提醒和设置，`wellness-state.json` 保存健康计时；WebView2 缓存也保存在 data 内。路径以 EXE 实际位置为准，从快捷方式打开也一样。

首次启动时，若 data 中尚无记录，会优先复制 `%APPDATA%/TIME3-Tauri` 的现有记录；没有时再尝试 `%APPDATA%/TIME3`。原文件保留，已有便携数据不会覆盖。以后更新只替换 EXE，保留 data；搬家或备份时先退出软件，再复制整个程序文件夹。请先解压到可写文件夹再运行。关闭主窗口后仍在托盘运行；托盘右键可退出。

源码构建：Node.js 22、Rust stable MSVC、Microsoft C++ Build Tools 和 Windows SDK；运行 `npm ci`、`npm run tauri:build`。默认生成独立 EXE，不捆绑 WebView2 Runtime。源码的 Electron 启动和打包命令继续可用。

Design by NEXT Studio
