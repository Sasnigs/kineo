import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { executeTask, runCommand, validateTask } from '../agent-task.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kineo-harness-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Harness fixture');
  await writeFile(path.join(root, '.gitignore'), '.agent-runs/\n');
  await writeFile(path.join(root, 'allowed.md'), 'before\n');
  git('add', '.');
  git('commit', '-m', 'Fixture baseline');
  const task = { id: 'fixture', goal: 'Update fixture', base: git('rev-parse', 'HEAD'),
    scope: ['allowed.md', 'task.json'], acceptance: ['Updated fixture'], checks: ['docs'],
    limits: { agentTurns: 2, minutes: 1 } };
  await writeFile(path.join(root, 'task.json'), JSON.stringify(task));
  git('add', '.');
  git('commit', '-m', 'Approved task');
  git('switch', '-c', 'test/harness');
  const command = async () => ({ code: 0 });
  const invoke = (action, options = {}) => executeTask(action, 'task.json', { root, run: command, ...options });
  const state = async () => JSON.parse(await readFile(path.join(root, '.agent-runs/fixture/checkpoint.json'), 'utf8'));
  return { root, git, task, invoke, state };
}

test('validates scope paths and rejects unknown profiles or excessive budgets', () => {
  const task = { id: 'valid', goal: 'Goal', base: 'a'.repeat(40), scope: ['docs/example.md'],
    acceptance: ['Evidence'], checks: ['docs'], limits: { agentTurns: 2, minutes: 10 } };
  assert.equal(validateTask(task).id, 'valid');
  for (const scope of [['../escape'], ['/absolute'], ['.git/config'], ['docs//file'], ['docs/*.md']]) {
    assert.throws(() => validateTask({ ...task, scope }), { code: 'INVALID_TASK' });
  }
  assert.throws(() => validateTask({ ...task, checks: ['unchecked'] }), { code: 'INVALID_TASK' });
  assert.throws(() => validateTask({ ...task, limits: { agentTurns: 999, minutes: 10 } }), { code: 'INVALID_TASK' });
});

test('successful checks become stale after a scoped file changes', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  await invoke('check');
  assert.equal((await invoke('status')).checksCurrent, true);
  await writeFile(path.join(root, 'allowed.md'), 'changed\n');
  assert.equal((await invoke('status')).checksCurrent, false);
});

test('scope gates reject untracked files, deleted paths, and both sides of renames', async (t) => {
  const { root, git, invoke } = await fixture(t);
  await invoke('start');
  await writeFile(path.join(root, 'outside.md'), 'unapproved\n');
  await assert.rejects(invoke('check'), { code: 'SCOPE_DRIFT' });
  await rm(path.join(root, 'outside.md'));
  git('mv', 'allowed.md', 'outside.md');
  await assert.rejects(invoke('check'), { code: 'SCOPE_DRIFT' });
});

test('unapproved staged changes remain blocked when removed from the worktree', async (t) => {
  const { root, git, invoke } = await fixture(t);
  await invoke('start');
  await writeFile(path.join(root, 'staged.md'), 'unapproved\n');
  git('add', 'staged.md');
  await rm(path.join(root, 'staged.md'));
  await assert.rejects(invoke('check'), { code: 'SCOPE_DRIFT' });
});

test('symlinked scoped files and checkpoint directories cannot escape the checkout', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  await rm(path.join(root, 'allowed.md'));
  await symlink('/etc/hosts', path.join(root, 'allowed.md'));
  await assert.rejects(invoke('check'), { code: 'SCOPE_DRIFT' });
  await rm(path.join(root, 'allowed.md'));
  await writeFile(path.join(root, 'allowed.md'), 'before\n');
  await rm(path.join(root, '.agent-runs/fixture'), { recursive: true });
  await symlink(tmpdir(), path.join(root, '.agent-runs/fixture'));
  await assert.rejects(invoke('start'), { code: 'SCOPE_DRIFT' });
});

test('changes during a check cannot produce a passing checkpoint', async (t) => {
  const { root, invoke, state } = await fixture(t);
  await invoke('start');
  await assert.rejects(invoke('check', { run: async () => {
    await writeFile(path.join(root, 'allowed.md'), 'changed during check\n');
    return { code: 0 };
  } }), { code: 'STALE_CHECK' });
  assert.equal((await state()).checks, null);
});

test('failure cannot retain prior passing check evidence', async (t) => {
  const { invoke, state } = await fixture(t);
  await invoke('start');
  await invoke('check');
  await assert.rejects(invoke('check', { run: async () => ({ code: 1 }) }), { code: 'CHECK_FAILED' });
  assert.equal((await state()).checks, null);
  assert.equal((await state()).phase, 'failed');
});

test('agent attempts are persisted and exhausted even on command failure', async (t) => {
  const { invoke, state } = await fixture(t);
  await invoke('start');
  const failed = { phase: 'implement', run: async () => ({ code: 1 }) };
  await assert.rejects(invoke('agent', failed), { code: 'AGENT_FAILED' });
  await assert.rejects(invoke('agent', failed), { code: 'AGENT_FAILED' });
  assert.equal((await state()).agentTurns, 2);
  await assert.rejects(invoke('agent', failed), { code: 'LIMIT_REACHED' });
});

test('task edits, branch changes, and concurrent locks stop continuation', async (t) => {
  const { root, git, invoke, task } = await fixture(t);
  await invoke('start');
  const lock = path.join(root, '.agent-runs/fixture/run.lock');
  await mkdir(lock);
  await assert.rejects(invoke('check'), { code: 'BUSY' });
  await rm(lock, { recursive: true });
  git('switch', '-c', 'test/other');
  await assert.rejects(invoke('check'), { code: 'CHECKPOINT_MISMATCH' });
  git('switch', 'test/harness');
  await writeFile(path.join(root, 'task.json'), JSON.stringify({ ...task, goal: 'Different authority' }));
  await assert.rejects(invoke('check'), { code: 'CHECKPOINT_MISMATCH' });
});

test('interrupted reservation cannot be reused and a main branch cannot start', async (t) => {
  const { root, git, invoke, state } = await fixture(t);
  git('switch', 'main');
  await assert.rejects(invoke('start'), { code: 'UNSAFE_BRANCH' });
  git('switch', 'test/harness');
  await invoke('start');
  await assert.rejects(invoke('check', { run: async () => { throw new Error('Interruption'); } }), { code: 'COMMAND_FAILED' });
  assert.equal((await state()).checks, null);
  assert.equal((await state()).phase, 'failed');
  // A killed coordinator leaves the pre-reserved full allowance on disk.
  const checkpoint = await state();
  checkpoint.reservedMs = 60_000;
  await writeFile(path.join(root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(checkpoint));
  await assert.rejects(invoke('check'), { code: 'LIMIT_REACHED' });
});

test('process runner reports spawn failure and terminates a timed-out process', async () => {
  await assert.rejects(runCommand('kineo-nonexistent-executable', [], { cwd: tmpdir(), timeoutMs: 100 }), { code: 'COMMAND_FAILED' });
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'],
    { cwd: tmpdir(), timeoutMs: 100 }), { code: 'TIMEOUT' });
});
