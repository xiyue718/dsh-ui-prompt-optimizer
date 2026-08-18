# @dsh-external/ui-prompt-optimizer

## 介绍

`ui-prompt-optimizer` 是 DSH Web 客户端的“优化提示词”插件。它在会话聊天输入区添加一个仅图标的按钮，点击后把当前未发送的草稿发送到本插件的 host API，由当前默认模型优化后替换聊天框中的原文；按钮同时变成“撤回”图标，再次点击会恢复原始提示词。

本插件是 **Web 客户端插件**，只对 DSH 的浏览器界面生效。TUI、ACP、headless 等非 Web 客户端不会显示该按钮，也不会加载浏览器侧 UI。

## 安装

### 方式一：超级模组注入器

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
```

打开或刷新 DSH Web，进入一个会话，在聊天框输入内容后即可看到优化按钮。

### 方式二：dsh 命令安装（项目官方方式）

如果你已安装 `dsh` CLI，可以按项目官方教程使用 `dsh plugin` 命令安装：

```bash
# 从本地插件目录安装
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer

# 或从 GitHub 仓库安装
dsh plugin --profile web add github:xiyue718/dsh-ui-prompt-optimizer
```

安装后启动：

```bash
dsh --profile web
```

查看组合配置：

```bash
dsh --profile web --dump-config
```

详细命令说明见项目文档：`docs/user/develop/basic/publish.md`。

构建产物：host 为 `lib/index.js`，client 为 `lib/client.js`，打包文件为 `dsh-external-ui-prompt-optimizer-0.1.0.tgz`。

## 使用

1. 启动 DSH Web 客户端并进入一个会话。
2. 在聊天框输入尚未发送的提示词。
3. 点击输入区工具行中的“优化提示词”图标（无文字，形似魔法棒/星形）。
4. 等待模型返回；聊天框内容会被替换为优化后的提示词。
5. 如果对结果不满意，点击变成“撤回”图标的按钮，恢复原始提示词。
6. 确认后正常发送即可。

## 功能

- 按钮位置：会话聊天输入区的 composer 工具行，无文字，只有 SVG 图标。
- 初始状态：有非空草稿且未在发送时可用，点击后调用模型优化。
- 优化状态：按钮显示动态旋转的加载图标并禁用，避免重复点击。
- 优化完成：草稿被替换为优化后的提示词，按钮变成“撤回”图标。
- 撤回：点击后恢复点击优化时保存的原始提示词，按钮回到“优化”图标。
- 保护：优化请求返回前如果用户修改了草稿，则不会用结果覆盖用户新内容。
- 自动复位：发送消息或清空草稿后，按钮回到初始状态。
- 运行依赖：DSH Web 客户端正在运行；已配置默认模型（`agent-default-model`）；已配置对应模型的 API Key；Host 侧服务可用（`webServer`、`llm`、`agentDefaultModel`）。

### Host API

插件内部使用以下接口，普通用户不需要直接调用：

```http
POST /@dsh-external/ui-prompt-optimizer/api/optimize
Content-Type: application/json
```

请求体：

```json
{ "prompt": "要优化的提示词" }
```

成功响应：

```json
{ "optimized": "优化后的提示词" }
```

失败响应示例：

```json
{ "error": "no default model is configured" }
```

## 原理

插件由 host 和 client 两部分组成。

Client 侧在聊天输入区的 composer 工具行添加“优化提示词”按钮。点击后，client 保存当前原始草稿并调用 Host API；请求期间按钮显示动态加载图标并禁用；返回成功后替换聊天框内容并切换到“撤回”状态；点击“撤回”时恢复保存的原始草稿。

Host 侧暴露 `POST /@dsh-external/ui-prompt-optimizer/api/optimize`。收到请求后，它通过 `agentDefaultModel.currentSelection()` 获取当前默认模型，使用固定的系统提示词（“你是一个提示词优化助手……”），调用 `ctx.llm.stream` 生成优化结果，并关闭推理、使用较低温度以得到更稳定、简洁的输出。若模型未配置或返回空文本，接口会返回明确错误。
