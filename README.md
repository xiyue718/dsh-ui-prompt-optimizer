[中文](./README.md) | [English](./README_EN.md)

# @dsh-external/ui-prompt-optimizer

## 介绍

`ui-prompt-optimizer` 是 DSH Web 客户端的“优化提示词”插件。它在会话聊天输入区添加一个仅图标的按钮，点击后把当前未发送的草稿发送到本插件的 host API，由当前默认模型优化后替换聊天框中的原文；按钮同时变成“撤回”图标，再次点击会恢复原始提示词。

本插件是 **Web 客户端插件**，只对 DSH 的浏览器界面生效。TUI、ACP、headless 等非 Web 客户端不会显示该按钮，也不会加载浏览器侧 UI。

## 安装

### dsh 命令安装（项目官方方式）

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

构建产物：host 为**自包含**的 `lib/index.js`，client 为 `lib/client.js`，打包文件为 `dsh-external-ui-prompt-optimizer-0.2.0.tgz`。

安装前先构建一次：`DSH_CHECKOUT=<dsh 源码 checkout> bash scripts/build.sh`。官方渠道把插件装进 profile 后，宿主只从插件自身目录解析运行期依赖，所以 host 半由 tsdown 打包成自包含模块（内联 schemastery、zod 与 `@deepseek-ai/dsh-*` helper）；未打包的 `lib/index.js` 会让该行以 `failed to import` 停用。

## 使用

1. 启动 DSH Web 客户端并进入一个会话。
2. 在聊天框输入尚未发送的提示词。
3. 点击输入区工具行中的“优化提示词”图标（无文字，形似魔法棒/星形）。
4. 等待模型返回；聊天框内容会被替换为优化后的提示词。
5. 如果对结果不满意，点击变成“撤回”图标的按钮，恢复原始提示词。
6. 确认后正常发送即可。

## 设置

DSH Web 设置 → **提示词优化**。

| 配置项 | 控件 | 说明 |
|---|---|---|
| 优化模型 | 下拉选择 | 「跟随默认模型选择」或任意已注册的 provider/model；默认跟随 `agent-default-model` |
| 思考强度 | 分级选择器 | 「跟随模型默认」或所选模型提供的档位（如 `off`/`low`/`medium`/`high`），列表中逐档说明对速度与质量的影响 |

- 页面加载时读取已保存配置并回显到控件；「保存设置」与「恢复默认」完成后显示提示文字。
- 配置保存在**部署侧**（所有会话、所有浏览器共用）；浏览器另存一份本地镜像，只用于首屏立即回显。
- 保存后下一次点击「优化提示词」立即使用新配置，无需重启。
- 未挂载存储服务的部署只能读取，保存按钮会禁用并给出说明。

### 数据结构与存储键

```ts
interface PromptOptimizerConfig {
  /** 优化路由；null = 跟随 agent-default-model 的默认选择 */
  model: { provider: string; model: string } | null
  /** 思考强度 id；null = 跟随有效模型自身的默认档 */
  reasoningEffort: string | null
}
```

| 位置 | 键 |
|---|---|
| DSH 存储域 | `dsh_external_prompt_optimizer`（version `1`） |
| 表 | `config` |
| 行键（单例） | `default` |
| 浏览器镜像（localStorage） | `dsh-external/ui-prompt-optimizer/config` |

默认值：`{ "model": null, "reasoningEffort": null }`。

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

插件内部使用以下接口，普通用户不需要直接调用。

**优化提示词**

```http
POST /@dsh-external/ui-prompt-optimizer/api/optimize
Content-Type: application/json
```

请求体 `{ "prompt": "要优化的提示词" }`；成功响应 `{ "optimized": "优化后的提示词" }`；失败响应 `{ "error": "…" }`（传输层失败会附带底层 cause）。

**读取设置**

```http
GET /@dsh-external/ui-prompt-optimizer/api/config
```

```json
{
  "config": { "model": null, "reasoningEffort": null },
  "defaults": { "model": null, "reasoningEffort": null },
  "selection": { "provider": "setp-fun", "model": "step-5-preview", "reasoningEffort": "high" },
  "storage": true
}
```

**保存设置**

```http
PUT /@dsh-external/ui-prompt-optimizer/api/config
Content-Type: application/json
```

请求体即配置对象。模型路由未知、或强度不在该模型可选档位内时返回 `400` 并说明允许值，例如：

```json
{ "error": "reasoningEffort must be one of off, low, medium, high for setp-fun/step-5-preview" }
```

**恢复默认**

```http
DELETE /@dsh-external/ui-prompt-optimizer/api/config
```

**可选模型与档位**

```http
GET /@dsh-external/ui-prompt-optimizer/api/models
```

```json
{
  "providers": [
    {
      "id": "setp-fun",
      "name": "Step",
      "models": [
        { "id": "step-5-preview", "name": "Step-5-Preview", "efforts": [{ "id": "low", "name": "Low" }] }
      ]
    }
  ]
}
```

## 原理

插件由 host 和 client 两部分组成。

Client 侧在聊天输入区的 composer 工具行添加“优化提示词”按钮。点击后，client 保存当前原始草稿并调用 Host API；请求期间按钮显示动态加载图标并禁用；返回成功后替换聊天框内容并切换到“撤回”状态；点击“撤回”时恢复保存的原始草稿。

Host 侧暴露设置与优化两组接口。优化时先读取已保存的设置：模型取 `config.model`，未配置则回落到 `agentDefaultModel.currentSelection()`；思考强度取 `config.reasoningEffort`，未配置时只在「跟随默认模型」模式下沿用默认选择里的强度（显式选定模型时不再沿用，避免把另一个模型的档位套上去）。随后使用固定的系统提示词（“你是一个提示词优化助手……”）调用 `ctx.llm.stream`，温度 0.3、上限 2048 token。设置持久化在 `dsh_external_prompt_optimizer` 存储域的 `config` 表；模型与档位清单实时取自 `ctx.llm.listProviders()`、`listModels()` 与 `resolveModelInfo()`。
