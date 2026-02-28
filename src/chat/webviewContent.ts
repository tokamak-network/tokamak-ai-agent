export function getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tokamak Chat</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #header {
            padding: 10px 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
        }
        #header-top {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }
        #header h3 {
            margin: 0;
            font-size: 1em;
            font-weight: 600;
        }
        #header label {
            font-size: 0.85em;
            opacity: 0.8;
            margin-left: auto;
        }
        #new-chat-btn {
            padding: 4px 10px;
            border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        #new-chat-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        #model-select {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.9em;
        }
        #mode-tabs {
            display: flex;
            gap: 4px;
        }
        .mode-tab {
            padding: 6px 14px;
            border: none;
            background-color: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 0.85em;
            opacity: 0.7;
            transition: all 0.2s;
        }
        .mode-tab:hover {
            opacity: 1;
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .mode-tab.active {
            opacity: 1;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .mode-description {
            font-size: 0.8em;
            opacity: 0.6;
            margin-top: 6px;
            padding: 4px 8px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
        }
        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 8px;
            word-wrap: break-word;
            line-height: 1.5;
        }
        .message.user {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 40px;
        }
        .message.assistant {
            background-color: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-widget-border);
            margin-right: 40px;
        }
        .message-role {
            font-weight: bold;
            font-size: 0.85em;
            margin-bottom: 6px;
            opacity: 0.8;
        }
        pre {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 10px 0;
            position: relative;
        }
        code {
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
        }
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 12px;
            background-color: var(--vscode-titleBar-activeBackground);
            border-radius: 6px 6px 0 0;
            margin-bottom: -6px;
            font-size: 0.85em;
        }
        .insert-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        .insert-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .run-btn {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
            border: none;
            padding: 4px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            margin-left: 6px;
        }
        .run-btn:hover {
            opacity: 0.9;
        }
        #token-usage-bar {
            padding: 6px 15px;
            background-color: var(--vscode-editorWidget-background);
            border-top: 1px solid var(--vscode-widget-border);
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .token-label {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        #token-display {
            font-weight: bold;
            color: var(--vscode-charts-blue);
        }
        .token-detail {
            opacity: 0.7;
            font-size: 0.9em;
        }
        #input-container {
            padding: 15px;
            border-top: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-sideBar-background);
            position: relative;
        }
        #attached-files {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 10px;
        }
        #attached-files:empty {
            display: none;
        }
        .file-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
            font-size: 0.85em;
        }
        .file-tag .remove-btn {
            cursor: pointer;
            opacity: 0.7;
            font-size: 1.1em;
            line-height: 1;
        }
        .file-tag .remove-btn:hover {
            opacity: 1;
        }
        .image-tag {
            display: inline-flex;
            position: relative;
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            overflow: hidden;
            background: var(--vscode-editor-background);
        }
        .image-tag img {
            max-width: 80px;
            max-height: 80px;
            display: block;
            object-fit: cover;
        }
        .image-tag .remove-img {
            position: absolute;
            top: 2px;
            right: 2px;
            background: rgba(0, 0, 0, 0.6);
            color: white;
            border-radius: 50%;
            width: 16px;
            height: 16px;
            font-size: 10px;
            text-align: center;
            line-height: 16px;
            cursor: pointer;
            z-index: 10;
        }
        .file-tag .file-name {
            cursor: pointer;
        }
        .file-tag .file-name:hover {
            text-decoration: underline;
        }
        #input-wrapper {
            display: flex;
            gap: 10px;
            position: relative;
        }
        #message-input {
            flex: 1;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-family: inherit;
            font-size: inherit;
            resize: none;
            min-height: 40px;
            max-height: 150px;
        }
        #message-input:focus {
            outline: 2px solid var(--vscode-focusBorder);
        }
        #send-btn {
            padding: 10px 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        #send-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        #send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        #stop-btn {
            display: none;
            padding: 10px 20px;
            background-color: var(--vscode-errorForeground);
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        #stop-btn:hover {
            opacity: 0.9;
        }
        #stop-btn.visible {
            display: block;
        }
        .typing-indicator {
            display: none;
            padding: 10px 15px;
            font-style: italic;
            opacity: 0.7;
        }
        .typing-indicator.visible {
            display: block;
        }
        #autocomplete {
            display: none;
            position: absolute;
            bottom: 100%;
            left: 15px;
            right: 15px;
            max-height: 200px;
            overflow-y: auto;
            background-color: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 6px;
            margin-bottom: 5px;
            box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.2);
        }
        #autocomplete.visible {
            display: block;
        }
        .autocomplete-item {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .autocomplete-item:hover,
        .autocomplete-item.selected {
            background-color: var(--vscode-list-hoverBackground);
        }
        .autocomplete-item .icon {
            opacity: 0.7;
        }
        .autocomplete-item .path {
            opacity: 0.6;
            font-size: 0.85em;
            margin-left: auto;
        }
        .autocomplete-item .desc {
            opacity: 0.6;
            font-size: 0.85em;
            margin-left: auto;
        }
        .autocomplete-item.slash-cmd .icon {
            color: var(--vscode-terminal-ansiYellow);
        }
        .hint {
            font-size: 0.8em;
            opacity: 0.6;
            margin-top: 6px;
        }
        .drop-zone {
            position: relative;
        }
        .drop-zone.drag-over {
            background-color: var(--vscode-editor-hoverHighlightBackground);
        }
        .drop-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--vscode-editor-background);
            border: 2px dashed var(--vscode-focusBorder);
            border-radius: 6px;
            justify-content: center;
            align-items: center;
            font-size: 1.1em;
            opacity: 0.95;
            z-index: 10;
        }
        .drop-zone.drag-over .drop-overlay {
            display: flex;
        }
        #operations-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-notifications-background);
            border-top: 1px solid var(--vscode-widget-border);
        }
        #operations-panel.visible {
            display: block;
        }
        #operations-panel h4 {
            margin: 0 0 10px 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .operation-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 6px;
            font-size: 0.85em;
        }
        .operation-item .op-type {
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: 600;
        }
        .operation-item .op-type.create {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .operation-item .op-type.edit {
            background-color: var(--vscode-editorWarning-foreground);
            color: black;
        }
        .operation-item .op-type.write_full {
            background-color: var(--vscode-editorWarning-foreground);
            color: black;
        }
        .operation-item .op-type.replace {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .operation-item .op-type.prepend {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .operation-item .op-type.append {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .operation-item .op-type.delete {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        .operation-item .preview-btn {
            padding: 2px 8px;
            border: 1px solid var(--vscode-widget-border);
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.8em;
            margin-left: auto;
        }
        .operation-item .preview-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .operation-item .reject-item-btn {
            padding: 2px 6px;
            border: none;
            background-color: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 1.1em;
            opacity: 0.6;
            margin-left: 4px;
        }
        .operation-item .reject-item-btn:hover {
            opacity: 1;
            color: var(--vscode-errorForeground);
        }
        #operations-buttons {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }
        #operations-buttons button {
            padding: 6px 14px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
        }
        #apply-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        #reject-btn {
            background-color: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-widget-border)!important;
        }

        /* Sessions History Panel */
        #history-panel {
            position: fixed;
            top: 0;
            left: -300px;
            width: 300px;
            height: 100%;
            background-color: var(--vscode-sideBar-background);
            border-right: 1px solid var(--vscode-widget-border);
            z-index: 1000;
            transition: left 0.3s ease;
            display: flex;
            flex-direction: column;
            box-shadow: 2px 0 10px rgba(0, 0, 0, 0.2);
        }
        #history-panel.visible {
            left: 0;
        }
        #history-header {
            padding: 15px;
            border-bottom: 1px solid var(--vscode-widget-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #history-search {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-widget-border);
            background-color: var(--vscode-input-background);
        }
        #history-search-input {
            width: 100%;
            padding: 6px 10px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.85em;
        }
        #history-search-input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        #history-search-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        #history-list {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .session-item {
            padding: 10px;
            margin-bottom: 8px;
            border-radius: 6px;
            cursor: pointer;
            border: 1px solid transparent;
            position: relative;
            transition: all 0.2s;
        }
        .session-item:hover {
            background-color: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-widget-border);
        }
        .session-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .session-title {
            font-weight: 500;
            font-size: 0.9em;
            margin-bottom: 4px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .session-date {
            font-size: 0.75em;
            opacity: 0.6;
            margin-bottom: 4px;
        }
        .session-mode {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.7em;
            font-weight: 600;
            margin-top: 4px;
        }
        .session-mode.ask {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .session-mode.plan {
            background-color: var(--vscode-charts-yellow);
            color: black;
        }
        .session-mode.agent {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        .session-actions {
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .session-item:hover .session-actions {
            opacity: 1;
        }
        .delete-session, .export-session {
            cursor: pointer;
            padding: 4px;
            font-size: 0.9em;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        .delete-session:hover, .export-session:hover {
            opacity: 1;
        }
        .delete-session:hover {
            color: var(--vscode-errorForeground);
        }
        .export-session:hover {
            color: var(--vscode-textLink-foreground);
        }
        #history-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.3);
            z-index: 999;
        }
        #history-overlay.visible {
            display: block;
        }
        #history-btn {
            background: transparent;
            border: 1px solid var(--vscode-widget-border);
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        #history-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }

        /* Interactive Planner Styles */
        #plan-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-widget-border);
            border-bottom: 1px solid var(--vscode-widget-border);
            max-height: 200px;
            overflow-y: auto;
        }
        #plan-panel.visible {
            display: block;
        }
        .plan-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .plan-header h4 {
            margin: 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .agent-status-badge {
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 10px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .plan-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 6px;
            font-size: 0.85em;
            opacity: 0.8;
        }
        .plan-item.running {
            opacity: 1;
            font-weight: bold;
            color: var(--vscode-textLink-foreground);
        }
        .plan-item.done {
            opacity: 0.6;
            text-decoration: line-through;
        }
        .plan-item.failed {
            color: var(--vscode-errorForeground);
            opacity: 1;
        }
        .step-icon {
            flex-shrink: 0;
            width: 16px;
            text-align: center;
        }
        .step-desc {
            flex: 1;
        }

        /* Checkpoint Panel Styles */
        #checkpoints-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-sideBar-background);
            border-top: 1px solid var(--vscode-widget-border);
            max-height: 300px;
            overflow-y: auto;
        }
        #checkpoints-panel.visible {
            display: block;
        }
        .checkpoints-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .checkpoints-header h4 {
            margin: 0;
            font-size: 0.9em;
        }
        .checkpoint-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            margin-bottom: 6px;
            font-size: 0.85em;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        .checkpoint-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .checkpoint-info {
            flex: 1;
            min-width: 0;
        }
        .checkpoint-description {
            font-weight: 500;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 2px;
        }
        .checkpoint-meta {
            font-size: 0.75em;
            opacity: 0.6;
        }
        .checkpoint-actions {
            display: flex;
            gap: 4px;
        }
        .checkpoint-btn {
            padding: 4px 8px;
            border: 1px solid var(--vscode-widget-border);
            background-color: transparent;
            color: var(--vscode-foreground);
            border-radius: 3px;
            cursor: pointer;
            font-size: 0.75em;
        }
        .checkpoint-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .checkpoint-btn.compare {
            color: var(--vscode-textLink-foreground);
        }
        .checkpoint-btn.restore {
            color: var(--vscode-testing-iconPassed);
        }
        .checkpoint-btn.delete {
            color: var(--vscode-errorForeground);
        }
        /* Multi-model review UI */
        .multi-model-row {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
            font-size: 0.82em;
        }
        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 32px;
            height: 18px;
        }
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background-color: var(--vscode-input-border);
            border-radius: 18px;
            transition: 0.2s;
        }
        .toggle-slider:before {
            content: "";
            position: absolute;
            height: 12px;
            width: 12px;
            left: 3px;
            bottom: 3px;
            background-color: var(--vscode-foreground);
            border-radius: 50%;
            transition: 0.2s;
        }
        .toggle-switch input:checked + .toggle-slider {
            background-color: var(--vscode-button-background);
        }
        .toggle-switch input:checked + .toggle-slider:before {
            transform: translateX(14px);
        }
        .role-model-select {
            display: none;
            align-items: center;
            gap: 4px;
        }
        .role-model-select.visible {
            display: flex;
        }
        .role-model-select label {
            font-size: 0.8em;
            opacity: 0.7;
            white-space: nowrap;
        }
        .role-model-select select {
            padding: 2px 6px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.85em;
        }
        /* Strategy select dropdown */
        .strategy-row {
            display: none;
            align-items: center;
            gap: 6px;
            padding: 0 15px 4px;
            font-size: 0.82em;
        }
        .strategy-row.visible {
            display: flex;
        }
        .strategy-row label {
            opacity: 0.7;
            white-space: nowrap;
        }
        .strategy-row select {
            padding: 2px 6px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: inherit;
            font-size: 0.85em;
        }
        /* Review/Debate Results Panels */
        #review-results-panel, #debate-results-panel {
            display: none;
            padding: 12px 15px;
            background-color: var(--vscode-notifications-background);
            border-top: 1px solid var(--vscode-widget-border);
        }
        #review-results-panel.visible, #debate-results-panel.visible {
            display: block;
        }
        #review-results-panel h4, #debate-results-panel h4 {
            margin: 0 0 8px 0;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .convergence-badge {
            font-size: 0.75em;
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: bold;
        }
        .convergence-badge.converged {
            background-color: #16a34a;
            color: #fff;
        }
        .convergence-badge.stalled {
            background-color: #dc2626;
            color: #fff;
        }
        .convergence-badge.continue {
            background-color: #2563eb;
            color: #fff;
        }
        .round-item {
            margin-bottom: 8px;
            padding: 6px 10px;
            border-left: 3px solid var(--vscode-input-border);
            font-size: 0.85em;
        }
        .round-item .round-header {
            font-weight: bold;
            margin-bottom: 4px;
            opacity: 0.9;
        }
        .round-item .round-content {
            white-space: pre-wrap;
            opacity: 0.8;
            max-height: 200px;
            overflow-y: auto;
        }
        .synthesis-block {
            margin-top: 8px;
            padding: 8px 10px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 0.85em;
            white-space: pre-wrap;
            max-height: 300px;
            overflow-y: auto;
        }
        .result-actions {
            display: flex;
            gap: 8px;
            margin-top: 10px;
        }
        .result-actions button {
            padding: 4px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: 0.85em;
        }
        .result-actions .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .result-actions .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
    </style>
</head>
<body>
    <div id="history-overlay"></div>
    <div id="history-panel">
        <div id="history-header">
            <h4>Chat History</h4>
            <button id="close-history" style="background:none; border:none; color:inherit; cursor:pointer; font-size:1.4em;">×</button>
        </div>
        <div id="history-search">
            <input type="text" id="history-search-input" placeholder="Search conversations...">
        </div>
        <div id="history-list"></div>
    </div>
    <div id="header">
        <div id="header-top">
            <button id="history-btn" title="Past Conversations">🕒 History</button>
            <div style="flex:1"></div>
            <h3>Tokamak AI</h3>
            <div style="flex:1"></div>
            <label for="model-select" style="font-size: 0.8em; opacity: 0.7;">Model: </label>
            <select id="model-select"></select>
            <div class="multi-model-row">
                <label class="toggle-switch" title="Multi-Model Review">
                    <input type="checkbox" id="enableMultiModel">
                    <span class="toggle-slider"></span>
                </label>
                <span style="opacity:0.7;">Review</span>
            </div>
            <button id="new-chat-btn" title="Start new conversation">+ New</button>
        </div>
        <div class="multi-model-row" style="padding: 0 15px 4px;">
            <div class="role-model-select" id="reviewer-select-container">
                <label for="reviewer-model-select">Reviewer:</label>
                <select id="reviewer-model-select"></select>
            </div>
            <div class="role-model-select" id="critic-select-container">
                <label for="critic-model-select">Critic:</label>
                <select id="critic-model-select"></select>
            </div>
        </div>
        <div class="strategy-row" id="strategy-row">
            <label for="agent-strategy-select">Agent:</label>
            <select id="agent-strategy-select">
                <option value="review">Review</option>
                <option value="red-team">Red-Team</option>
            </select>
            <label for="plan-strategy-select">Plan:</label>
            <select id="plan-strategy-select">
                <option value="debate">Debate</option>
                <option value="perspectives">Perspectives</option>
            </select>
        </div>
        <div id="mode-tabs">
            <button class="mode-tab active" data-mode="ask">💬 Ask</button>
            <button class="mode-tab" data-mode="plan">📋 Plan</button>
            <button class="mode-tab" data-mode="agent">🤖 Agent</button>
        </div>
        <div class="mode-description" id="mode-description">Ask questions about your code</div>
    </div>
    <div id="chat-container"></div>
    <div class="typing-indicator" id="typing-indicator">AI is thinking...</div>
    <div id="plan-panel">
        <div class="plan-header">
            <h4>📋 Implementation Plan</h4>
            <span id="agent-status" class="agent-status-badge">Idle</span>
        </div>
        <div id="plan-list"></div>
    </div>
    <div id="checkpoints-panel">
        <div class="checkpoints-header">
            <h4>💾 Checkpoints</h4>
            <button id="refresh-checkpoints" class="checkpoint-btn" title="Refresh checkpoints">🔄</button>
        </div>
        <div id="checkpoints-list"></div>
    </div>
    <div id="operations-panel">
        <h4>⚡ Pending File Operations</h4>
        <div id="operations-list"></div>
        <div id="operations-buttons">
            <button id="apply-btn">✓ Apply Changes</button>
            <button id="reject-btn">✗ Reject</button>
        </div>
    </div>
    <div id="review-results-panel">
        <h4>🔍 Review Results <span class="convergence-badge" id="review-convergence-badge"></span></h4>
        <div id="review-rounds-list"></div>
        <div class="synthesis-block" id="review-synthesis" style="display:none;"></div>
        <div class="result-actions">
            <button class="btn-primary" id="apply-fix-btn">Apply Fix</button>
            <button class="btn-secondary" id="skip-review-btn">Skip & Continue</button>
        </div>
    </div>
    <div id="debate-results-panel">
        <h4>💬 Debate Results <span class="convergence-badge" id="debate-convergence-badge"></span></h4>
        <div id="debate-rounds-list"></div>
        <div class="synthesis-block" id="debate-synthesis" style="display:none;"></div>
        <div class="result-actions">
            <button class="btn-primary" id="revise-plan-btn">Revise Plan</button>
            <button class="btn-secondary" id="accept-plan-btn">Accept as-is</button>
        </div>
    </div>
    <div id="token-usage-bar">
        <span class="token-label">Tokens:</span>
        <span id="token-display">0</span>
        <span class="token-detail" id="token-detail">(Prompt: 0 | Completion: 0)</span>
    </div>
    <div id="input-container">
        <div id="autocomplete"></div>
        <div id="drop-zone" class="drop-zone">
            <div id="attached-files"></div>
            <div id="input-wrapper">
                <textarea id="message-input" placeholder="Ask about your code... Type @ to attach files" rows="1"></textarea>
                <button id="send-btn">Send</button>
                <button id="stop-btn">Stop</button>
            </div>
            <div class="drop-overlay">📁 Drop files here</div>
        </div>
        <div class="hint">💡 Type <strong>/</strong> for commands, <strong>@</strong> to attach files</div>
    </div>

                                                                                                                                                                                                <script>

            (function () {
            // Prevent duplicate initialization
            if (window._tokamakInitialized) {
            return;
            }
            window._tokamakInitialized = true;

            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const messageInput = document.getElementById('message-input');
            const sendBtn = document.getElementById('send-btn');
            const stopBtn = document.getElementById('stop-btn');
            const typingIndicator = document.getElementById('typing-indicator');
            const modelSelect = document.getElementById('model-select');
            const autocomplete = document.getElementById('autocomplete');
            const attachedFilesContainer = document.getElementById('attached-files');
            const modeTabs = document.querySelectorAll('.mode-tab');
            const modeDescription = document.getElementById('mode-description');
            const operationsPanel = document.getElementById('operations-panel');
            const operationsList = document.getElementById('operations-list');
            const applyBtn = document.getElementById('apply-btn');
            const rejectBtn = document.getElementById('reject-btn');
            const newChatBtn = document.getElementById('new-chat-btn');
            const historyBtn = document.getElementById('history-btn');
            const historyPanel = document.getElementById('history-panel');
            const historyList = document.getElementById('history-list');
            const historyOverlay = document.getElementById('history-overlay');
            const closeHistoryBtn = document.getElementById('close-history');
            const historySearchInput = document.getElementById('history-search-input');
            const planPanel = document.getElementById('plan-panel');
            const planList = document.getElementById('plan-list');
            const agentStatusBadge = document.getElementById('agent-status');
            const tokenDisplay = document.getElementById('token-display');
            const tokenDetail = document.getElementById('token-detail');
            const checkpointsPanel = document.getElementById('checkpoints-panel');
            const checkpointsList = document.getElementById('checkpoints-list');
            const refreshCheckpointsBtn = document.getElementById('refresh-checkpoints');
            const enableMultiModelCheckbox = document.getElementById('enableMultiModel');
            const reviewerSelectContainer = document.getElementById('reviewer-select-container');
            const criticSelectContainer = document.getElementById('critic-select-container');
            const reviewerModelSelect = document.getElementById('reviewer-model-select');
            const criticModelSelect = document.getElementById('critic-model-select');
            const strategyRow = document.getElementById('strategy-row');
            const agentStrategySelect = document.getElementById('agent-strategy-select');
            const planStrategySelect = document.getElementById('plan-strategy-select');
            const reviewResultsPanel = document.getElementById('review-results-panel');
            const reviewRoundsList = document.getElementById('review-rounds-list');
            const reviewSynthesisBlock = document.getElementById('review-synthesis');
            const reviewConvergenceBadge = document.getElementById('review-convergence-badge');
            const applyFixBtn = document.getElementById('apply-fix-btn');
            const skipReviewBtn = document.getElementById('skip-review-btn');
            const debateResultsPanel = document.getElementById('debate-results-panel');
            const debateRoundsList = document.getElementById('debate-rounds-list');
            const debateSynthesisBlock = document.getElementById('debate-synthesis');
            const debateConvergenceBadge = document.getElementById('debate-convergence-badge');
            const revisePlanBtn = document.getElementById('revise-plan-btn');
            const acceptPlanBtn = document.getElementById('accept-plan-btn');
            let multiModelEnabled = false;

            let currentStreamingMessage = null;
            let streamingContent = '';
            let typingInterval = null;
            let attachedFiles = [];
            let autocompleteFiles = [];
            let autocompleteCommands = [];
            let autocompleteType = 'file'; // 'file' or 'command'
            let selectedAutocompleteIndex = 0;
            let mentionStartIndex = -1;
            let slashStartIndex = -1;
            let currentMode = 'ask';
            let sessionTotalTokens = 0;
            let sessionPromptTokens = 0;
            let sessionCompletionTokens = 0;
            let attachedImages = []; // Array of base64 strings

            function addImageTag(base64Data) {
            const tag = document.createElement('div');
            tag.className = 'image-tag';
            tag.innerHTML = '<img src="' + base64Data + '"><span class="remove-img">×</span>';

            tag.querySelector('.remove-img').onclick = () => {
            const index = attachedImages.indexOf(base64Data);
            if (index > -1) {
            attachedImages.splice(index, 1);
            }
            tag.remove();
            };

            attachedFilesContainer.appendChild(tag);
            attachedImages.push(base64Data);
            }

            const modeDescriptions = {
            ask: 'Ask questions about your code',
            plan: 'Plan your implementation without code changes',
            agent: 'AI will create, edit, and delete files for you'
            };

            const modePlaceholders = {
            ask: 'Ask about your code... Type @ to attach files',
            plan: 'Describe what you want to build...',
            agent: 'Tell me what to implement...'
            };

            vscode.postMessage({ command: 'ready' });

            function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
            }

            function parseMarkdown(text) {
            let result = escapeHtml(text);
            // Hide file operation blocks in display
            result = result.replace(/&lt;&lt;&lt;FILE_OPERATION&gt;&gt;&gt;[\\s\\S]*?&lt;&lt;&lt;END_OPERATION&gt;&gt;&gt;/g, '');
            result = result.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
            const escapedCode = code.trim();
            const langLabel = lang || 'code';
            const isShell = ['bash', 'shell', 'sh', 'zsh', 'powershell', 'cmd', 'python', 'python3'].includes(lang.toLowerCase());
            const runBtn = isShell ?\`<button class="run-btn" onclick="runCommand(this)">▶ Run</button>\` : '';
            // Insert 버튼 제거: Agent 모드에서는 FILE_OPERATION으로 처리되고, 일반 채팅에서도 불필요
            return \`<div class="code-header"><span>\${langLabel}</span><div>\${runBtn}</div></div><pre><code class="language-\${lang}">\${escapedCode}</code></pre>\`;
            });
            result = result.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
            result = result.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            result = result.replace(/\\n/g, '<br>');
            return result;
            }

            function addMessage(role, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + role;

            const roleDiv = document.createElement('div');
            roleDiv.className = 'message-role';
            roleDiv.textContent = role === 'user' ? 'You' : 'Tokamak AI';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            let textContent = '';
            let images = [];

            if (typeof content === 'string') {
            textContent = content;
            } else if (Array.isArray(content)) {
            content.forEach(item => {
            if (item.type === 'text') {
            textContent += item.text;
            } else if (item.type === 'image_url') {
            images.push(item.image_url.url);
            }
            });
            }

            contentDiv.innerHTML = parseMarkdown(textContent);

            if (images.length > 0) {
            const imagesDiv = document.createElement('div');
            imagesDiv.className = 'message-images';
            imagesDiv.style.display = 'flex';
            imagesDiv.style.flexWrap = 'wrap';
            imagesDiv.style.gap = '8px';
            imagesDiv.style.marginTop = '8px';

            images.forEach(src => {
            const img = document.createElement('img');
            img.src = src;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '200px';
            img.style.borderRadius = '4px';
            img.style.cursor = 'pointer';
            img.onclick = () => window.open(src);
            imagesDiv.appendChild(img);
            });
            contentDiv.appendChild(imagesDiv);
            }

            messageDiv.appendChild(roleDiv);
            messageDiv.appendChild(contentDiv);
            chatContainer.appendChild(messageDiv);
            chatContainer.scrollTop = chatContainer.scrollHeight;

            return messageDiv;
            }

            function startStreaming() {
            // Ensure no lingering streaming state
            streamingContent = '';

            // Create new message container
            currentStreamingMessage = document.createElement('div');
            currentStreamingMessage.className = 'message assistant';

            const roleDiv = document.createElement('div');
            roleDiv.className = 'message-role';
            roleDiv.textContent = 'Tokamak AI';

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            currentStreamingMessage.appendChild(roleDiv);
            currentStreamingMessage.appendChild(contentDiv);
            chatContainer.appendChild(currentStreamingMessage);

            typingIndicator.classList.add('visible');

            // Start animation
            let dots = 0;
            typingIndicator.textContent = 'AI is thinking';
            if (typingInterval) clearInterval(typingInterval);
            typingInterval = setInterval(() => {
            dots = (dots + 1) % 4;
            typingIndicator.textContent = 'AI is thinking' + '.'.repeat(dots);
            }, 500);

            sendBtn.style.display = 'none';
            stopBtn.classList.add('visible');
            chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function handleStreamChunk(chunk) {
            if (!currentStreamingMessage) return;

            streamingContent += chunk;
            const contentDiv = currentStreamingMessage.querySelector('.message-content');

            // Re-render markdown only when necessary (e.g., block finished) or use a simpler update for speed
            // For now, full re-render is safer for markdown but let's ensure we are targeting the correct element
            contentDiv.innerHTML = parseMarkdown(streamingContent);

            // Auto-scroll
            chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            function endStreaming() {
            if (typingInterval) {
            clearInterval(typingInterval);
            typingInterval = null;
            }
            typingIndicator.textContent = 'AI is thinking...';

            currentStreamingMessage = null;
            typingIndicator.classList.remove('visible');
            sendBtn.disabled = false;
            sendBtn.style.display = 'block';
            stopBtn.classList.remove('visible');
            }

            // insertCode 함수 제거됨 - Insert 버튼이 더 이상 표시되지 않음

            function runCommand(btn) {
            const pre = btn.closest('.code-header').nextElementSibling;
            const command = pre.querySelector('code').textContent;
            vscode.postMessage({ command: 'runCommand', commandText: command });
            }

            function addFileTag(filePath, isDir = false) {
            if (attachedFiles.some(f => f.path === filePath)) return;

            attachedFiles.push({ path: filePath, isDir });
            const fileName = filePath.split('/').pop();

            const tag = document.createElement('span');
            tag.className = 'file-tag';
            tag.innerHTML = \`
            <span class="icon">\${isDir ? '📁' : '📄'}</span>
            <span class="file-name" data-path="\${filePath}">\${fileName}</span>
            <span class="remove-btn" data-path="\${filePath}">×</span>
            \`;

            tag.querySelector('.file-name').addEventListener('click', () => {
            vscode.postMessage({ command: 'openFile', path: filePath });
            });

            tag.querySelector('.remove-btn').addEventListener('click', () => {
            attachedFiles = attachedFiles.filter(f => f.path !== filePath);
            tag.remove();
            });

            attachedFilesContainer.appendChild(tag);
            }

            function showAutocomplete(files) {
            autocompleteFiles = files;
            autocompleteType = 'file';
            selectedAutocompleteIndex = 0;

            if (files.length === 0) {
            autocomplete.classList.remove('visible');
            return;
            }

            autocomplete.innerHTML = files.map((file, index) => \`
            <div class="autocomplete-item \${index === 0 ? 'selected' : ''}" data-index="\${index}" data-path="\${file.path}" data-isdir="\${file.isDir}">
            <span class="icon">\${file.isDir ? '📁' : '📄'}</span>
            <span class="name">\${file.name}</span>
            <span class="path">\${file.path}</span>
            </div>
            \`).join('');

            autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
            selectAutocompleteItem(parseInt(item.dataset.index));
            });
            });

            autocomplete.classList.add('visible');
            }

            function showSlashAutocomplete(commands) {
            autocompleteCommands = commands;
            autocompleteType = 'command';
            selectedAutocompleteIndex = 0;

            if (commands.length === 0) {
            autocomplete.classList.remove('visible');
            return;
            }

            autocomplete.innerHTML = commands.map((cmd, index) => \`
            <div class="autocomplete-item slash-cmd \${index === 0 ? 'selected' : ''}" data-index="\${index}" data-name="\${cmd.name}">
            <span class="icon">⚡</span>
            <span class="name">\${cmd.name}</span>
            <span class="desc">\${cmd.description}</span>
            </div>
            \`).join('');

            autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
            selectAutocompleteItem(parseInt(item.dataset.index));
            });
            });

            autocomplete.classList.add('visible');
            }

            function hideAutocomplete() {
            autocomplete.classList.remove('visible');
            mentionStartIndex = -1;
            slashStartIndex = -1;
            }

            function selectAutocompleteItem(index) {
            if (autocompleteType === 'file') {
            const file = autocompleteFiles[index];
            if (!file) return;

            const value = messageInput.value;
            const beforeMention = value.substring(0, mentionStartIndex);
            const afterCursor = value.substring(messageInput.selectionStart);
            messageInput.value = beforeMention + afterCursor;

            addFileTag(file.path, file.isDir);
            } else if (autocompleteType === 'command') {
            const cmd = autocompleteCommands[index];
            if (!cmd) return;

            const value = messageInput.value;
            const beforeSlash = value.substring(0, slashStartIndex);
            const afterCursor = value.substring(messageInput.selectionStart);
            messageInput.value = beforeSlash + cmd.name + ' ' + afterCursor.trimStart();
            messageInput.selectionStart = messageInput.selectionEnd = beforeSlash.length + cmd.name.length + 1;
            }

            hideAutocomplete();
            messageInput.focus();
            }

            function updateAutocompleteSelection(delta) {
            const items = autocomplete.querySelectorAll('.autocomplete-item');
            if (items.length === 0) return;

            items[selectedAutocompleteIndex].classList.remove('selected');
            selectedAutocompleteIndex = (selectedAutocompleteIndex + delta + items.length) % items.length;
            items[selectedAutocompleteIndex].classList.add('selected');
            items[selectedAutocompleteIndex].scrollIntoView({ block: 'nearest' });
            }

            let isSending = false;
            let isComposing = false; // IME 입력 중인지 추적
            
            function sendMessage() {
            if (isSending) return;

            const text = messageInput.value.trim();
            if (!text && attachedFiles.length === 0 && attachedImages.length === 0) return;

            isSending = true;
            sendBtn.disabled = true;

            vscode.postMessage({
            command: 'sendMessage',
            text: text,
            attachedFiles: attachedFiles.map(f => f.path),
            attachedImages: attachedImages
            });

            // 입력 필드를 비우고 IME 상태 리셋
            messageInput.value = '';
            messageInput.blur(); // IME 상태 리셋
            setTimeout(() => {
                messageInput.focus(); // 다시 포커스
            }, 10);
            
            messageInput.style.height = 'auto';
            attachedFiles = [];
            attachedImages = [];
            attachedFilesContainer.innerHTML = '';
            hideAutocomplete();

            // Reset flag after a short delay
            setTimeout(() => { 
            isSending = false;
            sendBtn.disabled = false;
            }, 100);
            }

            function updateModels(models, selected, enableMultiModel, reviewerModel, criticModel) {
            modelSelect.innerHTML = '';
            models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === selected) {
            option.selected = true;
            }
            modelSelect.appendChild(option);
            });

            // Update role model dropdowns
            [reviewerModelSelect, criticModelSelect].forEach(sel => {
            sel.innerHTML = '<option value="">(Same as main model)</option>';
            models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            sel.appendChild(option);
            });
            });
            if (reviewerModel) reviewerModelSelect.value = reviewerModel;
            if (criticModel) criticModelSelect.value = criticModel;

            // Update toggle state
            if (enableMultiModel !== undefined) {
            multiModelEnabled = enableMultiModel;
            enableMultiModelCheckbox.checked = enableMultiModel;
            updateRoleModelVisibility();
            }
            }

            function showOperations(operations) {
            operationsList.innerHTML = operations.map((op, index) => 
            '<div class="operation-item">' +
            '<span class="op-type ' + op.type + '">' + op.type.toUpperCase() + '</span>' +
            '<span class="op-path">' + op.path + '</span>' +
            '<button class="preview-btn" data-index="' + index + '">Preview</button>' +
            '<button class="reject-item-btn" data-index="' + index + '" title="Reject this change">×</button>' +
            '</div>'
            ).join('');

            // Add preview button handlers
            operationsList.querySelectorAll('.preview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            vscode.postMessage({ command: 'previewOperation', index: index });
            });
            });

            // Add individual reject button handlers
            operationsList.querySelectorAll('.reject-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
            const index = parseInt(btn.dataset.index);
            vscode.postMessage({ command: 'rejectOperation', index: index });
            });
            });

            operationsPanel.classList.add('visible');
            }

            function hideOperations() {
            operationsPanel.classList.remove('visible');
            operationsList.innerHTML = '';
            }

            // History Panel Handlers
            historyBtn.addEventListener('click', () => {
            historyPanel.classList.add('visible');
            historyOverlay.classList.add('visible');
            vscode.postMessage({ command: 'getSessions' });
            });

            const closeHistory = () => {
            historyPanel.classList.remove('visible');
            historyOverlay.classList.remove('visible');
            if (historySearchInput) {
            historySearchInput.value = '';
            }
            };

            closeHistoryBtn.addEventListener('click', closeHistory);
            historyOverlay.addEventListener('click', closeHistory);

            if (historySearchInput) {
            historySearchInput.addEventListener('input', () => {
            filterSessions();
            });
            }

            let allSessions = [];
            let currentSessionId = null;

            function renderSessions(sessions, currentId) {
            allSessions = sessions;
            currentSessionId = currentId;
            filterSessions();
            }

            function filterSessions() {
            const searchInput = document.getElementById('history-search-input');
            const query = searchInput ? searchInput.value.toLowerCase().trim() : '';
            
            const filtered = query ? allSessions.filter(s => {
            const title = (s.title || 'New Conversation').toLowerCase();
            const date = new Date(s.timestamp).toLocaleString().toLowerCase();
            return title.includes(query) || date.includes(query);
            }) : allSessions;

            historyList.innerHTML = filtered.map(s => {
            const date = new Date(s.timestamp).toLocaleString();
            const activeClass = s.id === currentSessionId ? 'active' : '';
            const title = s.title || 'New Conversation';
            const mode = s.mode || 'ask';
            const modeLabel = mode === 'ask' ? 'ASK' : mode === 'plan' ? 'PLAN' : 'AGENT';
            return '<div class="session-item ' + activeClass + '" data-id="' + s.id + '">' +
            '<div class="session-title">' + escapeHtml(title) + '</div>' +
            '<div class="session-date">' + escapeHtml(date) + '</div>' +
            '<span class="session-mode ' + mode + '">' + modeLabel + '</span>' +
            '<div class="session-actions">' +
            '<span class="export-session" data-id="' + s.id + '" title="Export conversation">📥</span>' +
            '<span class="delete-session" data-id="' + s.id + '" title="Delete conversation">🗑️</span>' +
            '</div>' +
            '</div>';
            }).join('');

            historyList.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-session') || e.target.classList.contains('export-session')) {
            return; // Handled by separate click handlers
            } else {
            vscode.postMessage({ command: 'loadSession', sessionId: item.dataset.id });
            closeHistory();
            }
            });
            });

            historyList.querySelectorAll('.delete-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteSession', sessionId: btn.dataset.id });
            });
            });

            historyList.querySelectorAll('.export-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'exportSession', sessionId: btn.dataset.id });
            });
            });
            }

            // Mode tabs
            modeTabs.forEach(tab => {
            tab.addEventListener('click', () => {
            modeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMode = tab.dataset.mode;
            modeDescription.textContent = modeDescriptions[currentMode];
            messageInput.placeholder = modePlaceholders[currentMode];
            vscode.postMessage({ command: 'selectMode', mode: currentMode });
            
            // Agent 모드이고 checkpoint 기능이 활성화된 경우에만 체크포인트 로드 및 패널 표시
            // (설정은 서버에서 확인되므로 여기서는 일단 표시하지 않음, modeChanged 이벤트에서 처리됨)
            });
            });

            modelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectModel', model: modelSelect.value });
            });

            enableMultiModelCheckbox.addEventListener('change', () => {
            multiModelEnabled = enableMultiModelCheckbox.checked;
            vscode.postMessage({ command: 'toggleMultiModelReview', enabled: multiModelEnabled });
            updateRoleModelVisibility();
            });

            reviewerModelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectReviewerModel', model: reviewerModelSelect.value });
            });

            criticModelSelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectCriticModel', model: criticModelSelect.value });
            });

            agentStrategySelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectAgentStrategy', strategy: agentStrategySelect.value });
            });

            planStrategySelect.addEventListener('change', () => {
            vscode.postMessage({ command: 'selectPlanStrategy', strategy: planStrategySelect.value });
            });

            applyFixBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'reviewAction', decision: 'apply_fix' });
            reviewResultsPanel.classList.remove('visible');
            });

            skipReviewBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'reviewAction', decision: 'skip' });
            reviewResultsPanel.classList.remove('visible');
            });

            revisePlanBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'debateAction', decision: 'revise' });
            debateResultsPanel.classList.remove('visible');
            });

            acceptPlanBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'debateAction', decision: 'accept' });
            debateResultsPanel.classList.remove('visible');
            });

            function updateRoleModelVisibility() {
            if (multiModelEnabled && (currentMode === 'agent')) {
            reviewerSelectContainer.classList.add('visible');
            } else {
            reviewerSelectContainer.classList.remove('visible');
            }
            if (multiModelEnabled && (currentMode === 'plan')) {
            criticSelectContainer.classList.add('visible');
            } else {
            criticSelectContainer.classList.remove('visible');
            }
            // Show/hide strategy row when multi-model is enabled
            if (multiModelEnabled) {
            strategyRow.classList.add('visible');
            } else {
            strategyRow.classList.remove('visible');
            }
            }

            sendBtn.addEventListener('click', sendMessage);

            stopBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopGeneration' });
            });

            applyBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'applyOperations' });
            });

            rejectBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'rejectOperations' });
            });

            newChatBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'newChat' });
            });

            // IME 입력 시작/종료 추적
            messageInput.addEventListener('compositionstart', () => {
            isComposing = true;
            });
            
            messageInput.addEventListener('compositionend', () => {
            isComposing = false;
            });
            
            messageInput.addEventListener('keydown', (e) => {
            if (autocomplete.classList.contains('visible')) {
            if (e.key === 'ArrowDown') {
            e.preventDefault();
            updateAutocompleteSelection(1);
            return;
            }
            if (e.key === 'ArrowUp') {
            e.preventDefault();
            updateAutocompleteSelection(-1);
            return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            selectAutocompleteItem(selectedAutocompleteIndex);
            return;
            }
            if (e.key === 'Escape') {
            e.preventDefault();
            hideAutocomplete();
            return;
            }
            }

            // IME 입력 중이 아닐 때만 메시지 전송
            if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
            e.preventDefault();
            sendMessage();
            }
            });

            messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';

            const value = messageInput.value;
            const cursorPos = messageInput.selectionStart;
            const textBeforeCursor = value.substring(0, cursorPos);

            // Check for slash command at the start of input
            if (value.startsWith('/')) {
            const query = textBeforeCursor.substring(1);
            if (!/\\s/.test(query) || query.length === 0) {
            slashStartIndex = 0;
            vscode.postMessage({ command: 'searchSlashCommands', query: '/' + query });
            return;
            }
            }

            // Check for @ mention
            const atIndex = textBeforeCursor.lastIndexOf('@');
            if (atIndex !== -1 && (atIndex === 0 || /\\s/.test(value[atIndex - 1]))) {
            const query = textBeforeCursor.substring(atIndex + 1);
            if (!/\\s/.test(query)) {
            mentionStartIndex = atIndex;
            vscode.postMessage({ command: 'searchFiles', query: query });
            return;
            }
            }

            hideAutocomplete();
            });

            messageInput.addEventListener('paste', (e) => {
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
            addImageTag(event.target.result);
            };
            reader.readAsDataURL(blob);
            }
            }
            });

            window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
            case 'addMessage':
            addMessage(message.role, message.content);
            break;
            case 'startStreaming':
            startStreaming();
            break;
            case 'streamChunk':
            handleStreamChunk(message.content);
            break;
            case 'endStreaming':
            endStreaming();
            break;
            case 'clearMessages':
            chatContainer.innerHTML = '';
            hideOperations();
            // Reset token counters
            sessionTotalTokens = 0;
            sessionPromptTokens = 0;
            sessionCompletionTokens = 0;
            tokenDisplay.textContent = '0';
            tokenDetail.textContent = '(Prompt: 0 | Completion: 0)';
            break;
            case 'updateTokenUsage':
            sessionPromptTokens += message.usage.prompt;
            sessionCompletionTokens += message.usage.completion;
            sessionTotalTokens += message.usage.total;
            tokenDisplay.textContent = sessionTotalTokens.toLocaleString();
            tokenDetail.textContent = \`(Prompt: \${sessionPromptTokens.toLocaleString()} | Completion: \${sessionCompletionTokens.toLocaleString()})\`;
            break;
            case 'updateModels':
            updateModels(message.models, message.selected, message.enableMultiModelReview, message.reviewerModel, message.criticModel);
            break;
            case 'fileSearchResults':
            showAutocomplete(message.files);
            break;
            case 'modeChanged':
            currentMode = message.mode;
            modeTabs.forEach(t => {
            t.classList.toggle('active', t.dataset.mode === currentMode);
            });
            modeDescription.textContent = modeDescriptions[currentMode];
            messageInput.placeholder = modePlaceholders[currentMode];
            updateRoleModelVisibility();

            // Agent 모드이고 checkpoint 기능이 활성화된 경우에만 체크포인트 패널 표시 및 로드
            const checkpointsEnabled = message.checkpointsEnabled !== undefined ? message.checkpointsEnabled : false;
            if (currentMode === 'agent' && checkpointsEnabled) {
            checkpointsPanel.classList.add('visible');
            vscode.postMessage({ command: 'getCheckpoints' });
            } else {
            checkpointsPanel.classList.remove('visible');
            }
            break;
            case 'showOperations':
            showOperations(message.operations);
            break;
            case 'operationsCleared':
            hideOperations();
            break;
            case 'fileDropped':
            addFileTag(message.path, message.isDir);
            break;
            case 'receiveCode':
            // Add file as attachment and set code context in input
            if (message.filePath) {
            addFileTag(message.filePath);
            }
            const codeBlock = \`\\\`\\\`\\\`\${message.languageId}\\n\${message.code}\\n\\\`\\\`\\\`\`;
            messageInput.value = \`이 코드에 대해:\\n\${codeBlock}\\n\\n\`;
            messageInput.focus();
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
            break;
            case 'slashCommandResults':
            showSlashAutocomplete(message.commands);
            break;
            case 'sessionsList':
            renderSessions(message.sessions, message.currentSessionId);
            break;
            case 'updatePlan':
            updatePlanUI(message.plan);
            break;
            case 'agentStateChanged':
            updateAgentStatusUI(message.state);
            break;
            case 'checkpointCreated':
            // 체크포인트가 생성되면 목록 새로고침
            vscode.postMessage({ command: 'getCheckpoints' });
            break;
            case 'checkpointsList':
            updateCheckpointsUI(message.checkpoints);
            break;
            case 'generationStopped':
            endStreaming();
            break;
            case 'showReviewResults':
            renderRoundsList(message.rounds || [], reviewRoundsList);
            renderConvergenceBadge(reviewConvergenceBadge, message.convergence);
            reviewSynthesisBlock.style.display = 'none';
            reviewResultsPanel.classList.add('visible');
            break;
            case 'showDebateResults':
            renderRoundsList(message.rounds || [], debateRoundsList);
            renderConvergenceBadge(debateConvergenceBadge, message.convergence);
            debateSynthesisBlock.style.display = 'none';
            debateResultsPanel.classList.add('visible');
            break;
            case 'showSynthesis':
            // Determine which panel is active and show synthesis there
            if (reviewResultsPanel.classList.contains('visible')) {
                reviewSynthesisBlock.textContent = message.synthesis || '';
                reviewSynthesisBlock.style.display = 'block';
            } else if (debateResultsPanel.classList.contains('visible')) {
                debateSynthesisBlock.textContent = message.synthesis || '';
                debateSynthesisBlock.style.display = 'block';
            }
            break;
            }
            });

            function updateAgentStatusUI(state) {
            agentStatusBadge.textContent = state;
            // Color-code special states
            if (state === 'Reviewing') {
            agentStatusBadge.style.backgroundColor = '#7c3aed';
            agentStatusBadge.style.color = '#fff';
            } else if (state === 'Debating') {
            agentStatusBadge.style.backgroundColor = '#d97706';
            agentStatusBadge.style.color = '#fff';
            } else if (state === 'WaitingForReviewDecision' || state === 'WaitingForDebateDecision') {
            agentStatusBadge.textContent = 'Awaiting Decision';
            agentStatusBadge.style.backgroundColor = '#2563eb';
            agentStatusBadge.style.color = '#fff';
            } else if (state === 'Synthesizing') {
            agentStatusBadge.style.backgroundColor = '#0891b2';
            agentStatusBadge.style.color = '#fff';
            } else {
            agentStatusBadge.style.backgroundColor = '';
            agentStatusBadge.style.color = '';
            }
            // Plan Panel은 Plan 모드일 때만 표시 (Agent 모드에서 자동 Plan 생성 방지)
            if (currentMode === 'plan' && state !== 'Idle' && state !== 'Done' && state !== 'Error') {
            planPanel.classList.add('visible');
            } else if (currentMode !== 'plan') {
            planPanel.classList.remove('visible');
            }
            }

            function renderRoundsList(rounds, container) {
            container.innerHTML = '';
            rounds.forEach(function(r) {
                const item = document.createElement('div');
                item.className = 'round-item';
                const header = document.createElement('div');
                header.className = 'round-header';
                header.textContent = 'Round ' + r.round + ' — ' + r.role;
                const content = document.createElement('div');
                content.className = 'round-content';
                // Truncate long content for display
                const displayContent = r.content.length > 500 ? r.content.substring(0, 500) + '...' : r.content;
                content.textContent = displayContent;
                item.appendChild(header);
                item.appendChild(content);
                container.appendChild(item);
            });
            }

            function renderConvergenceBadge(badge, convergence) {
            if (!convergence) {
                badge.textContent = '';
                badge.className = 'convergence-badge';
                return;
            }
            badge.textContent = 'Convergence: ' + convergence.overallScore.toFixed(2) + ' (' + convergence.recommendation + ')';
            badge.className = 'convergence-badge ' + convergence.recommendation;
            }

            function updateCheckpointsUI(checkpoints) {
            // Agent 모드이고 checkpoint가 활성화된 경우에만 checkpoints가 없어도 패널 표시
            if (!checkpoints || checkpoints.length === 0) {
            checkpointsList.innerHTML = '<div style="opacity:0.6; font-size:0.85em; padding:8px;">No checkpoints yet. Checkpoints will be created automatically before each step execution.</div>';
            // 패널 표시는 modeChanged 이벤트에서 처리됨
            return;
            }

            checkpointsPanel.classList.add('visible');
            checkpointsList.innerHTML = checkpoints.map(cp => {
            const date = new Date(cp.timestamp).toLocaleString();
            const desc = cp.stepDescription || 'Checkpoint';
            return '<div class="checkpoint-item" data-id="' + cp.id + '">' +
            '<div class="checkpoint-info">' +
            '<div class="checkpoint-description">' + escapeHtml(desc) + '</div>' +
            '<div class="checkpoint-meta">' + date + ' • ' + cp.fileCount + ' files</div>' +
            '</div>' +
            '<div class="checkpoint-actions">' +
            '<button class="checkpoint-btn compare" data-id="' + cp.id + '" title="Compare with current">Compare</button>' +
            '<button class="checkpoint-btn restore" data-id="' + cp.id + '" title="Restore workspace">Restore</button>' +
            '<button class="checkpoint-btn delete" data-id="' + cp.id + '" title="Delete checkpoint">×</button>' +
            '</div>' +
            '</div>';
            }).join('');

            // 이벤트 리스너 추가
            checkpointsList.querySelectorAll('.checkpoint-btn.compare').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'compareCheckpoint', checkpointId: btn.dataset.id });
            });
            });

            checkpointsList.querySelectorAll('.checkpoint-btn.restore').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'restoreCheckpoint', checkpointId: btn.dataset.id, restoreWorkspaceOnly: false });
            });
            });

            checkpointsList.querySelectorAll('.checkpoint-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
            e.stopPropagation();
            vscode.postMessage({ command: 'deleteCheckpoint', checkpointId: btn.dataset.id });
            });
            });
            }

            if (refreshCheckpointsBtn) {
            refreshCheckpointsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'getCheckpoints' });
            });
            }

            // Agent 모드이고 checkpoint가 활성화된 경우에만 체크포인트 목록 로드
            // (설정은 서버에서 확인되므로 여기서는 로드하지 않음, modeChanged 이벤트에서 처리됨)

            function updatePlanUI(plan) {
            if (!plan || plan.length === 0) {
            planPanel.classList.remove('visible');
            return;
            }

            // Plan Panel은 Plan 모드일 때만 표시
            if (currentMode === 'plan') {
            planPanel.classList.add('visible');
            } else {
            planPanel.classList.remove('visible');
            return;
            }
            planList.innerHTML = '';

            plan.forEach(step => {
            const item = document.createElement('div');
            item.className = 'plan-item ' + step.status;

            let icon = '○';
            if (step.status === 'running') icon = '⚡';
            if (step.status === 'done') icon = '✓';
            if (step.status === 'failed') icon = '✗';

            item.innerHTML = \`
            <span class="step-icon">\${icon}</span>
            <span class="step-desc">\${escapeHtml(step.description)}</span>
            \`;
            planList.appendChild(item);
            });
            }

            // Drag and drop handling
            const dropZone = document.getElementById('drop-zone');

            dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
            });

            dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
            });

            dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');

            // Try different data formats
            const uriList = e.dataTransfer.getData('text/uri-list');
            const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');

            // Handle VS Code Explorer drops (uri-list format)
            if (uriList) {
            const uris = uriList.split(/[\\r\\n]+/).filter(u => u && !u.startsWith('#'));
            uris.forEach(uri => {
            vscode.postMessage({ command: 'resolveFilePath', uri: uri.trim() });
            });
            }
            // Handle text/plain drops
            else if (text) {
            const lines = text.split(/[\\r\\n]+/);
            lines.forEach(line => {
            line = line.trim();
            if (line) {
            vscode.postMessage({ command: 'resolveFilePath', uri: line });
            }
            });
            }

            // Handle dropped files from system
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => {
            if (file.path) {
            vscode.postMessage({ command: 'resolveFilePath', uri: file.path });
            }
            });
            }
            });

            // Also allow dropping on the whole chat container
            document.body.addEventListener('dragover', (e) => {
            e.preventDefault();
            });

            document.body.addEventListener('drop', (e) => {
            e.preventDefault();
            });

            window.runCommand = runCommand;
            }) ();

        </script>
    </body>
    </html>`;
}
