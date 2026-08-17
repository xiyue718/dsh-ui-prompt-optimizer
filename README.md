# @dsh-external/ui-prompt-optimizer

在 DSH Web 客户端的会话聊天输入区添加一个仅图标的“优化提示词”按钮。

点击按钮后，当前未发送的草稿会发送到本插件的 host API，由当前默认模型优化后替换聊天框中的原文；按钮同时变成“撤回”图标，再次点击会恢复原始提示词。

## 适用客户端

本插件是 **Web 客户端插件**，只对 DSH 的浏览器界面生效。TUI、ACP、headless 等非 Web 客户端不会显示该按钮，也不会加载浏览器侧 UI。

## 功能详情

- 按钮位置：会话聊天输入区的 composer 工具行，无文字，只有 SVG 图标。
- 初始状态：有非空草稿且未在发送时可用，点击后调用模型优化。
- 优化状态：按钮显示动态旋转的加载图标并禁用，避免重复点击。
- 优化完成：草稿被替换为优化后的提示词，按钮变成“撤回”图标。
- 撤回：点击后恢复点击优化时保存的原始提示词，按钮回到“优化”图标。
- 保护：优化请求返回前如果用户修改了草稿，则不会用结果覆盖用户新内容。
- 自动复位：发送消息或清空草稿后，按钮回到初始状态。

## 运行依赖

- DSH Web 客户端正在运行。
- 已配置默认模型（`agent-default-model`），例如 `deepseek-official / deepseek-v4-flash`。
- 已配置对应模型的 API Key。
- Host 侧服务可用：`webServer`、`llm`、`agentDefaultModel`。

## Host API

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

## 安装到其他 DSH 客户端

以下步骤适用于另一台机器、另一个 DSH profile 或另一个 DSH Web 实例。

### 方式一：使用超级模组注入器（推荐，不修改项目文件）

1. 把插件目录复制到目标机器，例如：

   ```text
   C:\Users\<user>\.dsh\plugins\ui-prompt-optimizer
   ```

   或只复制构建产物压缩包：

   ```text
   dsh-external-ui-prompt-optimizer-0.0.1.tgz
   ```

2. 如果拿到的是 `tgz`，先解压成插件目录：

   ```bash
   mkdir ui-prompt-optimizer
   tar -xzf dsh-external-ui-prompt-optimizer-0.0.1.tgz -C ui-prompt-optimizer --strip-components=1
   ```

3. 在目标 DSH 会话中调用注入器工具：

   ```text
   dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
   dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
   ```

   `dev_build_plugin` 会自动探测目标机器上的 DSH checkout 并完成 host + client 构建；如果插件目录已经带有 `lib/`，也可以只执行 `dev_inject_plugin`。

4. 打开或刷新 DSH Web 页面，进入一个会话，在聊天框输入内容后即可看到优化按钮。

### 方式二：作为本地 bundle 装配

如果目标环境不使用超级模组注入器，可以使用 `dev_install_package` 将插件装配进目标 profile：

```text
dev_install_package {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer", "profile": "web"}
```

该方式会写入目标 profile 的 `package.json` / bundles 配置，并在重启后继续生效。

### 方式三：手动放入 profile 的 bundle 体系

把插件目录放到目标 DSH 可解析的位置，并在 profile 的 `package.json` 中声明依赖和 `bundles` 条目，然后重启 DSH Web。此方式需要手工维护 profile 配置，适合已经使用本地 bundle 工作流的团队。

## 使用步骤

1. 启动 DSH Web 客户端并进入一个会话。
2. 在聊天框输入尚未发送的提示词。
3. 点击输入区工具行中的“优化提示词”图标（无文字，形似魔法棒/星形）。
4. 等待模型返回；聊天框内容会被替换为优化后的提示词。
5. 如果对结果不满意，点击变成“撤回”图标的按钮，恢复原始提示词。
6. 确认后正常发送即可。

## 常见问题

- **按钮不显示**：确认插件已注入成功，然后刷新浏览器页面；同时确认当前是 Web 客户端且有会话/工作区已打开。
- **点击后没有反应**：打开浏览器开发者工具查看 Console 是否有 `prompt optimizer failed` 错误；常见原因是默认模型未配置或 API Key 无效。
- **返回 502 empty prompt**：当前模型可能未返回文本或服务不可用，可尝试在设置中切换模型后重试。

## 构建产物

- host：`lib/index.js`
- client：`lib/client.js`
- 打包文件：`dsh-external-ui-prompt-optimizer-0.0.1.tgz`
