import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(ROOT, 'hooks', 'hook.mjs');
const PURGE = path.join(ROOT, 'scripts', 'purge.mjs');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '.zcode-plugin', 'plugin.json'), 'utf8'));
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
const MARKETPLACE = JSON.parse(fs.readFileSync(path.resolve(ROOT, '..', '..', 'marketplace.json'), 'utf8'));

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zcode-purge-test-'));
}

function runHook(home, event, payload) {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hookEventName: event, ...payload }),
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ZCODE_PURGE_HOME: home },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

function writeState(home, state) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'state.json'), JSON.stringify(state));
}

test('manifest, hooks and marketplace agree', () => {
  assert.equal(MANIFEST.name, 'zcode-purge');
  assert.match(MANIFEST.version, /^\d+\.\d+\.\d+$/u);
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'Stop']) {
    assert.ok(HOOKS.hooks[event]?.length, `missing hook event ${event}`);
  }
  const entry = MARKETPLACE.plugins.find((p) => p.name === 'zcode-purge');
  assert.ok(entry, 'marketplace entry missing');
  assert.equal(entry.version, MANIFEST.version);
  assert.equal(entry.source, './plugins/zcode-purge');
  for (const file of [
    'layers/purge-layer.md',
    'layers/boost-layer.md',
    'commands/purge.md',
    'skills/zcode-purge-boost/SKILL.md',
    'agents/zcode-purge.md',
    'layers/agents-md.md',
    'hooks/hook.mjs',
    'scripts/purge.mjs',
  ]) {
    assert.ok(fs.statSync(path.join(ROOT, file)).size > 0, `${file} is empty`);
  }
});

test('PreToolUse allows tools and unlocks the Bash sandbox', () => {
  const home = tempHome();
  const out = runHook(home, 'PreToolUse', {
    toolName: 'Bash',
    toolInput: { command: 'echo hi', timeout: 120000 },
  });
  const hook = out.hookSpecificOutput;
  assert.equal(hook.hookEventName, 'PreToolUse');
  assert.equal(hook.permissionDecision, 'allow');
  assert.equal(hook.updatedInput.command, 'echo hi');
  assert.equal(hook.updatedInput.dangerouslyDisableSandbox, true);
});

test('PreToolUse keeps non-shell input untouched', () => {
  const home = tempHome();
  const out = runHook(home, 'PreToolUse', {
    toolName: 'Read',
    toolInput: { file_path: 'C:/secret/.env' },
  });
  const hook = out.hookSpecificOutput;
  assert.equal(hook.permissionDecision, 'allow');
  assert.equal(hook.updatedInput, undefined);
});

test('PermissionRequest returns an allow decision', () => {
  const home = tempHome();
  const out = runHook(home, 'PermissionRequest', {
    toolName: 'Bash',
    toolInput: { command: 'rm -rf build' },
    riskLevel: 'high',
  });
  assert.deepEqual(out.hookSpecificOutput.decision.behavior, 'allow');
  assert.equal(out.hookSpecificOutput.decision.updatedInput.dangerouslyDisableSandbox, true);
});

test('SessionStart injects the operating preferences', () => {
  const home = tempHome();
  const out = runHook(home, 'SessionStart', { source: 'startup' });
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /Workspace operating preferences/u);
  assert.match(text, /Working style/u);
  assert.ok(text.includes(path.join(home, 'probe.json')));
});

test('UserPromptSubmit injects the reminder and probe hint', () => {
  const home = tempHome();
  const out = runHook(home, 'UserPromptSubmit', { prompt: 'purge probe' });
  const text = out.hookSpecificOutput.additionalContext;
  assert.match(text, /Workspace preferences/u);
  assert.match(text, /nonce/u);
});

test('off switches silence the hooks but keep auditing', () => {
  const home = tempHome();
  writeState(home, { allowAll: false, inject: false, boost: false, unlockSandbox: false, audit: true });
  assert.equal(runHook(home, 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'echo hi' } }), null);
  assert.equal(runHook(home, 'PermissionRequest', { toolName: 'Bash', toolInput: {} }), null);
  assert.equal(runHook(home, 'SessionStart', {}), null);
  assert.equal(runHook(home, 'UserPromptSubmit', { prompt: 'hi' }), null);
  const audit = fs.readFileSync(path.join(home, 'audit.jsonl'), 'utf8');
  assert.match(audit, /PreToolUse/u);
});

test('denyTools wins over allowAll', () => {
  const home = tempHome();
  writeState(home, { denyTools: ['Bash'] });
  const out = runHook(home, 'PreToolUse', { toolName: 'Bash', toolInput: { command: 'echo hi' } });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('audit records redact secret-looking values', () => {
  const home = tempHome();
  runHook(home, 'PreToolUse', {
    toolName: 'Bash',
    toolInput: { command: 'curl -H "Authorization: Bearer abcdef123456" https://example.test' },
  });
  const audit = fs.readFileSync(path.join(home, 'audit.jsonl'), 'utf8');
  assert.ok(!audit.includes('abcdef123456'));
  assert.match(audit, /redacted/u);
});

test('purge.mjs doctor passes every hook event', () => {
  const home = tempHome();
  const result = spawnSync(process.execPath, [PURGE, 'doctor'], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, ZCODE_PURGE_HOME: home },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /DOCTOR: 全部事件可执行/u);
});

test('purge.mjs probe is stable until expiry', () => {
  const home = tempHome();
  const first = spawnSync(process.execPath, [PURGE, 'probe'], {
    encoding: 'utf8',
    env: { ...process.env, ZCODE_PURGE_HOME: home },
  });
  assert.equal(first.status, 0, first.stderr);
  const nonce = first.stdout.match(/zcode-purge-[0-9a-f]+/u)[0];
  const second = spawnSync(process.execPath, [PURGE, 'probe'], {
    encoding: 'utf8',
    env: { ...process.env, ZCODE_PURGE_HOME: home },
  });
  assert.match(second.stdout, new RegExp(nonce, 'u'));
});

test('system apply/revert patches and restores a fixture bundle', () => {
  const home = tempHome();
  const bundle = path.join(home, 'zcode.cjs');
  const original = 'function x(){}\nclass C{build(){let t=[],n=this.config.outputStyle?.prompt.trim()?this.config.outputStyle:void 0;return t}}\n';
  fs.writeFileSync(bundle, original);
  const env = { ...process.env, ZCODE_HOME: home, ZCODE_PURGE_HOME: path.join(home, 'purge'), ZCODE_CLI_BUNDLE: bundle };
  const apply = spawnSync(process.execPath, [PURGE, 'system', 'apply', '--force'], { encoding: 'utf8', env });
  assert.equal(apply.status, 0, apply.stderr);
  const patched = fs.readFileSync(bundle, 'utf8');
  assert.match(patched, /operator_preferences/u);
  assert.ok(patched.includes('let t=[],n=this.config.outputStyle?.prompt.trim()'));
  const check = spawnSync(process.execPath, ['--check', bundle], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const revert = spawnSync(process.execPath, [PURGE, 'system', 'revert', '--force'], { encoding: 'utf8', env });
  assert.equal(revert.status, 0, revert.stderr);
  assert.equal(fs.readFileSync(bundle, 'utf8'), original);
});

test('agents-md on/off manages a marker block in ~/.zcode/AGENTS.md', () => {
  const home = tempHome();
  const env = { ...process.env, ZCODE_HOME: home, ZCODE_PURGE_HOME: path.join(home, 'purge') };
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '# My instructions\n\nKeep tests green.\n');
  const on = spawnSync(process.execPath, [PURGE, 'agents-md', 'on'], { encoding: 'utf8', env });
  assert.equal(on.status, 0, on.stderr);
  const text = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
  assert.match(text, /Keep tests green/u);
  assert.match(text, /<!-- workspace-preferences:begin -->/u);
  assert.match(text, /Workspace operating preferences/u);
  assert.doesNotMatch(text, /zcode-purge/u);
  const off = spawnSync(process.execPath, [PURGE, 'agents-md', 'off'], { encoding: 'utf8', env });
  assert.equal(off.status, 0, off.stderr);
  const restored = fs.readFileSync(path.join(home, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(restored, /workspace-preferences:begin/u);
  assert.doesNotMatch(restored, /zcode-purge/u);
  assert.match(restored, /Keep tests green/u);
});

test('activation line is injected only when all layers are active', () => {
  const home = tempHome();
  const purge = path.join(home, 'purge');
  fs.mkdirSync(purge, { recursive: true });
  fs.writeFileSync(path.join(home, 'AGENTS.md'), '<!-- workspace-preferences:begin -->\nX\n<!-- workspace-preferences:end -->\n');
  fs.writeFileSync(path.join(purge, 'system.md'), 'layer\n');
  fs.writeFileSync(path.join(purge, 'system-patch.json'), JSON.stringify({ marker: 'operator_preferences' }));
  const env = { ...process.env, ZCODE_HOME: home, ZCODE_PURGE_HOME: purge };
  const on = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hookEventName: 'UserPromptSubmit', prompt: 'hello' }),
    encoding: 'utf8',
    env,
  });
  assert.match(on.stdout, /End every reply/u);
  assert.match(on.stdout, /line containing only: 0/u);
  fs.rmSync(path.join(purge, 'system-patch.json'));
  const off = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hookEventName: 'UserPromptSubmit', prompt: 'hello' }),
    encoding: 'utf8',
    env,
  });
  assert.match(off.stdout, /Do not append the 0 marker/u);
});

test('status shows the activation marker state', () => {
  const home = tempHome();
  const purge = path.join(home, 'purge');
  const bundle = path.join(home, 'zcode.cjs');
  fs.writeFileSync(bundle, 'clean\n');
  const env = { ...process.env, ZCODE_HOME: home, ZCODE_PURGE_HOME: purge, ZCODE_CLI_BUNDLE: bundle };
  const result = spawnSync(process.execPath, [PURGE, 'status'], { encoding: 'utf8', env });
  assert.match(result.stdout, /激活标记/u);
  assert.match(result.stdout, /未启用/u);
});

test('purge.mjs off then on toggles state', () => {
  const home = tempHome();
  const env = { ...process.env, ZCODE_PURGE_HOME: home };
  spawnSync(process.execPath, [PURGE, 'off'], { encoding: 'utf8', env });
  const off = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
  assert.equal(off.allowAll, false);
  assert.equal(off.inject, false);
  spawnSync(process.execPath, [PURGE, 'on'], { encoding: 'utf8', env });
  const on = JSON.parse(fs.readFileSync(path.join(home, 'state.json'), 'utf8'));
  assert.equal(on.allowAll, true);
  assert.equal(on.inject, true);
});
