# Windows 桌面测试版

当前提供 x64 免安装 ZIP，适用于 Intel/AMD 64 位 Windows 10/11。不是 Windows ARM64 原生包。应用和模型是分开的：ZIP 不包含 Ollama 或模型权重。

## 使用

1. 下载 Release 中的 `YeJian-0.2.0-windows-x64.zip`，右键“全部解压”。
2. 保持解压后的整个目录完整，双击 `YeJian.exe`；不要只复制 EXE。
3. 导入 PDF 即可阅读。书库、进度、笔记和对话保存在当前 Windows 用户的应用数据中；保留原 PDF，清除应用数据会丢失这些记录。
4. 使用 AI 前，从 https://ollama.com/download/windows 安装 Ollama，并在 Ollama 中安装适合 Windows 电脑的模型。不要假定 Mac 上的模型已经存在于 Windows。
5. 打开 Ollama，再打开页间。首次连接自动采用已安装列表中的第一个模型；有多个模型时，在页间“设置”中填写 `ollama list` 显示的完整名称。
6. 顶部连接按钮可连接或断开。未启动服务时会尝试启动 Ollama；自定义安装且启动失败，请从 Windows 开始菜单打开 Ollama 后重试。断开只停止阅读器使用连接，不关闭其他软件正在使用的 Ollama 服务。
7. 在右侧输入问题，点击发送或按 Ctrl+Enter。选中 PDF 文字后提问会携带选中文字。

PDF 阅读和公式排版资源随包提供。OCR 仍可能需要联网下载资源。软件不保证模型的数学推导正确。

## 开发与打包

安装 Node.js 和 pnpm，在源码目录运行：

```sh
pnpm install --ignore-scripts --frozen-lockfile
node node_modules/electron/install.js
pnpm test
pnpm start
pnpm run pack:win
```

输出为 `outputs/desktop/YeJian-0.2.0-windows-x64.zip`。Mac 原有打包命令 `pnpm run pack` 保留。Windows ZIP 使用未签名可执行文件，Windows 可能显示安全提示；发布前应安排代码签名。

`.github/workflows/windows.yml` 可手动触发 Windows runner 构建，产物在 Actions 页面下载。工作流不会自动发布 Release。

## 当前验证边界

已进行启动逻辑单元测试、JavaScript 语法检查及跨平台打包检查。这不等于在真实 Windows 中验证过界面。此版本应作为测试版发布。

Windows 实机验收清单（尚待执行）：

- 完整解压后正常打开首页。
- 导入含中文路径的 PDF、目录跳页、缩放与上下滚动正常。
- 高亮、笔记与聊天能够使用。
- Ollama 已启动/未启动/未安装三种情况下提示正确。
- 回答逐步输出，Ctrl+Enter 发送正常。
- 退出再打开，书库、阅读进度、笔记、聊天恢复。
- 没有 Ollama 时仍可阅读 PDF。

Apple 公证只针对 Mac，不适用于 Windows。代码签名和公证用于来源与安全检查，不代表功能测试已完成。
