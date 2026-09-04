# 小鱼缸壁纸

一条常驻桌面的鱼。应用静默启动，为每个显示器创建独立壁纸窗口；同一条鱼会在显示器之间自然穿梭，并跟随任意屏幕上的鼠标，偶尔吐出气泡。

## 本地运行

```bash
pnpm install
pnpm tauri dev
```

首次运行会自动注册为开机自启动。macOS 上应用不显示 Dock 图标，菜单栏提供“检查更新”和“退出壁纸”。
应用启动后会静默检查更新；发现新版本时，从 Gitee 下载经过签名校验的更新包，安装后自动重启。客户端不使用 GitHub 更新源。

## 发布

GitHub 仓库需要配置两个 Actions Secret：

- `TAURI_SIGNING_PRIVATE_KEY`：本机 `~/.tauri/qiu-updater.key` 的内容。
- `GITEE_TOKEN`：具有仓库权限的 Gitee 私人令牌。

推送 `v1.2.3` 格式的 Tag 后，GitHub Actions 会构建 Windows 和 macOS 安装包，将代码、Tag、安装包和更新清单同步到 Gitee；Gitee 全部成功后，GitHub Release 才会从草稿转为正式发布。

已安装的旧版尚未包含自动更新器，因此首个版本需要手动安装一次；此后的版本才会静默自动更新。首个 Release 应使用高于 `0.1.0` 的版本号。

## 结构

```text
src/App.tsx                  壁纸生命周期、鼠标停留气泡
src/logic/desktop.ts         桌面层与系统光标轮询
src/tank/WallpaperScene.ts   每个显示器的水景与共享鱼渲染
src-tauri/src/lib.rs         多屏共享鱼、macOS 桌面层、开机自启动和退出托盘
```
