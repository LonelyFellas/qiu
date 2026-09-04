# 小鱼缸壁纸

一条常驻桌面的鱼。应用静默启动，只保留水景壁纸、鱼的自然游动、鼠标跟随和偶尔出现的气泡。

## 本地运行

```bash
pnpm install
pnpm tauri dev
```

首次运行会自动注册为开机自启动。macOS 上应用不显示 Dock 图标，菜单栏提供“检查更新”和“退出壁纸”。
更新检查优先读取 Gitee `yu-shengming/qiu` 的最新 Release，仓库或 Release 暂不可用时自动回退 GitHub `LonelyFellas/qiu`。

## 结构

```text
src/App.tsx                  壁纸生命周期、鼠标停留气泡
src/logic/desktop.ts         桌面层与系统光标轮询
src/tank/WallpaperScene.ts   水景、鱼和鼠标跟随
src-tauri/src/lib.rs         macOS 桌面层、开机自启动和退出托盘
```
