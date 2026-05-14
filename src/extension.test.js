const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('bun:test');

function createStatus(overrides = {}) {
  return {
    installed: true,
    executable: 'openclaude',
    launchCommand: 'openclaude --project-aware',
    terminalName: 'OpenClaude',
    shimEnabled: false,
    workspaceFolder: '/workspace/openclaude/very/long/path/example-project',
    workspaceSourceLabel: 'active editor workspace',
    launchCwd: '/workspace/openclaude/very/long/path/example-project',
    launchCwdLabel: '/workspace/openclaude/very/long/path/example-project',
    canLaunchInWorkspaceRoot: true,
    profileStatusLabel: 'Found',
    profileStatusHint: '/workspace/openclaude/very/long/path/example-project/.openclaude-profile.json',
    workspaceProfilePath: '/workspace/openclaude/very/long/path/example-project/.openclaude-profile.json',
    providerState: {
      label: 'Codex',
      detail: 'gpt-5.4',
      source: 'profile',
    },
    providerSourceLabel: 'saved profile',
    ...overrides,
  };
}

function loadExtension() {
  const extensionPath = require.resolve('./extension');
  delete require.cache[extensionPath];
  mock.module('vscode', () => ({
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({
        get: (_key, fallback) => fallback,
      }),
      getWorkspaceFolder: () => null,
    },
    window: {
      activeTextEditor: null,
      createWebviewPanel: () => ({}),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    env: {
      openExternal: async () => true,
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async () => undefined,
    },
    Uri: { parse: value => value, file: value => value },
    ViewColumn: { Active: 1 },
  }));
  return require('./extension');
}

test('renderControlCenterHtml uses the OpenClaude wordmark, status rail, and warm action hierarchy', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(createStatus(), { nonce: 'test-nonce', platform: 'win32' });

  assert.match(html, /Open<span class="wordmark-accent">Claude<\/span>/);
  assert.match(html, /class="status-rail"/);
  assert.match(html, /\.sunset-gradient\s*\{/);
  assert.match(html, /class="action-button primary" id="launch"/);
  assert.match(html, /class="action-button secondary" id="launchRoot"/);
  assert.match(
    html,
    /title="\/workspace\/openclaude\/very\/long\/path\/example-project"[^>]*>\/workspace\/openclaude\/very\/long\/path\/example-project<\//,
  );
});

test('renderControlCenterHtml shows explicit disabled and empty states when workspace data is missing', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      workspaceFolder: null,
      workspaceSourceLabel: 'no workspace open',
      launchCwd: null,
      launchCwdLabel: 'VS Code default terminal cwd',
      canLaunchInWorkspaceRoot: false,
      profileStatusLabel: 'No workspace',
      profileStatusHint: 'Open a workspace folder to detect a saved profile',
      workspaceProfilePath: null,
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(
    html,
    /class="action-button secondary" id="launchRoot"[^>]*disabled[^>]*>[\s\S]*Open a workspace folder to enable workspace-root launch/,
  );
  assert.match(html, /No workspace profile yet/);
  assert.match(html, /Open a workspace folder to detect a saved profile/);
  assert.doesNotMatch(html, /id="openProfile"/);
});

test('OpenClaudeControlCenterProvider.getHtml supplies a nonce to the redesigned renderer', () => {
  const { OpenClaudeControlCenterProvider } = loadExtension();
  const provider = new OpenClaudeControlCenterProvider();

  assert.doesNotThrow(() => provider.getHtml(createStatus()));

  const html = provider.getHtml(createStatus());
  assert.match(html, /script-src 'nonce-[^']+'/);
  assert.match(html, /<script nonce="[^"]+">/);
  assert.doesNotMatch(html, /nonce-undefined/);
  assert.doesNotMatch(html, /<script nonce="undefined">/);
});

test('resolveLaunchTargets distinguishes project-aware launch from workspace-root launch', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      activeFilePath: '/workspace/openclaude/src/panels/control-center.js',
      workspacePath: '/workspace/openclaude',
      workspaceSourceLabel: 'active editor workspace',
    }),
    {
      projectAwareCwd: '/workspace/openclaude/src/panels',
      projectAwareCwdLabel: '/workspace/openclaude/src/panels',
      projectAwareSourceLabel: 'active file directory',
      workspaceRootCwd: '/workspace/openclaude',
      workspaceRootCwdLabel: '/workspace/openclaude',
      launchActionsShareTarget: false,
      launchActionsShareTargetReason: null,
    },
  );
});

test('resolveLaunchTargets anchors relative launch commands to the workspace root', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      executable: './node_modules/.bin/openclaude',
      activeFilePath: '/workspace/openclaude/src/panels/control-center.js',
      workspacePath: '/workspace/openclaude',
      workspaceSourceLabel: 'active editor workspace',
    }),
    {
      projectAwareCwd: '/workspace/openclaude',
      projectAwareCwdLabel: '/workspace/openclaude',
      projectAwareSourceLabel: 'workspace root (required by relative launch command)',
      workspaceRootCwd: '/workspace/openclaude',
      workspaceRootCwdLabel: '/workspace/openclaude',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: 'relative-launch-command',
    },
  );
});

test('resolveLaunchTargets ignores active files outside the selected workspace', () => {
  const { resolveLaunchTargets } = loadExtension();

  assert.deepEqual(
    resolveLaunchTargets({
      executable: 'openclaude',
      activeFilePath: '/tmp/notes/scratch.js',
      workspacePath: '/workspace/openclaude',
      workspaceSourceLabel: 'first workspace folder',
    }),
    {
      projectAwareCwd: '/workspace/openclaude',
      projectAwareCwdLabel: '/workspace/openclaude',
      projectAwareSourceLabel: 'first workspace folder',
      workspaceRootCwd: '/workspace/openclaude',
      workspaceRootCwdLabel: '/workspace/openclaude',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: null,
    },
  );
});

test('renderControlCenterHtml restores landmark and heading semantics', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(createStatus(), { nonce: 'test-nonce', platform: 'win32' });

  assert.match(html, /<main class="shell" aria-labelledby="control-center-title">/);
  assert.match(html, /<header class="hero">/);
  assert.match(html, /<h1 class="headline-title" id="control-center-title">/);
  assert.match(html, /<section class="modules" aria-label="Control center details">/);
  assert.match(html, /<h2 class="module-title" id="section-project">Project<\/h2>/);
  assert.match(html, /<section class="actions-layout" aria-label="Control center actions">/);
});

test('renderControlCenterHtml explains distinct launch targets when an active file directory is available', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCwd: '/workspace/openclaude/src/panels',
      launchCwdLabel: '/workspace/openclaude/src/panels',
      launchCwdSourceLabel: 'active file directory',
      workspaceRootCwd: '/workspace/openclaude',
      workspaceRootCwdLabel: '/workspace/openclaude',
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /Starts beside the active file · \/workspace\/openclaude\/src\/panels/);
  assert.match(html, /Always starts at the workspace root · \/workspace\/openclaude/);
});

test('renderControlCenterHtml makes shared workspace-root launches explicit for relative commands', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCwd: '/workspace/openclaude',
      launchCwdLabel: '/workspace/openclaude',
      launchCwdSourceLabel: 'workspace root (required by relative launch command)',
      workspaceRootCwd: '/workspace/openclaude',
      workspaceRootCwdLabel: '/workspace/openclaude',
      launchActionsShareTarget: true,
      launchActionsShareTargetReason: 'relative-launch-command',
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /Project-aware launch is anchored to the workspace root by the relative command · \/workspace\/openclaude/);
  assert.match(html, /Same workspace-root target as Launch OpenClaude because the relative command resolves from the workspace root · \/workspace\/openclaude/);
});

test('renderControlCenterHtml escapes hostile text and title values', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(
    createStatus({
      launchCommand: '<img src=x onerror="boom()">',
      workspaceFolder: '"/><script>workspace()</script>',
      workspaceSourceLabel: 'active <b>workspace</b>',
      launchCwdLabel: '"><script>cwd()</script>',
      profileStatusHint: '<svg onload="profile()">',
      workspaceProfilePath: '"/><script>profile-path()</script>',
      providerState: {
        label: 'Provider "><img src=x onerror="label()">',
        detail: '<script>provider-detail()</script>',
        source: 'profile',
      },
    }),
    { nonce: 'test-nonce', platform: 'linux' },
  );

  assert.match(html, /&lt;img src=x onerror=&quot;boom\(\)&quot;&gt;/);
  assert.match(html, /&quot;\/&gt;&lt;script&gt;workspace\(\)&lt;\/script&gt;/);
  assert.match(html, /active &lt;b&gt;workspace&lt;\/b&gt;/);
  assert.match(html, /&lt;svg onload=&quot;profile\(\)&quot;&gt;/);
  assert.match(html, /Provider &quot;&gt;&lt;img src=x onerror=&quot;label\(\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;provider-detail\(\)&lt;\/script&gt; · saved profile/);
  assert.doesNotMatch(html, /<script>workspace\(\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror="boom\(\)">/);
});

// ──────────────────────────────────────────────

test('renderControlCenterHtml includes Provider Health HTML elements for dynamic rendering', () => {
  const { renderControlCenterHtml } = loadExtension();
  const html = renderControlCenterHtml(createStatus(), { nonce: 'test-nonce', platform: 'win32' });

  // Provider Health CSS styles present
  assert.ok(html.includes('.provider-health-module'), 'provider-health-module CSS class');
  assert.ok(html.includes('.health-verified'), 'health-verified CSS class');
  assert.ok(html.includes('.health-broken'), 'health-broken CSS class');
  assert.ok(html.includes('.provider-health-actions'), 'provider-health-actions CSS class');

  // Provider Health section label
  assert.ok(html.includes('Provider Health'), 'Provider Health heading');

  // DOM elements that renderProviderHealth populates via getElementById
  assert.ok(html.includes('id="providerHealthSummary"'), 'providerHealthSummary element');
  assert.ok(html.includes('id="providerResultsTable"'), 'providerResultsTable element');
  assert.ok(html.includes('id="providerResultsWrap"'), 'providerResultsWrap element');

  // Action buttons for free/deep checks
  assert.ok(html.includes('id="runFreeCheck"'), 'runFreeCheck button');
  assert.ok(html.includes('id="runDeepCheck"'), 'runDeepCheck button');
  assert.ok(html.includes('Run Free Check'), 'Run Free Check label');
  assert.ok(html.includes('Run Deep Check'), 'Run Deep Check label');

  // renderProviderHealth JS function exists for dynamic updates
  assert.ok(html.includes('function renderProviderHealth'), 'renderProviderHealth function');
  });


// ──────────────────────────────────────────────
// ModelVettingStore unit tests
// ──────────────────────────────────────────────

function createMockContext(initialState = null) {
  let state = initialState ? JSON.parse(JSON.stringify(initialState)) :
    { vetted: [], disabled: [], broken: [], lastValidation: null, validationResults: [], contextOverrides: {} };
  return {
    globalState: {
      get: (key) => state,
      update: (key, value) => { state = value; },
    },
  };
}

function getStoreState(store) {
  return store._data;
}

test('ModelVettingStore initializes with empty state when no saved data exists', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext();
  const store = new ModelVettingStore(ctx);

  assert.deepEqual(store.getVettedModels(), []);
  assert.deepEqual(store.getBrokenModels(), []);
  assert.deepEqual(store.getDisabledModels(), []);
  assert.equal(store.getLastValidationTime(), null);
  assert.deepEqual(store.getLastValidationResults(), []);
});

test('ModelVettingStore restores state from globalState', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const saved = {
    vetted: ['model-a', 'model-b'],
    disabled: ['model-c'],
    broken: ['model-d'],
    lastValidation: '2026-05-14T12:00:00Z',
    validationResults: [{ modelId: 'model-a', status: 'verified' }],
    contextOverrides: { 'model-a': 32000 },
  };
  const ctx = createMockContext(saved);
  const store = new ModelVettingStore(ctx);

  assert.deepEqual(store.getVettedModels(), ['model-a', 'model-b']);
  assert.deepEqual(store.getBrokenModels(), ['model-d']);
  assert.deepEqual(store.getDisabledModels(), ['model-c']);
  assert.equal(store.getLastValidationTime(), '2026-05-14T12:00:00Z');
  assert.deepEqual(store.getLastValidationResults(), [{ modelId: 'model-a', status: 'verified' }]);
});

test('ModelVettingStore markVerified adds to vetted and removes from broken/disabled', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: [],
    disabled: ['test-model'],
    broken: ['test-model'],
    lastValidation: null,
    validationResults: [],
    contextOverrides: {},
  });
  const store = new ModelVettingStore(ctx);

  store.markVerified('test-model');

  assert.ok(store.getVettedModels().includes('test-model'));
  assert.ok(!store.getBrokenModels().includes('test-model'));
  assert.ok(!store.getDisabledModels().includes('test-model'));
});

test('ModelVettingStore markBroken adds to broken and removes from vetted', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: ['test-model'],
    disabled: [],
    broken: [],
    lastValidation: null,
    validationResults: [],
    contextOverrides: {},
  });
  const store = new ModelVettingStore(ctx);

  store.markBroken('test-model');

  assert.ok(store.getBrokenModels().includes('test-model'));
  assert.ok(!store.getVettedModels().includes('test-model'));
});

test('ModelVettingStore disable adds to disabled and removes from vetted', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext();
  const store = new ModelVettingStore(ctx);

  store.markVerified('test-model');
  store.disable('test-model');

  assert.ok(store.getDisabledModels().includes('test-model'));
  assert.ok(!store.getVettedModels().includes('test-model'));
});

test('ModelVettingStore enable removes from disabled', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: [],
    disabled: ['test-model'],
    broken: [],
    lastValidation: null,
    validationResults: [],
    contextOverrides: {},
  });
  const store = new ModelVettingStore(ctx);

  store.enable('test-model');

  assert.ok(!store.getDisabledModels().includes('test-model'));
});

test('ModelVettingStore storeValidationResults persists results and auto-marks models', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext();
  const store = new ModelVettingStore(ctx);

  const results = [
    { modelId: 'good-model', providerId: 'test-provider', status: 'verified', details: 'OK' },
    { modelId: 'bad-model', providerId: 'test-provider', status: 'broken', details: 'Auth failed' },
    { modelId: 'unknown-model', providerId: 'test-provider', status: 'unknown', details: 'Not found' },
  ];

  store.storeValidationResults(results);

  assert.deepEqual(store.getLastValidationResults(), results);
  assert.ok(store.getLastValidationTime() !== null);
  assert.ok(store.getVettedModels().includes('good-model'));
  assert.ok(store.getBrokenModels().includes('bad-model'));
  // Unknown should NOT be marked as vetted or broken
  assert.ok(!store.getVettedModels().includes('unknown-model'));
  assert.ok(!store.getBrokenModels().includes('unknown-model'));
});

test('ModelVettingStore getModelStatus returns correct status for all states', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: ['vetted-model'],
    disabled: ['disabled-model'],
    broken: ['broken-model'],
    lastValidation: null,
    validationResults: [],
    contextOverrides: {},
  });
  const store = new ModelVettingStore(ctx);

  assert.equal(store.getModelStatus('vetted-model'), 'verified');
  assert.equal(store.getModelStatus('disabled-model'), 'disabled');
  assert.equal(store.getModelStatus('broken-model'), 'broken');
  assert.equal(store.getModelStatus('unknown-model'), 'unknown');
  // Disabled takes priority over broken/vetted
  store.markBroken('disabled-model');
  assert.equal(store.getModelStatus('disabled-model'), 'disabled');
});

test('ModelVettingStore setContextOverride and getContextOverrides', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext();
  const store = new ModelVettingStore(ctx);

  store.setContextOverride('model-a', 64000);
  store.setContextOverride('model-b', 32000);

  const overrides = store.getContextOverrides();
  assert.equal(overrides['model-a'], 64000);
  assert.equal(overrides['model-b'], 32000);

  // Removing an override
  store.setContextOverride('model-a', null);
  const updated = store.getContextOverrides();
  assert.ok(!('model-a' in updated));
});

test('ModelVettingStore exportConfig exports correctly with scope filtering', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: ['model-a'],
    disabled: ['model-b'],
    broken: ['model-c'],
    lastValidation: null,
    validationResults: [],
    contextOverrides: { 'model-a': 32000 },
  });
  const store = new ModelVettingStore(ctx);

  const catalog = [
    {
      id: 'test-provider',
      label: 'Test Provider',
      baseUrl: 'https://api.test.com/v1',
      models: [
        { id: 'model-a', label: 'Model A' },
        { id: 'model-b', label: 'Model B' },
        { id: 'model-c', label: 'Model C' },
      ],
    },
  ];

  // Export all
  const allExport = JSON.parse(store.exportConfig({ catalog, scope: 'all' }));
  assert.equal(allExport.scope, 'all');
  const allModels = allExport.models[0].models;
  assert.equal(allModels.length, 3);

  // Export vetted only
  const vettedExport = JSON.parse(store.exportConfig({ catalog, scope: 'vetted' }));
  assert.equal(vettedExport.models[0].models.length, 1);
  assert.equal(vettedExport.models[0].models[0].id, 'model-a');

  // Export disabled only
  const disabledExport = JSON.parse(store.exportConfig({ catalog, scope: 'disabled' }));
  assert.equal(disabledExport.models[0].models.length, 1);
  assert.equal(disabledExport.models[0].models[0].id, 'model-b');

  // Export with context overrides
  assert.equal(allExport.models[0].models[0].contextOverride, 32000);
});

test('ModelVettingStore getFilteredCatalog filters by vetting mode', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: ['model-a'],
    disabled: ['model-b'],
    broken: ['model-c'],
    lastValidation: null,
    validationResults: [],
    contextOverrides: {},
  });
  const store = new ModelVettingStore(ctx);

  const catalog = [
    {
      id: 'test-provider',
      label: 'Test Provider',
      models: [
        { id: 'model-a', label: 'Model A' },
        { id: 'model-b', label: 'Model B' },
        { id: 'model-c', label: 'Model C' },
      ],
    },
  ];

  // 'all' returns everything
  const allResult = store.getFilteredCatalog(catalog, 'all');
  assert.equal(allResult[0].models.length, 3);

  // 'vetted' returns verified + unknown
  const vettedResult = store.getFilteredCatalog(catalog, 'vetted');
  const vettedIds = vettedResult[0].models.map(m => m.id);
  assert.ok(vettedIds.includes('model-a'));
  assert.ok(!vettedIds.includes('model-c')); // broken, not unknown
  assert.equal(vettedIds.length, 1); // only model-a (verified) + model-d-never-registered
  assert.ok(!vettedIds.includes('model-b')); // disabled

  // 'working' returns only verified
  const workingResult = store.getFilteredCatalog(catalog, 'working');
  assert.equal(workingResult[0].models.length, 1);
  assert.equal(workingResult[0].models[0].id, 'model-a');

  // 'disabled' returns only disabled
  const disabledResult = store.getFilteredCatalog(catalog, 'disabled');
  assert.equal(disabledResult[0].models.length, 1);
  assert.equal(disabledResult[0].models[0].id, 'model-b');
});

test('ModelVettingStore reset clears all data', () => {
  const { ModelVettingStore } = require('./chat/modelVettingStore');
  const ctx = createMockContext({
    vetted: ['model-a'],
    disabled: ['model-b'],
    broken: ['model-c'],
    lastValidation: '2026-05-14T12:00:00Z',
    validationResults: [{ modelId: 'model-a', status: 'verified' }],
    contextOverrides: { 'model-a': 32000 },
  });
  const store = new ModelVettingStore(ctx);

  store.reset();

  assert.deepEqual(store.getVettedModels(), []);
  assert.deepEqual(store.getBrokenModels(), []);
  assert.deepEqual(store.getDisabledModels(), []);
  assert.equal(store.getLastValidationTime(), null);
  assert.deepEqual(store.getLastValidationResults(), []);
  assert.deepEqual(store.getContextOverrides(), {});
});

// ──────────────────────────────────────────────
// ModelValidator unit tests (no network)
// ──────────────────────────────────────────────

const sampleCatalog = [
  {
    id: 'test-provider',
    label: 'Test Provider',
    baseUrl: 'https://api.test.com/v1',
    models: [
      { id: 'model-a', label: 'Model A' },
      { id: 'model-b', label: 'Model B' },
    ],
  },
  {
    id: 'no-models-provider',
    label: 'No Models Provider',
    baseUrl: 'https://api.nomodels.com/v1',
    models: [],
  },
  {
    id: 'string-models-provider',
    label: 'String Models Provider',
    baseUrl: 'https://api.string.com/v1',
    models: ['model-c', 'model-d'],
  },
];

test('ModelValidator constructor initializes with catalog', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  assert.equal(mv._catalog.length, 3);
  assert.equal(mv._timeoutMs, 15000);
});

test('ModelValidator constructor accepts options', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog, {
    timeoutMs: 5000,
    envOverrides: { TEST_PROVIDER_API_KEY: 'test-key' },
  });

  assert.equal(mv._timeoutMs, 5000);
  assert.equal(mv._envOverrides.TEST_PROVIDER_API_KEY, 'test-key');
});

test('ModelValidator _resolveModel finds model by id in catalog', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const resolved = mv._resolveModel('model-a');
  assert.ok(resolved);
  assert.equal(resolved.provider.id, 'test-provider');
  assert.equal(resolved.model.id, 'model-a');
});

test('ModelValidator _resolveModel finds string model', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const resolved = mv._resolveModel('model-c');
  assert.ok(resolved);
  assert.equal(resolved.provider.id, 'string-models-provider');
  assert.equal(resolved.model.id, 'model-c');
});

test('ModelValidator _resolveModel returns null for unknown model', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const resolved = mv._resolveModel('nonexistent-model');
  assert.equal(resolved, null);
});

test('ModelValidator _resolveModel skips providers without models', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  // Should NOT resolve from no-models-provider
  const resolved = mv._resolveModel('model-a');
  assert.ok(resolved);
  assert.notEqual(resolved.provider.id, 'no-models-provider');
});

test('ModelValidator _getProviderEnvKey generates correct env var name', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  assert.equal(mv._getProviderEnvKey('test-provider'), 'TEST_PROVIDER_API_KEY');
  assert.equal(mv._getProviderEnvKey('openai-direct'), 'OPENAI_DIRECT_API_KEY');
});

test('ModelValidator _getProviderBaseUrlEnvKey generates correct base URL env var name', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  assert.equal(mv._getProviderBaseUrlEnvKey('test-provider'), 'TEST_PROVIDER_BASE_URL');
});

test('ModelValidator _getApiKey reads from envOverrides first, then process.env', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog, {
    envOverrides: { TEST_PROVIDER_API_KEY: 'override-key' },
  });

  // envOverrides take priority
  assert.equal(mv._getApiKey('test-provider'), 'override-key');

  // Without override, falls back to process.env
  assert.equal(mv._getApiKey('unknown-provider'), null);
});

test('ModelValidator _buildAuthHeaders builds Bearer auth header', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const headers = mv._buildAuthHeaders('my-secret-key');
  assert.deepEqual(headers, { Authorization: 'Bearer my-secret-key' });
});

test('ModelValidator _buildAuthHeaders returns empty object for null key', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  assert.deepEqual(mv._buildAuthHeaders(null), {});
  assert.deepEqual(mv._buildAuthHeaders(''), {});
});

test('ModelValidator getAllModelIds returns all model IDs flattened', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const ids = mv.getAllModelIds();
  assert.deepEqual(ids, ['model-a', 'model-b', 'model-c', 'model-d']);
});

test('ModelValidator getProviderSummary returns provider info', () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const summary = mv.getProviderSummary();
  assert.equal(summary.length, 3);
  assert.deepEqual(summary[0], { id: 'test-provider', label: 'Test Provider', modelCount: 2 });
  assert.deepEqual(summary[1], { id: 'no-models-provider', label: 'No Models Provider', modelCount: 0 });
  assert.deepEqual(summary[2], { id: 'string-models-provider', label: 'String Models Provider', modelCount: 2 });
});

test('ModelValidator validateModelFree returns unknown for model not in catalog', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const result = await mv.validateModelFree('nonexistent');
  assert.equal(result.status, 'unknown');
  assert.equal(result.providerId, null);
  assert.match(result.details, /not found in catalog/);
});

test('ModelValidator validateModelFree returns unknown when no baseUrl configured', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const noBaseCatalog = [{ id: 'no-base', label: 'No Base', models: [{ id: 'model-x' }] }];
  const mv = new ModelValidator(noBaseCatalog);

  const result = await mv.validateModelFree('model-x');
  assert.equal(result.status, 'unknown');
  assert.match(result.details, /No base URL/);
});

test('ModelValidator validateModelPaid returns unknown for model not in catalog', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const result = await mv.validateModelPaid('nonexistent');
  assert.equal(result.status, 'unknown');
  assert.equal(result.method, 'paid');
  assert.match(result.details, /not found in catalog/);
});

test('ModelValidator validateModelPaid returns broken when no API key configured', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const result = await mv.validateModelPaid('model-a');
  assert.equal(result.status, 'broken');
  assert.match(result.details, /No API key/);
});

test('ModelValidator validateModel dispatches to free or paid based on mode', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const mv = new ModelValidator(sampleCatalog);

  const freeResult = await mv.validateModel('model-a', { mode: 'free' });
  assert.equal(freeResult.method, 'free');

  const paidResult = await mv.validateModel('model-a', { mode: 'paid' });
  assert.equal(paidResult.method, 'paid');
});

test('ModelValidator validateAll with providerFilter only validates matching providers', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  // Use providers without baseUrl to avoid actual HTTP
  const catalog = [
    { id: 'p1', label: 'P1', models: [{ id: 'm1' }] },
    { id: 'p2', label: 'P2', models: [{ id: 'm2' }] },
  ];
  const mv = new ModelValidator(catalog);

  const results = await mv.validateAll({ mode: 'free', providerFilter: ['p1'] });
  assert.equal(results.length, 1);
  assert.equal(results[0].providerId, 'p1');
});

test('ModelValidator validateAll calls onProgress callback', async () => {
  const { ModelValidator } = require('./chat/modelValidator');
  const catalog = [
    { id: 'p1', label: 'P1', models: [{ id: 'm1' }] },
  ];
  const mv = new ModelValidator(catalog);

  const progressCalls = [];
  await mv.validateAll({
    mode: 'free',
    onProgress: (done, total, result) => {
      progressCalls.push({ done, total });
    },
  });

  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].done, 1);
  assert.equal(progressCalls[0].total, 1);
});
