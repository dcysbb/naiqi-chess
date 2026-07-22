# 奶棋 - 游戏指南

## 三种玩法

| 方式 | 适合 | 说明 |
|------|------|------|
| **桌面版（Windows/Mac）** | 电脑 | 内置服务器，可创建房间当主机，局域网内其他设备自动发现并加入 |
| **手机版（Android）** | 手机 | 可创建房间当主机，也可自动发现局域网内其他主机并加入对局 |
| **网页版（浏览器/PWA）** | 任何设备（含 iOS） | Windows 主机提供网页，浏览器打开局域网地址即可玩 |

> 规则：电脑端和 Android 手机端都可以当主机。两台手机连到同一个 Wi-Fi 或个人热点后，也可以互相联机。

## 快速开始（局域网联机）

1. **一台设备**运行桌面版或 Android App 并创建房间 → 它会自动在局域网广播。
2. **对手的设备**（手机 App / 浏览器 / 另一台电脑）打开游戏，在“局域网主机”列表里会**自动发现**主机，点击连接。
3. 创建房间 → 选阵营 → 对方加入 → 开战。

> 如果自动发现没找到，可在“手动输入主机 IP”框输入电脑的局域网 IP（如 `192.168.1.5`，端口默认 3030）。桌面版启动时会显示本机 IP。

## Windows Web 局域网主机

Release 中下载 `naiqi-web-host-*-windows-x64.zip` 并解压，双击
`启动奶棋Web主机.cmd`。它自带 Node.js，无需安装开发环境；启动后会自动打开
主机浏览器，并在窗口和游戏页面显示 `http://局域网IP:3030`。

同一 Wi-Fi / 个人热点里的其他手机、平板和电脑可以：

1. 在奶棋 App 的“局域网主机”列表等待自动扫描并点击连接。
2. 在浏览器直接打开主机显示的局域网地址。
3. 自动扫描失败时，在奶棋 App 中手动输入 Windows 主机 IP。

首次启动若 Windows 防火墙弹出询问，请允许“专用网络”，否则其他设备无法访问。

---

# 内网穿透使用指南（跨网络联机）

## 一、启动游戏服务器

```powershell
# 方式 1：直接启动
cd server && node index.js

# 方式 2：Package Manager（在项目根目录）
npm start
```

启动后服务器在 `http://localhost:3030`

---

## 二、内网穿透（让对方通过外网访问）

### 方案 A：Cloudflare Tunnel（推荐，免费）

**1. 安装 cloudflared**
```powershell
winget install --id Cloudflare.cloudflared
```
或从 https://github.com/cloudflare/cloudflared/releases 下载 .msi 安装包

**2. 启动隧道**
```powershell
cloudflared tunnel --url http://localhost:3030
```

启动后会显示一个 `https://xxxx.trycloudflare.com` 的地址，把这个地址发给队友即可。

> 注意：此方式无需 Cloudflare 账号，会自动生成临时域名，关闭终端后失效。

### 方案 B：使用自定义域名（需要 Cloudflare 账号）

**1. 登录 Cloudflare**
```powershell
cloudflared tunnel login
```

**2. 创建隧道**
```powershell
cloudflared tunnel create chess-game
```

**3. 关联域名**
```powershell
cloudflared tunnel route dns chess-game chess.yourdomain.com
```

**4. 运行**
```powershell
cloudflared tunnel run chess-game --url http://localhost:3030
```

### 方案 C：frp 内网穿透（需要一台 VPS）

需要一台有公网 IP 的服务器。在 VPS 上安装 frps，在本机安装 frpc，配置端口转发。

---

## 三、游戏玩法

1. **创建房间**：打开游戏 → 点击「创建房间」→ 获取房间号
2. **选择阵营**：红方先手，黑方后手
3. **等待对手**：将房间号发给对方，对方点击「加入房间」输入房间号
4. **开始对弈**：
   - 棋子初始全部翻面（隐藏），随机分配到传统的 32 个位置
   - 点击你的棋子，根据其所在位置的**传统棋子类型**显示可走位置
   - 移动到目标位置后，棋子翻面揭示真实身份
   - 翻开的棋子若与你的阵营不同，自动归对方控制
   - 吃掉对方「将/帅」或对方无路可走即获胜
