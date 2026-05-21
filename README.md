# antigravity2.0-font-patcher

一个用于修改 Antigravity 2.0 全局 UI 字体的小工具。

它会解包 Antigravity 的 `resources/app.asar`，在 Electron `BrowserWindow` 加载完成后注入自定义 CSS 字体规则，然后重新打包。脚本会在修改前自动备份原始 `app.asar`。

## 使用方法

先关闭 Antigravity，然后运行：

```bash
npm install
node patch-antigravity-font.js --font "思源宋体"
```

如果 Antigravity 安装在其他位置：

```bash
node patch-antigravity-font.js \
  --install-dir "C:\\Users\\你的用户名\\AppData\\Local\\Programs\\antigravity" \
  --font "思源宋体"
```

恢复最近一次备份：

```bash
node patch-antigravity-font.js --restore
```

## 参数

```text
--font <name>          要设置的字体名称
--fallback <list>      CSS 字体 fallback 列表
--install-dir <path>   Antigravity 安装目录
--restore              恢复最近的 app.asar.bak-* 备份
--keep-temp            保留临时解包目录，方便调试
--no-process-check     跳过 Antigravity 运行状态检查
```

## 注意

- 修改前请先关闭 Antigravity。
- Antigravity 更新后可能会覆盖 `app.asar`，需要重新运行脚本。
- 如果字体没有生效，请确认系统中安装的字体名称和 `--font` 传入的名称一致。
