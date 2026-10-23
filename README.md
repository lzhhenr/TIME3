# TIME³ 桌面 3D 日历

<img src="assets/icon-256.png" width="128" alt="TIME³ icon">

Windows 11 桌面小组件：点击立体日期块编辑当天安排；独立提醒方块沿任务栏滚入并弹跳。

![TIME³ 日历预览](docs/preview.png)

## 功能

- 经典圆润 / 圆角厚板；奶白工作日与彩色周末，今天固定橙色。
- 六种配色：奶油黄、玫瑰粉、鸢尾紫、黑白灰、翡翠绿、克莱因蓝。
- 中国传统节日、美国联邦节日和 24 节气小字（不代表调休补休安排）。
- 悬浮方块直接拖动、贴边隐藏与靠近展开；四角或居中、窗口置顶。
- 久坐 30/60 分钟、远眺 20/30 分钟；点击收到或主动关闭提示后重新计时。
- codex复活提醒，可选择 5 小时；默认关闭。
- 中英文、背景透明度、透明模式文字深浅、音效开关。
- 厦门天气默认，定位天气默认关闭。

## 下载与运行

在 [Releases](https://github.com/lzhhenr/TIME3/releases/latest) 下载 [TIME3-v1.5.0-win-x64.zip](https://github.com/lzhhenr/TIME3/releases/download/v1.5.0/TIME3-v1.5.0-win-x64.zip)，完整解压后双击 TIME3.exe。请保留整个文件夹。图标已直接嵌入 EXE，无需外置 ICO 或快捷方式。

关闭窗口后仍在托盘运行，托盘右键可退出。退出、关机或休眠期间不弹出提醒。便携版未签名，未配置开机自启。

## 数据

提醒与设置：`%APPDATA%/TIME3/calendar-state.json`。

健康计时：`%APPDATA%/TIME3/wellness-state.json`。

更新保留本机数据，手动替换数据前先从托盘退出。发布包不含作者个人提醒或测试数据。定位须主动开启；天气使用 Open-Meteo 服务。

## 开发与打包

Windows x64、Node.js 22 或更新版本：

```sh
npm ci
npm run build
npm start
```

若本机 npm 阻止 Electron 安装脚本，运行 `node node_modules/electron/install.js`。

`npm run preview` 提供 5178 端口浏览器预览；原生提醒、置顶、贴边等须使用桌面程序。

```sh
npm test
npm run package
```

打包结果：dist/TIME3-v<版本号>-win-x64/。脚本逐字节验证 EXE 全部图标资源；已有目录拒绝覆盖。修改图标后运行 `node scripts/build-icon.mjs`（需要 Microsoft Edge），再重新打包。

## GitHub 发布

仓库仅存源码与图标资源。node_modules、dist、旧版程序、测试输出和个人数据不入库。便携 ZIP 上传到 Releases。

Actions 可手动运行 Build Windows portable，下载构建产物后创建 Release。工作流不会自动发布。

## 许可

Electron、Three.js、lunar-javascript、esbuild、Playwright、rcedit 等遵循各自许可证。农历库许可证见 LUNAR-LICENSE.md；便携版保留 Electron/Chromium 许可文件。项目自身的开源许可证由项目所有者指定。


## 1.5 修复

提醒窗口持续维护置顶层级；置顶小方块在收到提醒时自动弹出抖动。新增 codex复活 开关，提醒间隔可选择 5 小时；按收到或关闭后重新计时。提醒默认时间跟随 Windows 系统，每秒检查，手动设置的时间不被覆盖。设置末尾添加 Design by NEXT Studio。

已通过40项自动检查、24项桌面检查（包含模拟全屏置顶竞争窗口）。普通全屏/窗口化视频的层级恢复已覆盖；独占全屏游戏、安全桌面和受保护视频不能承诺覆盖。

Design by NEXT Studio
