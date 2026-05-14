# OpenClaude Multi-Window

VS Code extension forked from [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude/tree/main/vscode-extension/openclaude-vscode) that adds **multiple chat tabs** to the OpenClaude sidebar — each tab runs its own `openclaude` CLI subprocess with its own model.
<img width="691" height="1423" alt="image" src="https://github.com/user-attachments/assets/570505da-876f-43e1-93d0-a3217343af44" />

## Features

- **Tabbed Command Centre** in the sidebar. `+` for new chat, `×` to close, click to switch, `↗` to open the chat in a regular VS Code editor tab (Kilocode-style).
- **Per-tab model picker** — searchable, grouped by provider. Bundles **30 providers / 116 models** extracted from upstream openclaude's gateway + brand definitions (Anthropic, OpenAI, Google Gemini, DeepSeek, GLM, Kimi, Llama, Mistral, Qwen, xAI, MiniMax, Nemotron, Groq, Moonshot, NVIDIA NIM, Ollama, OpenRouter, Together, Vertex, Bedrock, Azure OpenAI, GitHub Copilot, lmstudio, dashscope, kimi-code, atomic-chat, hicap, custom OpenAI-compatible). Custom model id always available.
- **Each chat its own `--model` and `--resume <session>` flags.** Up to 8 concurrent chats; chat list persists in `globalState` across reloads.
- **Status bar** shows count of open + currently-streaming chats.
- **Mock CLI** (`scripts/mock-openclaude.cjs`) for testing without an API key.

## Install

```powershell
code --install-extension openclaude-multiwindow-0.4.3.vsix
```

Then **Developer: Reload Window**, open the OpenClaude activity bar.

## Settings

| Setting | What it does |
|---|---|
| `openclaude.launchCommand` | Command to spawn per chat (default `openclaude`). |
| `openclaude.useOpenAIShim` | Sets `CLAUDE_CODE_USE_OPENAI=1` in the subprocess env. |
| `openclaude.permissionMode` | `default` / `acceptEdits` / `bypassPermissions` / `plan`. |
| `openclaude.modelContextOverrides` | `{ "<model-id>": <tokens> }` — silences `[context] Warning:` for unknown models AND exposes the size to the CLI via `OPENCLAUDE_CTX_<UPPER_MODEL>` + `OPENCLAUDE_MODEL_CONTEXT_OVERRIDES` env vars. |
| `openclaude.modelCatalogExtras` | Append your own providers/models to the picker. Each entry: `{ id, label, baseUrl?, defaultModel?, models: [{id, label}] }`. |
| `openclaude.providerEnvOverrides` | Per-provider env vars injected when a chat uses a model from that provider. **Required for true multi-provider support.** Key = provider id (shown in the picker's group header). Example: `{ "xai-direct": { "OPENAI_BASE_URL": "https://api.x.ai/v1", "OPENAI_API_KEY": "xai-..." }, "groq": { "OPENAI_API_KEY": "gsk_..." } }`. Gateway providers (Groq, OpenRouter, Together, …) get their `OPENAI_BASE_URL` auto-set from the catalog; you only need to supply the API key. |

## Commands

| Command | What it does |
|---|---|
| `OpenClaude: New Chat` | Add a tab to the strip with a fresh process. |
| `OpenClaude: Open Active Chat in Editor Tab` | Pin the current tab to a regular editor pane. |
| `OpenClaude: Open Chat in New Editor Tab…` | Pick any tab to pin. |
| `OpenClaude: Resume Session` | Quick-pick from session history. Creates a new tab. |
| `OpenClaude: Abort Generation` | SIGINT the active tab's subprocess. |

## Architecture

```
extension.js
└── ChatRegistry  (Map<chatId, ChatController>, persisted to globalState)
    └── ChatController × N  (each owns one ProcessManager + one bindToken)
        └── ProcessManager  (spawns `openclaude --print --model X --resume Y`)

OpenClaudeChatViewProvider  → sidebar webview, rebinds to active chat on tab switch
OpenClaudeChatPanelManager  → Map<chatId, WebviewPanel> for editor-area "open in new tab"
```

Cross-chat message leaks during fast tab swaps are prevented by a per-bind monotonic `bindToken` — host drops any incoming webview message whose token is stale.

## Verification

```bash
npm run lint        # node --check on every src/*.js
npm test            # node --test src/chat/chatRegistry.test.js (7 cases)
npm run package     # vsce package --no-dependencies
```

To smoke-test without an API key, point the extension at the bundled mock:

```jsonc
// .vscode/settings.json
"openclaude.launchCommand": "node ${userHome}/.../scripts/mock-openclaude.cjs"
```

## Credit

Built on [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude). The provider catalog under `src/chat/providerCatalog.json` is extracted verbatim from upstream's `src/integrations/gateways/*.ts` and `src/integrations/brands/*.ts`.

## Changelog

### v0.4.3
- Fix message mixing on tab switch (clear DOM on replace restore); restore streaming indicator when switching back to active chat; fix duplicate "Chat N" tab naming with monotonic counter.

### v0.4.2
- Profile routing fix: writes per-provider `.openclaude-profile.json` before spawn to bypass CLI profile clobber; Inception/Mercury provider added; base URLs added for 8 direct providers; version badge in UI header; prefix model-ID matching; catalog error handling improved.

### v0.4.1
- Multi-provider support via `openclaude.providerEnvOverrides` — per-tab `OPENAI_BASE_URL`/`API_KEY` injection.

## License

MIT (matches upstream).
