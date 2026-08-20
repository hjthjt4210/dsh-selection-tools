# dsh-selection-tools

面向 DSH web 客户端的对话页选中文字工具。

在对话页面用鼠标或键盘选中任意文字时，选区旁会出现一个迷你工具条，提供两个动作：

| 动作 | 行为 |
| --- | --- |
| **引用** | 把选中文字加入注释胶囊,悬停可查看原文,点击 `×` 可删除,发送时展开为附加上下文 |
| **复制** | 把选中文字写入系统剪贴板 |

## 功能

- 选中文字后显示「引用」和「复制」。
- 引用内容以「N 条注释」胶囊显示在输入栏。
- 悬停胶囊可查看每条引用的完整内容。
- 点击胶囊右侧 `×` 可删除全部注释。
- 发送消息时，注释会作为 `<selection_annotations>` 上下文提交。

## 安装

在 PowerShell 中执行：

```powershell
git clone https://github.com/hjthjt4210/dsh-selection-tools.git
Copy-Item -Recurse -Force .\dsh-selection-tools "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-selection-tools"
```

然后在 `%USERPROFILE%\.dsh\profiles\web\package.json` 的
`dsh.profile.bundles` 数组中加入 `"dsh-selection-tools"`，最后重启 DSH。

本插件的 `lib/index.js` 是无操作的宿主入口,浏览器功能位于 `lib/client.js`。
这种双入口结构可避免 DSH 启动时在 Node.js 环境执行浏览器代码。

## 原理

- **选区工具条**注册在官方 `shell.overlay` 全框架浮层槽。
  `mouseup`/Shift+方向键 `keyup` 后取 `window.getSelection()` 的非空选区，用
  选区 `getBoundingClientRect()` 定位浮层。
- **注释胶囊**显示在输入栏左侧。多次引用会更新同一个胶囊的计数,悬停可查看每条
-  引用的完整内容，点击 `×` 会删除全部注释，也不会显示成功提示条。
- **引用数据**通过官方 conversation 服务的 `shell.insertReference()` 写入，正文不会直接
  塞进可见草稿。
- **发送序列化**通过 `inputTriggers` 注册专用 codec。DSH 提交草稿时把芯片展开为
  `<selection_annotations>` 上下文；删除芯片会同时取消这些引用。
- **复制**优先使用 Clipboard API，并为不支持的环境提供本地复制回退。
- 样式只用 `--dsw-*` 主题令牌，自动跟随深浅色模式。

## 开发

无构建步骤，`lib/client.js` 是标准 `window.__ModuleLoader__.load` 客户端插件
（React 18 + `react/jsx-runtime`）。

```bash
node --check lib/index.js
node --check lib/client.js
```

## License

MIT
