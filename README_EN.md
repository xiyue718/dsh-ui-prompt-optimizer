# @dsh-external/ui-prompt-optimizer

## Introduction

`ui-prompt-optimizer` is a "prompt optimizer" plugin for the DSH Web client. It adds an icon-only button to the chat composer. Clicking the button sends the unsent draft to the plugin's Host API, where the current default model optimizes it and replaces the original text in the chat box. The button then becomes an "undo" icon; clicking it restores the original prompt.

This is a **Web client plugin** and only affects DSH's browser interface. Non-Web clients such as TUI, ACP, and headless do not show the button or load the browser-side UI.

## Installation

### Method 1: Super Module Injector

```text
dev_build_plugin  {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
dev_inject_plugin {"dir": "C:/Users/<user>/.dsh/plugins/ui-prompt-optimizer"}
```

Open or refresh DSH Web, enter a session, and type a draft in the chat box to see the optimizer button.

### Method 2: dsh CLI (Official Project Way)

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

Build artifacts: host `lib/index.js`, client `lib/client.js`, package `dsh-external-ui-prompt-optimizer-0.1.0.tgz`.

## Usage

1. Start the DSH Web client and open a session.
2. Type an unsent prompt in the chat box.
3. Click the icon-only "Optimize Prompt" button (no text, shaped like a magic wand/star).
4. Wait for the model to respond; the chat box content is replaced with the optimized prompt.
5. If you are not satisfied, click the button that has become an "Undo" icon to restore the original prompt.
6. Send the final prompt normally.

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

The plugin uses the following interface internally; ordinary users do not need to call it directly:

```http
POST /@dsh-external/ui-prompt-optimizer/api/optimize
Content-Type: application/json
```

Request body:

```json
{ "prompt": "prompt to optimize" }
```

Success response:

```json
{ "optimized": "optimized prompt" }
```

Example error response:

```json
{ "error": "no default model is configured" }
```

## How It Works

The plugin consists of a host half and a client half.

On the client side, it adds an "Optimize Prompt" button to the composer tool row in the chat input area. When clicked, the client saves the current original draft and calls the Host API. While the request is in progress, the button shows an animated loading icon and is disabled. After success, it replaces the chat box content and switches to the "Undo" state. Clicking "Undo" restores the saved original draft.

On the host side, it exposes `POST /@dsh-external/ui-prompt-optimizer/api/optimize`. When a request arrives, it gets the current default model through `agentDefaultModel.currentSelection()`, uses a fixed system prompt ("You are a prompt optimization assistant..."), and calls `ctx.llm.stream` to generate the optimized result with reasoning disabled and a low temperature for more stable, concise output. If no model is configured or the model returns empty text, the API returns a clear error.
