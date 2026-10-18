# DSH Task Monitor

一个用于 [DeepSeek Harness](https://github.com/deepseek-ai) Web UI 的悬浮式任务监控面板插件。

A floating task-monitor panel plugin for the DeepSeek Harness Web UI.

![status](https://img.shields.io/badge/DSH-Web%20plugin-2f6fed)

## 功能 / Features

- **四状态看板**：待运行 / 运行中 / 已结束 / 未完成，四列并排展示，列头实时显示数量。
- **卡片拖动**：把卡片拖到另一列即可切换状态，同列内拖动可排序；拖动时有插入位置提示，支持列表边缘自动滚动。
- **窗口可拖动、可缩放**：拖动标题栏移动面板；拖动右边、下边或右下角改变大小；位置与尺寸会被记住。
- **自动计时**：进入「运行中」的任务显示实时计时；进入「已结束 / 未完成」时记录完成时间，完成的任务同时记录总用时。
- **任务管理**：底部输入框 + 状态下拉新增任务；双击标题重命名；悬停删除；一键清理已结束任务。
- **收起与恢复**：可收起为标题条，或关闭成一个小胶囊按钮，点击恢复。
- **持久化**：任务与窗口几何保存在浏览器 `localStorage`，刷新后仍在。
- **自动同步运行中的会话**：侧边栏里有会话开始运行时，自动生成一张「会话」卡片放进「运行中」；该会话停止运行后，卡片自动移到「已结束」并记录用时。手动把自动卡片拖到其它列后，该卡片交由你接管，不再被自动移动；删除自动卡片后，本次运行内不会再自动出现（下次运行会重新添加）。
- **主题与语言**：全部样式使用 `--dsw-alias-*` 主题变量，随明暗主题切换；中英文随宿主语言切换。

## 安装 / Installation

插件以 DSH bundle 形式安装（推荐）：

1. 将本仓库放到任意目录。
2. 在 DSH 中安装该 bundle：

   ```text
   plugin_manager(install_bundle, target: "<本仓库绝对路径>")
   ```

3. 面板会立即在 Web UI 右上角出现，无需重启。

也可以用 `pnpm add <path>` 将该包加入 profile 依赖，然后在 `cordis.patch.yml` 中插入同名行。

安装后在「插件」页可以看到标题「任务监控 / Task Monitor」、描述与图标。

## 使用 / Usage

- 在底部输入框输入任务，选择目标状态，按 **Enter** 或点击「添加」。
- 按住卡片拖动：拖到其它列 = 改变状态，拖到同列其它位置 = 排序。
- 拖动标题栏移动面板；拖动右下角缩放面板。
- 双击卡片标题可重命名；悬停卡片右上角出现删除按钮。
- 标题栏右侧：收起（—）、关闭（×）。关闭后变成一个「任务监控」胶囊按钮。

## 结构 / Layout

```text
task-monitor/
├── package.json          # bundle 清单、dsh.client 声明、导出
├── cordis.patch.yml      # Loader 插入行
├── index.js              # Host 半（本插件无宿主服务）
├── client.js             # Client 半：面板组件、拖拽、持久化
├── locale/
│   ├── en.json           # 插件显示元数据（英文）
│   └── zh.json           # 插件显示元数据（中文）
└── icon.svg              # 插件图标
```

## 开发说明 / Development Notes

- `client.js` 是 DSH 动态 Client 模块格式：`window.__ModuleLoader__.load({ id, factory(require) { ... } })`，React 由浏览器模块表提供，无需安装依赖。
- 面板注册在 `shell.overlay` 槽位（框架级悬浮层，点击穿透，条目自行开启 `pointer-events`）。
- 样式只使用 `--dsw-alias-*` 主题变量；所有类名以 `tm-` 前缀限定在面板内，避免污染宿主页面。
- 数据保存在 `localStorage` 的 `dsh.task-monitor.board.v1`。

## 已知限制 / Known Limitations

- 任务数据保存在当前浏览器，不跨设备同步。
- 自动同步以「侧边栏会话」为单位；命令行/子代理等后台作业暂不单独建卡。
- 自动同步首次生效需要刷新一次页面（插件模块更新后由浏览器重新加载）。

## 许可证 / License

[MIT](LICENSE)
