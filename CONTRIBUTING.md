# 贡献指南

感谢你对页间的兴趣。当前项目仍处于早期阶段，优先保证 PDF 阅读、选区上下文、本地 Ollama 对话和 macOS 运行稳定。

## 开始开发

1. Fork 仓库并克隆到本机。
2. 确认已安装 Python 3 和 Ollama。
3. 按 README 下载一个本地模型。
4. 双击 `run.command`，确认应用可以打开。

## 修改流程

- 每个功能或修复使用一个独立分支，例如 `feature/chat-history` 或 `fix/pdf-jump`。
- 保持改动聚焦，避免在同一个提交中混入无关的界面重做。
- 修改本地模型请求时，优先保证没有云端 API 依赖，并说明模型接口格式。
- 修改 PDF 渲染时，同时检查文字选择、高亮、缩放和页码跳转。
- 修改对话界面时，同时检查流式输出、超时和 Ollama 未连接状态。

## 提交前检查

```bash
PYTHONPYCACHEPREFIX=/tmp/pdf-studio-pycache python3 -m py_compile server.py
./run.command
```

请至少手动验证：导入多页 PDF、目录跳转、文字选择、一次普通提问、一次连续追问和应用重启后的本地记录。

## 提交信息

提交信息使用简短动词开头，例如：

- `Fix directory page navigation`
- `Add persistent chat history`
- `Improve Retina PDF rendering`

Pull Request 请说明修改内容、测试方式和已知限制。
