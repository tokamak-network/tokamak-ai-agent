# Tokamak AI Agent

A VS Code Extension that brings the company's internal AI models (LiteLLM-based OpenAI-compatible API) directly into your development workflow.

---

## Quick Start (Installation)

### 1. Download & Install via VSIX
You can easily install the extension using the pre-built VSIX file without building it from source.

1. Download the `.vsix` file from the [GitHub Releases](https://github.com/tokamak-network/tokamak-ai-agent/releases).
2. In VS Code, open the **Extensions** view (`Cmd+Shift+X`).
3. Click the **More Actions...** (three dots) menu in the top-right corner of the Extensions view.
4. Select **Install from VSIX...**.
5. Select the downloaded `.vsix` file.

---

## API Configuration

Open Settings (`Cmd+,` on Mac / `Ctrl+,` on Windows) and search for `tokamak`.

| Setting | Description | Required |
|------|------|:----:|
| `tokamak.apiKey` | AI Service API Key | ✅ |
| `tokamak.baseUrl` | API Endpoint URL (e.g., `https://api.example.com/v1`) | ✅ |
| `tokamak.models` | List of available models | - |
| `tokamak.selectedModel` | Currently selected model | - |
| `tokamak.enableInlineCompletion` | Enable/Disable Ghost Text auto-completion | - |
| `tokamak.completionDebounceMs` | Auto-completion delay (default 300ms) | - |

**Example settings.json:**
```json
{
  "tokamak.apiKey": "your-api-key",
  "tokamak.baseUrl": "https://your-api-endpoint.com/v1",
  "tokamak.models": [
    "qwen3-235b-thinking",
    "qwen3-235b",
    "qwen3-80b-next",
    "qwen3-coder-flash",
    "gemini-3-pro",
    "gemini-3-flash"
  ],
  "tokamak.selectedModel": "qwen3-235b-thinking"
}
```

---

## Build from Source (For Developers)

### 1. Build Extension

```bash
# Install dependencies
npm install

# Compile source code
npm run compile
```

### 2. Run in Development Mode

Open the project folder in VS Code and press `F5` to launch the **Extension Development Host**.


---

## Core Features

### 1. AI Chat

**Open Chat:**
- Shortcut: `Cmd+Shift+I` (Mac) / `Ctrl+Shift+I` (Windows)
- Or: `Cmd+Shift+P` → "Tokamak: Open Chat"

The chat panel opens alongside your editor, allowing you to see your code and the AI conversation simultaneously.

```
┌──────────┬─────────────────┬─────────────────┐
│  📁      │                 │                 │
│  Explorer│   Code Editor   │  Tokamak AI     │
│  (Folder)│                 │  Chat           │
└──────────┴─────────────────┴─────────────────┘
```

#### File Attachment (@mention)

Reference project files easily within the chat.

1. Type `@` in the input field.
2. Start typing a filename to see suggestions.
3. Use `↑` `↓` to navigate and `Enter` or `Tab` to attach.

You can attach multiple files to a single message.

```
┌─────────────────────────────────────┐
│  📄 extension.ts        src/        │  ← Suggestions
│  📄 chatPanel.ts        src/chat/   │
│  📄 client.ts           src/api/    │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ 📄 extension.ts ×  📄 client.ts ×   │  ← Attached Files
├─────────────────────────────────────┤
│ Compare these two files               │  ← Message Input
└─────────────────────────────────────┘
```

- **Click File Tag**: Open the file in the editor.
- **Click ×**: Remove the attachment.

#### Automatic Context

If no files are explicitly mentioned, the AI automatically receives the **currently active file** and any **selected code** as context.

#### Model Selection

Switch between different models using the dropdown at the top of the chat panel.

#### Code Insertion

Click the `Insert` button on a code block in the AI's response to insert the code at your current cursor position.

#### Run Terminal Commands

Click the `▶ Run` button on bash/shell code blocks to execute commands directly in the integrated terminal.

#### Send Selection to Chat

Highlight code, right-click, and select **Tokamak: Send to Chat** to quickly move code snippets to the chat input.

#### Chat History

Conversation history is saved automatically and persists across VS Code restarts (saved per project).

---

### 2. Slash Commands (Skills)

Type `/` in the input field to access quick actions.

```
┌─────────────────────────────────────┐
│ ⚡ /explain    Explain code         │
│ ⚡ /refactor   Suggest refactoring  │
│ ⚡ /fix        Find and fix bugs    │
│ ⚡ /test       Generate unit tests  │
│ ⚡ /docs       Add documentation    │
│ ⚡ /optimize   Optimize performance │
│ ⚡ /security   Security audit       │
└─────────────────────────────────────┘
```

**Examples:**
- `/explain` - Explains selected code or the open file.
- `/fix This function returns null` - Request a fix with additional context.
- `/test` - Automatically generates test code.

#### Creating Custom Skills

You can define project-specific skills for your team.

**1. Initialize Skills Folder:**
```
Cmd+Shift+P → "Tokamak: Initialize Skills Folder"
```

This creates the `.tokamak/skills/` directory with default templates.

**2. Skills Directory Structure:**
```
Project/
├── .tokamak/
│   └── skills/
│       ├── explain.md      → /explain
│       ├── refactor.md     → /refactor
│       ├── my-custom.md    → /my-custom (Add your own)
│       └── ...
```

**3. Skill File Format:**
```markdown
---
description: Skill description (shown in autocomplete)
---

Enter the prompt you want to send to the AI here.
Markdown formatting is supported.

Example:
1. First instruction
2. Second instruction
```

**4. Example - Code Review Skill (`review.md`):**
```markdown
---
description: Senior developer perspective code review
---

Please review this code from a senior developer's perspective:

1. Code quality and best practices
2. Potential bugs or edge cases
3. Security issues
4. Performance concerns
5. Suggestions for improvement

Provide specific and constructive feedback.
```

**Benefits:**
- Share standard prompts with your team via Git.
- Tailor skills to specific project needs.
- Update/add skills without touching the extension source code.

---

### 3. Chat Modes

Choose from three distinct interaction modes at the top of the chat panel.

```
┌─────────────────────────────────────┐
│ [💬 Ask] [📋 Plan] [🤖 Agent]       │
└─────────────────────────────────────┘
```

#### 💬 Ask Mode (Default)

The classic Q&A interaction.

- "How does this function work?"
- "How do I fix this error?"
- "Explain state management in React."

**Best for:** Simple questions and general knowledge.

---

#### 📋 Plan Mode

Focuses on architectural planning before implementation.

- "I want to add user authentication. How should I approach it?"
- "I want to split this code into microservices."
- "What do I need to do to write test code for this?"

**Provides:** Structured implementation steps, files to modify, and potential challenges **without writing code**.

---

#### 🤖 Agent Mode

The AI acts as an autonomous agent that can create, edit, and delete files.

- "Create a login page."
- "Add error handling to this function."
- "Generate a test file."

**Workflow:**
1. Select Agent mode.
2. Enter your request.
3. Review proposed file changes in the **Pending File Operations** panel.

```
┌─────────────────────────────────────┐
│ ⚡ Pending File Operations          │
├─────────────────────────────────────┤
│ [CREATE] src/utils/helper.ts [Preview]│
│ [EDIT]   src/index.ts        [Preview]│
│ [DELETE] src/old-file.ts     [Preview]│
├─────────────────────────────────────┤
│ [✓ Apply Changes]  [✗ Reject]       │
└─────────────────────────────────────┘
```

4. Click **Preview** to see a Diff of the changes.
5. Click **Apply Changes** to write to disk, or **Reject** to cancel.

---

### 4. Inline Completion (Ghost Text)

Get real-time suggestions as you type, similar to GitHub Copilot.

- Active by default.
- Press `Tab` to accept a suggestion.
- Press `Esc` to ignore.

Disable in settings:
```json
{
  "tokamak.enableInlineCompletion": false
}
```

---

### 5. Code Explanation / Refactoring

Access features directly from the editor context menu.

#### Explain Code
1. Select code.
2. Right-click → **Tokamak: Explain Code**.
3. View the explanation in the Output panel.

#### Refactor Code
1. Select code.
2. Right-click → **Tokamak: Refactor Code**.
3. Choose a refactoring type (Readability, Performance, Error Handling, etc.).
4. Review and Apply the changes.

---

## Commands

| Command | Shortcut | Description |
|--------|--------|------|
| Tokamak: Open Chat | `Cmd+Shift+I` | Open the AI chat panel |
| Tokamak: Send to Chat | - | Send selected code to chat |
| Tokamak: Explain Code | - | Get an explanation of the selection |
| Tokamak: Refactor Code | - | Refactor the selected code |
| Tokamak: Clear Chat History | - | Delete previous messages |
| Tokamak: Initialize Skills Folder | - | Create the custom skills directory |

---

## Troubleshooting

### API Connection Error
- Check if the LiteLLM server is running.
- Verify the model name in settings.
- Check your network/VPN status.

### Chat Panel Not Opening
- Use `Cmd+Shift+P` → "Tokamak: Open Chat" manually.
- Check if the extension is enabled in the Extensions view.

---

## Development

```bash
# Compile (Once)
npm run compile

# Watch mode (Auto-compile on change)
npm run watch

# Package as VSIX
npm run package
```

---

## Tech Stack

- **Language**: TypeScript
- **Build**: tsc
- **API**: OpenAI Node.js SDK
- **Packaging**: vsce
