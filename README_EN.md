[中文](./README.md) | [English](./README_EN.md)

# @dsh-external/ui-prompt-optimizer

## Introduction

`ui-prompt-optimizer` is a "prompt optimizer" plugin for the DSH Web client. It adds an icon-only button to the chat composer. Clicking the button sends the unsent draft to the plugin's Host API, where the current default model optimizes it and replaces the original text in the chat box. The button then becomes an "undo" icon; clicking it restores the original prompt.

This is a **Web client plugin** and only affects DSH's browser interface. Non-Web clients such as TUI, ACP, and headless do not show the button or load the browser-side UI.

## Installation

### dsh CLI (Official Project Way)

If you have the `dsh` CLI installed, follow the official project tutorial to install with `dsh plugin`:

```bash
# Install from a local plugin directory
dsh plugin --profile web add C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer

# Or install from the GitHub repository
dsh plugin --profile web add github:xiyue718/dsh-ui-prompt-optimizer
```

Start after installation:

```bash
dsh --profile web
```

View the composed configuration:

```bash
dsh --profile web --dump-config
```

See the project documentation for details: `docs/user/develop/basic/publish.md`.

Build artifacts: host `lib/index.js` (**self-contained**), client `lib/client.js`, package `dsh-external-ui-prompt-optimizer-0.2.0.tgz`.

Build once before installing: `DSH_CHECKOUT=<dsh checkout> bash scripts/build.sh`. Once a profile installs this package, the host resolves the plugin's runtime imports from the package's own directory only, so the host half is bundled into a self-contained module (inlining schemastery, zod, and the `@deepseek-ai/dsh-*` helpers); an unbundled `lib/index.js` leaves the row disabled with `failed to import`.

## Usage

1. Start the DSH Web client and open a session.
2. Type an unsent prompt in the chat box.
3. Click the icon-only "Optimize Prompt" button (no text, shaped like a magic wand/star).
4. Wait for the model to respond; the chat box content is replaced with the optimized prompt.
5. If you are not satisfied, click the button that has become an "Undo" icon to restore the original prompt.
6. Send the final prompt normally.

## Settings

DSH Web → Settings → **Prompt Optimizer**.

| Setting | Control | Meaning |
|---|---|---|
| Optimization model | Dropdown | "Follow the default model selection" or any registered provider/model; defaults to `agent-default-model` |
| Reasoning effort | Graded selector | "Follow the model default" or the levels the selected model offers (`off`/`low`/`medium`/`high`), each listed with its effect on latency and quality |

- The page reads the saved configuration on load and reflects it in the controls; "Save settings" and "Restore defaults" show a status message when they finish.
- The configuration lives on the **deployment** (shared by every session and browser); the browser keeps a local mirror only to paint the last known values immediately.
- The next click on "Optimize Prompt" uses the saved configuration; no restart is needed.
- A deployment without the storage service renders read-only: the save button is disabled and explained.

### Data structure and storage keys

```ts
interface PromptOptimizerConfig {
  /** Optimization route; null follows the agent-default-model selection */
  model: { provider: string; model: string } | null
  /** Reasoning effort id; null follows the effective model's own default */
  reasoningEffort: string | null
}
```

| Location | Key |
|---|---|
| DSH storage domain | `dsh_external_prompt_optimizer` (version `1`) |
| Table | `config` |
| Row key (singleton) | `default` |
| Browser mirror (localStorage) | `dsh-external/ui-prompt-optimizer/config` |

Defaults: `{ "model": null, "reasoningEffort": null }`.

## Features

- Button position: the composer tool row in the session chat input area, icon-only SVG with no text.
- Initial state: available when there is a non-empty draft that has not been sent; click to call the model.
- Optimizing state: the button shows an animated rotating loading icon and is disabled to prevent duplicate clicks.
- After optimization: the draft is replaced with the optimized prompt and the button becomes an "Undo" icon.
- Undo: restores the original prompt saved when optimization was clicked, and the button returns to the "Optimize" icon.
- Protection: if the user modifies the draft before the optimization request returns, the result does not overwrite the user's new content.
- Auto reset: after sending a message or clearing the draft, the button returns to its initial state.
- Runtime dependencies: DSH Web client is running; a default model is configured (`agent-default-model`); the API key for that model is configured; host services are available (`webServer`, `llm`, `agentDefaultModel`).

### Host API

The plugin uses the following interfaces internally; ordinary users do not need to call them directly.

**Optimize a prompt**

```http
POST /@dsh-external/ui-prompt-optimizer/api/optimize
Content-Type: application/json
```

Request body `{ "prompt": "prompt to optimize" }`; success `{ "optimized": "optimized prompt" }`; failure `{ "error": "…" }` (a transport failure carries its underlying cause).

**Read the settings**

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

**Save the settings**

```http
PUT /@dsh-external/ui-prompt-optimizer/api/config
Content-Type: application/json
```

The body is the configuration object. An unknown model route, or an effort the effective model does not offer, answers `400` with the allowed values:

```json
{ "error": "reasoningEffort must be one of off, low, medium, high for setp-fun/step-5-preview" }
```

**Restore defaults**

```http
DELETE /@dsh-external/ui-prompt-optimizer/api/config
```

**Selectable models and levels**

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

## How It Works

The plugin consists of a host half and a client half.

On the client side, it adds an "Optimize Prompt" button to the composer tool row in the chat input area. When clicked, the client saves the current original draft and calls the Host API. While the request is in progress, the button shows an animated loading icon and is disabled. After success, it replaces the chat box content and switches to the "Undo" state. Clicking "Undo" restores the saved original draft.

On the host side, it exposes a settings group and an optimize endpoint. An optimization run first reads the saved settings: the route comes from `config.model`, falling back to `agentDefaultModel.currentSelection()` when unset; the reasoning effort comes from `config.reasoningEffort`, and only in "follow the default model" mode does an unset effort inherit the default selection's own effort, so a level configured for one model is never applied to another. It then calls `ctx.llm.stream` with a fixed system prompt ("You are a prompt optimization assistant..."), temperature 0.3, and a 2048-token cap. Settings persist in the `config` table of the `dsh_external_prompt_optimizer` storage domain; the model and level lists come from `ctx.llm.listProviders()`, `listModels()`, and `resolveModelInfo()`.
