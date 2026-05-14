const fs = require('fs');
const filePath = __dirname + '/../package.json';
let pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Add new commands
const newCommands = [
  { command: 'openclaude.validateModels', title: 'Validate Models', category: 'OpenClaude' },
  { command: 'openclaude.exportModels', title: 'Export Model Config', category: 'OpenClaude' },
  { command: 'openclaude.resetThinking', title: 'Reset Thinking', category: 'OpenClaude' },
  { command: 'openclaude.openModelVetting', title: 'Open Model Vetting', category: 'OpenClaude' },
];

if (!pkg.contributes) pkg.contributes = {};
if (!pkg.contributes.commands) pkg.contributes.commands = [];

const existingCmds = new Set(pkg.contributes.commands.map(c => c.command));
for (const cmd of newCommands) {
  if (!existingCmds.has(cmd.command)) {
    pkg.contributes.commands.push(cmd);
  }
}

// Add new configuration settings
if (!pkg.contributes.configuration) pkg.contributes.configuration = { properties: {} };
const props = pkg.contributes.configuration.properties;

props['openclaude.thinkingTimeoutMs'] = {
  type: 'number',
  default: 120000,
  description: 'Maximum time (ms) before thinking is considered stuck (default 2 min)',
};
props['openclaude.autoValidateModels'] = {
  type: 'boolean',
  default: false,
  description: 'Automatically validate all models on startup (free check)',
};
props['openclaude.modelVettingData'] = {
  type: 'object',
  default: {},
  description: 'Model vetting data (vetted, broken, disabled lists). Managed via the model picker UI.',
};

// Update version to 0.5.0
pkg.version = '0.5.0';

fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
console.log('package.json updated with new commands, settings, version 0.5.0');
