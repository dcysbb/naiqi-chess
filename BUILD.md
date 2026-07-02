# 构建指南 (BUILD.md)

本指南说明如何从源码构建各平台的可分发产物。

## 目录结构

```
chess-game/
├── server/            # Node.js + Socket.IO 游戏服务器（可被 Electron 内嵌）
├── client/            # React + Vite 前端（Web / PWA / Android 共用）
│   ├── android/       # Capacitor 生成的 Android 工程
│   └── dist/          # 前端构建产物
├── desktop/           # Electron 主进程 + preload + 打包配置
├── electron-builder.yml   # 桌面端打包配置
└── .github/workflows/     # CI（产出真正的 .exe / .dmg 安装包）
```

## 环境要求

- **Node.js** ≥ 18（推荐 20）
- **Windows 构建 .exe**：Windows + Node（已具备）
- **macOS 构建 .dmg**：需要 macOS 机器或 CI（见下）
- **Android 构建 .apk**：JDK 17+ 与 Android SDK（Android Studio 自带即可）

> 本项目本地已用 Android Studio 自带的 JDK 21（`C:\Program Files\Android\Android Studio\jbr`）与 `~/AppData/Local/Android/Sdk` 成功构建过 APK。

## 安装依赖

```bash
npm install              # 根目录：electron、electron-builder、服务器运行时依赖
cd server && npm install # 服务器独立运行依赖（含 bonjour-service）
cd ../client && npm install # 前端 + vite-plugin-pwa + capacitor + sharp
```

---

## 1. Web / PWA（浏览器游玩）

```bash
cd client
npx vite build
# 产物在 client/dist/，可直接用任意静态服务器托管
# 服务端托管：回到根目录 npm start，访问 http://localhost:3030
```

PWA 特性（自动生成）：可“添加到主屏幕”、离线外壳缓存。iOS/Android 浏览器均可用，无需安装包。

## 2. Windows 桌面端

```bash
# 根目录
npm run build:desktop   # 仅打包解压版（dist-desktop/win-unpacked/）
```

**重要说明（NSIS 安装包 .exe）：**

electron-builder 生成 NSIS 安装包时会下载 `winCodeSign`，其中含 macOS 的 `.dylib` **符号链接**。在未开启“Windows 开发者模式”或非管理员环境下，Windows 拒绝创建符号链接，导致解包失败、无法生成 `.exe` 安装包。这是 electron-builder 的已知问题，与代码无关。

两种解决办法：

- **A. 开启 Windows 开发者模式**（设置 → 隐私和安全性 → 开发者选项 → 开发人员模式），然后：
  ```bash
  npx electron-builder --win nsis
  ```
  产物：`dist-desktop/naiqi-1.0.4-setup.exe`

- **B. 用 GitHub Actions（推荐，无需改本机）**：推一个 `v*` 标签或到 Actions 页手动触发 `Build Desktop Installers` 工作流，CI 环境无符号链接限制，可直接产出 `.exe` 与 `.dmg`。配置见 `.github/workflows/build-desktop.yml`。

当前环境已验证**可用的解压版**：`奶棋-windows-portable.zip`（解压后双击 `奶棋.exe` 即可运行，自带服务器、mDNS 局域网广播）。

## 3. macOS 桌面端

需在 macOS 上构建（Windows 无法可靠交叉构建 dmg）：

```bash
npm run build
npx electron-builder --mac dmg
# 产物：dist-desktop/naiqi-1.0.4-universal.dmg（ad-hoc 签名，未公证，首次打开可能仍需右键 → 打开）
```

或使用上述 GitHub Actions 工作流。

## 4. Android (.apk)

```bash
cd client
npx vite build
npx cap sync android
cd android

# 设置 Java（用 Android Studio 自带 JDK）
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"

./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
```

> 若 `gradlew` 卡在下载 Gradle 发行版：把完整 zip（如 `gradle-8.14.3-all.zip`）放入
> `~/.gradle/wrapper/dists/gradle-8.14.3-all/<hash>/`，再 `touch *.zip.ok` 即可离线解压。

构建签名版（release，可选）：需自建 keystore，配置 `android/key.properties` 与 `build.gradle` 的 `signingConfigs`。

安装到设备：`adb install app-debug.apk`（手机需允许“未知来源”）。

## 脚本一览（根 package.json）

| 命令 | 作用 |
|------|------|
| `npm run build` | 构建前端到 client/dist |
| `npm start` / `npm run server` | 启动独立服务器（端口 3030，含 mDNS 广播） |
| `npm run dev` | Vite 开发服务器（热更新，代理 socket 到 :3030） |
| `npm run build:desktop` | 构建 Electron 解压版 |
| `npm run dist:win` | 构建 Windows NSIS 安装包（需开发者模式） |
| `npm run dist:mac` | 构建 macOS dmg（需在 macOS 上） |
| `npm run sync:mobile` | 同步前端到 Android 工程 |
| `npm run apk` | 一键构建 Android debug APK |

## 关于签名

所有产物**均未签名**（自用）：
- Windows：可直接安装/运行
- macOS：首次打开需右键 → 打开
- Android：需在系统设置允许“未知来源”
