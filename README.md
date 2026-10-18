# DSH Task Monitor

一个用于 [DeepSeek Harness](https://github.com/deepseek-ai) Web UI 的任务监控面板插件，停靠在**右侧面板栏**中，像 文件 / 终端 / Git 一样作为原生标签页打开。

![status](https://img.shields.io/badge/DSH-Web%20plugin-2f6fed)

## 功能 / Features

- **四状态看板**：待运行 / 运行中 / 已结束 / 未完成，四列并排展示，列头实时显示数量；侧边栏较窄时自动变为 2×2 或单列。
- **自动同步运行中的会话**：侧边栏里有会话开始运行时，自动生成一张「会话」卡片放进「运行中」；会话停止后按结束原因自动归档——正常完成进入「已结束」，**运行出错或被中断（含手动停止）进入「未完成」**，两种情况都会记录用时。首次打开时已在运行的会话同样会被收录。
- **卡片拖动**：把卡片拖到另一列即可切换状态，同列内拖动可排序；拖动时有插入位置提示，支持列表边缘自动滚动。
- **手动接管**：把自动卡片拖到其它列后，该卡片由你接管，不再被自动移动；删除自动卡片后，本次运行内不会再自动出现（该会话下次运行时会重新添加）。
- **任务管理**：底部输入框 + 状态下拉新增任务；双击标题重命名；悬停删除；一键清理已结束任务。
- **持久化**：任务与各次运行的时间戳保存在浏览器 `localStorage`，刷新后仍在。
- **主题与语言**：全部样式使用 `--dsw-alias-*` 主题变量，随明暗主题切换；中英文随宿主语言切换。

## 打开方式 / How to open

安装并激活后，插件会在右侧面板栏注册一个 **「任务监控 / Task Monitor」** 标签页，并在首次启用时自动打开一次。之后可以：

- 在右侧面板栏的标签列表 / 引导页（guide）中点击「任务监控」重新打开；
- 该标签页与 文件、终端、Git 等面板并列，可随时关闭再打开（看板内容不会丢失）。

## 安装 / Installation

插件以 DSH bundle 形式安装（推荐）：

1. 将本仓库放到任意目录。
2. 在 DSH 中安装该 bundle：

   ```text
   plugin_manager(install_bundle, target: "<本仓库绝对路径>")
   ```

3. 刷新一次 Web 页面，标签页即可出现（首次启用会自动打开）。

也可以用 `pnpm add <path>` 将该包加入 profile 依赖，然后在 `cordis.patch.yml` 中插入同名行。

安装后在「插件」页可以看到标题「任务监控」、描述与图标。

## 使用 / Usage

- 在底部输入框输入任务，选择目标状态，按 **Enter** 或点击「添加」。
- 按住卡片拖动：拖到其它列 = 改变状态，拖到同列其它位置 = 排序。
- 双击卡片标题可重命名；悬停卡片右上角出现删除按钮。
- 自动同步状态显示在底部右下角：绿点 = 已在同步侧边栏会话。

## 结构 / Layout

```text
task-monitor/
├── package.json          # bundle 清单、dsh.client 声明、导出
├── cordis.patch.yml      # Loader 插入行
├── index.js              # Host 半（本插件无宿主服务）
├── client.js             # Client 半：面板组件、拖拽、自动同步、侧边栏标签页注册
├── locale/
│   ├── en.json           # 插件显示元数据（英文）
│   └── zh.json           # 插件显示元数据（中文）
└── icon.svg              # 插件图标
```

## 开发说明 / Development Notes

- `client.js` 是 DSH 动态 Client 模块格式：`window.__ModuleLoader__.load({ id, factory(require) { ... } })`，React 由浏览器模块表提供，无需安装依赖。
- 侧边栏标签页通过宿主服务注册：
  - `ctx.get('sidebarRightTabs').register({ id, kind, title, guide })` 注册标签页类型与引导入口；
  - `ctx.slots.register` 到 `sidebar.right.pane.tab`（key = 类型 id）提供页面内容；
  - `ctx.get('sidebarRight').openTab(kind)` 首次启用时自动打开。
- 自动同步使用槽位标准属性 `useSessions`（会话列表：`ids` / `byId`）和 `useSessionStatus`（每会话状态 Map：`running`）。
- 如果宿主没有右侧面板栏，插件会回退为悬浮窗模式（`shell.overlay`），功能一致。
- 样式只使用 `--dsw-alias-*` 主题变量；所有类名以 `tm-` 前缀限定，避免污染宿主页面。
- 数据保存在 `localStorage` 的 `dsh.task-monitor.board.v1`。

## 已知限制 / Known Limitations

- 任务数据保存在当前浏览器，不跨设备同步。
- 自动同步以「侧边栏会话」为单位；命令行/子代理等后台作业暂不单独建卡。
- 结束原因取自会话事件里的 `turn/end.reason`（`completed` = 已结束，其余如 `error` / `aborted` / `interrupted` / `max-tokens` / `blocked` = 未完成）。如果该事件窗口不可用，则回退为「已结束」。
- 插件代码更新后需要刷新一次页面才会加载新的客户端模块。

## 许可证 / License

[MIT](LICENSE)
