const fs = require('fs');
const filePath = __dirname + '/../src/extension.js';
let c = fs.readFileSync(filePath, 'utf8');

// Import new modules
c = c.replace(
  "const { ChatController, OpenClaudeChatViewProvider, OpenClaudeChatPanelManager } = require('./chat/chatProvider');",
  "const { ChatController, OpenClaudeChatViewProvider, OpenClaudeChatPanelManager } = require('./chat/chatProvider');\nconst { ModelValidator } = require('./chat/modelValidator');\nconst { ModelVettingStore } = require('./chat/modelVettingStore');"
);

// Register new commands - add after abortChat command registration
const oldAbortCmd = "const abortChatCommand = vscode.commands.registerCommand('openclaude.abortChat', () => {\n    const c = chatRegistry.get(chatRegistry.activeId);\n    if (c) c.abort();\n  });";

const newCmds = oldAbortCmd + `

  const validateModelsCommand = vscode.commands.registerCommand('openclaude.validateModels', async () => {
    const mode = await vscode.window.showQuickPick([
      { label: 'Free Check', description: 'URL inspection only - no token cost', detail: 'GET /models endpoint' },
      { label: 'Paid Ping', description: 'Send test prompt - uses 1-10 tokens per model', detail: 'POST /chat/completions with \"which model are you?\"' },
    ], { placeHolder: 'Choose validation mode' });
    if (!mode) return;

    const catalog = require('./chat/chatProvider').loadProviderCatalog
      ? (() => { try { return require('./chat/chatProvider').loadProviderCatalog(); } catch { return []; } })()
      : [];
    if (catalog.length === 0) {
      // Fallback: load directly
      try { catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'chat', 'providerCatalog.json'), 'utf8')); } catch {}
    }

    // Show warning for paid mode
    if (mode.label === 'Paid Ping') {
      const proceed = await vscode.window.showWarningMessage(
        'Paid validation sends a test prompt to each model, consuming ~1-10 tokens per model. This may incur API costs.',
        { modal: true },
        'Proceed',
        'Cancel'
      );
      if (proceed !== 'Proceed') return;
    }

    const validator = new ModelValidator(catalog);
    const validationMode = mode.label === 'Paid Ping' ? 'paid' : 'free';

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Validating models (${validationMode})...`,
      cancellable: true,
    }, async (progress, token) => {
      const results = await validator.validateAll({
        mode: validationMode,
        onProgress: (done, total) => {
          progress.report({ message: `${done}/${total} models checked`, increment: 100 / total });
        },
      });

      const vetStore = new ModelVettingStore(context);
      vetStore.storeValidationResults(results);

      const verified = results.filter(r => r.status === 'verified').length;
      const broken = results.filter(r => r.status === 'broken').length;
      await vscode.window.showInformationMessage(
        `Validation complete: ${verified} verified, ${broken} broken, ${results.length - verified - broken} unknown`
      );
    });
  });

  const exportModelsCommand = vscode.commands.registerCommand('openclaude.exportModels', async () => {
    const scope = await vscode.window.showQuickPick([
      { label: 'All Models', description: 'Export the full catalog' },
      { label: 'Vetted Only', description: 'Only verified working models' },
      { label: 'Disabled Only', description: 'Only disabled models' },
    ], { placeHolder: 'Choose export scope' });
    if (!scope) return;

    const includeKeys = await vscode.window.showQuickPick([
      { label: 'Without API Keys', description: 'Safe to share' },
      { label: 'With API Key Hints', description: 'Shows first/last 4 chars only' },
    ], { placeHolder: 'Include API keys?' });
    if (!includeKeys) return;

    const catalog = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'chat', 'providerCatalog.json'), 'utf8')); }
      catch { return []; }
    })();
    const vetStore = new ModelVettingStore(context);
    const exportData = vetStore.exportConfig({
      catalog,
      scope: scope.label === 'Vetted Only' ? 'vetted' : (scope.label === 'Disabled Only' ? 'disabled' : 'all'),
      includeApiKeys: includeKeys.label !== 'Without API Keys',
    });

    // Save to workspace or prompt for location
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const exportPath = path.join(folders[0].uri.fsPath, '.openclaude-model-export.json');
      fs.writeFileSync(exportPath, exportData);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(exportPath));
      await vscode.window.showTextDocument(doc);
    } else {
      const doc = await vscode.workspace.openTextDocument({ content: exportData, language: 'json' });
      await vscode.window.showTextDocument(doc);
    }
  });

  const resetThinkingCommand = vscode.commands.registerCommand('openclaude.resetThinking', () => {
    const c = chatRegistry.get(chatRegistry.activeId);
    if (c && typeof c.forceReset === 'function') {
      c.forceReset();
      vscode.window.showInformationMessage('Thinking reset - chat is ready for new input.');
    } else {
      vscode.window.showWarningMessage('No active chat to reset.');
    }
  });

  const openModelVettingCommand = vscode.commands.registerCommand('openclaude.openModelVetting', async () => {
    const vetStore = new ModelVettingStore(context);
    const catalog = (() => {
      try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'chat', 'providerCatalog.json'), 'utf8')); }
      catch { return []; }
    })();

    const vetted = vetStore.getVettedModels();
    const broken = vetStore.getBrokenModels();
    const disabled = vetStore.getDisabledModels();
    const lastValidation = vetStore.getLastValidationTime();

    const lines = [
      '# Model Vetting Status',
      `Last validation: ${lastValidation || 'Never'}`,
      '',
      `## Verified (${vetted.length})`,
      ...vetted.map(m => `- ✅ ${m}`),
      '',
      `## Broken (${broken.length})`,
      ...broken.map(m => `- ❌ ${m}`),
      '',
      `## Disabled (${disabled.length})`,
      ...disabled.map(m => `- ⛔ ${m}`),
      '',
      '## Commands',
      '- Run "OpenClaude: Validate Models" to re-validate',
      '- Run "OpenClaude: Export Model Config" to export',
      '- Use model picker in chat to manage per-model settings',
    ];

    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc);
  });`;

c = c.replace(oldAbortCmd, newCmds);

// Push new commands to context.subscriptions (add after existing commands)
c = c.replace(
  "abortChatCommand,\n    chatViewProviderReg,",
  "abortChatCommand,\n    validateModelsCommand,\n    exportModelsCommand,\n    resetThinkingCommand,\n    openModelVettingCommand,\n    chatViewProviderReg,"
);

fs.writeFileSync(filePath, c);
console.log('extension.js patched successfully with 4 new commands');
