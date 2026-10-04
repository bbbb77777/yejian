# 页间（YeJian）

页间是一款面向 macOS 和 Windows 的本地优先 PDF 阅读助手。它参考了 [Marginalia](https://github.com/EurFelux/marginalia) 的选区问答思路：在 PDF 中选择文字，直接在右侧向本地大模型提问，不需要把内容复制到另一个聊天窗口。

项目当前使用 PDF.js 阅读 PDF，使用 Ollama 连接本地模型。翻译、上下文解释、段落摘要、公式推导和自由提问都在本机完成；PDF 从本机读取，标注、对话记录和设置保存在浏览器本地。提供 Electron 桌面测试版，也保留浏览器 Demo。Windows 安装、打包与验收见 [WINDOWS.md](WINDOWS.md)。

## 当前功能

- 导入并阅读 PDF，支持目录、页码、缩放、适合宽度和全文搜索
- 多页连续滚动；点击左侧章节或页码可跳转到对应页面
- Mac Retina 高清 Canvas 渲染
- 选择文字后进行翻译、解释、摘要、公式推导、提问、高亮和笔记
- 右侧本地模型对话，答案流式显示
- 连续追问会携带最近的对话历史，并按文档保存
- 基础 Markdown 和 LaTeX 公式排版
- 大型 PDF 按需渲染当前页面附近内容
- 扫描页提供 OCR；支持视觉模型的 Ollama 模型可以分析页面图片
- 不需要 OpenAI、Anthropic 或其他云端 API key

## 使用前准备

需要：

- macOS
- Python 3（先运行 `python3 --version` 检查；未安装时从 python.org 安装）
- [Ollama](https://ollama.com/)
- 一个已经下载到本机的 Ollama 模型

以当前默认模型为例：

```bash
ollama pull qwen3.5:9b-mlx
```

如果 Ollama 尚未运行，可以启动服务：

```bash
ollama serve
```

如果终端提示 `address already in use`，通常表示 Ollama 已经在运行，不需要再次启动。

## 运行应用

在项目目录中双击 `run.command`，或者在终端运行：

```bash
./run.command
```

脚本会启动随项目提供的本地桥接服务器，并打开浏览器页面。这个桥接服务器负责：

- 提供网页文件；
- 检查 Ollama 是否可用；
- 转发流式聊天请求；
- 避免浏览器直接访问本地模型时遇到 CORS 问题。

不要用下面的命令代替 `run.command`：

```bash
python3 -m http.server 8765
```

这个命令只能提供静态网页，不能提供 `/api/ollama-status` 和 `/api/chat`，应用会出现连接 404。

## 基本使用流程

1. 点击“导入 PDF”，选择文件。
2. 在左侧“文档结构”中点击章节或页码，可以跳转到对应页面。
3. 在中间 PDF 中拖动选择文字。
4. 使用浮动工具栏进行翻译、解释、摘要、高亮、笔记或提问。公式推导请在右侧输入“请逐步推导选中的公式”。
5. 也可以直接在右侧输入问题。模型会逐步显示答案。
6. 如果是扫描版 PDF，页面没有可选文字时，使用页面上的“识别文字”或“让模型分析此页”。

## 设置和本地数据

点击顶部“设置”可以修改模型名称。默认模型是 `qwen3.5:9b-mlx`，默认连接通过项目内的 `/api` 桥接完成。

标注、对话和设置使用浏览器 `localStorage` 保存，按 PDF 文件名区分，同名文件可能共享记录。重新打开页面后，需要重新导入 PDF 才能恢复该文档的聊天。最多保存最近 40 条消息，请求携带最近 12 条历史。项目不会主动上传 PDF 或对话内容。清理浏览器站点数据会同时清除这些本地记录。

公式排版、OCR 和 PDF.js 使用浏览器按需加载的开源组件。首次加载需要联网获取这些组件：PDF.js 加载失败会影响应用初始化；KaTeX 未加载时公式退回文字；OCR 还需要下载语言数据。当前不是完全离线的安装包。

## 项目结构

```text
.
├── index.html          # 页面结构
├── styles.css          # 阅读器与对话界面样式
├── app.js              # PDF 阅读、标注、对话、OCR 和渲染逻辑
├── server.py           # 同源网页服务器与 Ollama 本地桥接
├── run.command         # macOS 启动脚本
├── PRODUCT_SPEC.md     # 产品范围与后续规划
├── CONTRIBUTING.md     # 开发和提交规范
└── CHANGELOG.md        # 版本更新记录
```

## 本地开发与检查

修改后可以运行以下检查：

```bash
PYTHONPYCACHEPREFIX=/tmp/pdf-studio-pycache python3 -m py_compile server.py
./run.command
```

浏览器端目前是无构建步骤的原生 JavaScript 项目，修改 `app.js`、`styles.css` 或 `index.html` 后重新加载页面即可看到变化。

## 发布到 GitHub

先在 GitHub 创建一个空仓库，不要预先勾选 README、License 或 `.gitignore`。然后在项目目录中运行：

```bash
git init -b main
git add .
git commit -m "Initial release"
git remote add origin https://github.com/YOUR_NAME/YOUR_REPOSITORY.git
git push -u origin main
```

把 `YOUR_NAME/YOUR_REPOSITORY` 换成你的 GitHub 用户名和仓库名。之后每次修改可以使用：

```bash
git status
git add .
git commit -m "Describe the change"
git push
```

面向别人下载的 ZIP 建议作为 GitHub Release 附件上传，而不是把每个生成的 ZIP 都提交到源码历史。发布前请补充你选择的开源许可证；如果希望别人可以自由修改和再发布，可以考虑 MIT License。

## 后续计划

- 更完整的 Markdown 笔记本和章节/全文摘要
- 多文档工作区
- 更稳定的扫描版文字层和图表理解
- 桌面版签名、安装包与实机验收
- GitHub Actions 自动检查和发布

## 当前限制

- 按需渲染会延迟创建画布，但已渲染页面暂未自动释放，浏览大量页面后内存仍可能增加。
- OCR 是普通文字识别，不保证准确识别复杂数学公式；页面分析需要支持图片输入的模型。
- 当前上下文引用栏隐藏，已选文字仍会随提问发送。
- 目前以语法检查和手动验收为主，尚无完整的自动化功能测试。

## 桌面测试版

桌面源码位于 `desktop/`。开发者安装 Node.js 后，可用 pnpm 安装依赖并打包：

```sh
pnpm install
pnpm start
pnpm run pack
```

生成的 Apple Silicon 应用位于 `outputs/desktop/mac-arm64/YeJian.app`。

桌面版不需要 Python，直接连接本机 Ollama。PDF.js 与 KaTeX 随包提供；OCR 暂时仍需联网下载。聊天和标注保存在 Electron 的应用数据目录中，与浏览器版分开。当前测试包未做开发者签名和 Apple 公证。

## 书库与继续阅读

启动后进入书库首页，侧边菜单可切换首页、全部书籍和最近阅读。导入 PDF 后会保存一份本地副本，并生成第一页封面。阅读过程中自动保存页码、缩放和页内位置，点击“返回书库”后可以切换书籍；重启后点击书籍继续阅读。

PDF 副本和阅读进度存于 IndexedDB，在桌面版中位于应用的用户数据目录。每次导入使用独立编号，笔记与对话也随编号区分；重复导入会创建另一条书籍记录。旧版按文件名保存的记录暂不自动迁移。清除应用数据会清除书库，请保留原 PDF。
