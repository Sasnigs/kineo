import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, chmod, stat } from 'node:fs/promises';
import { fstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { checkDocs, executeTask, runCommand, validateTask } from '../agent-task.mjs';

const TEST_TIMEOUT_MS = 100;
const FIXTURE_MINUTE_MS = 60_000;
const DESCENDANT_START_TIMEOUT_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 10;
const PROCESS_KEEPALIVE_INTERVAL_MS = 1_000;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const RESTRICTED_DIRECTORY_MODE = 0o500;
const FILE_MODE_MASK = 0o777;
const COMMIT_SHA_HEX_LENGTH = 40;
const REQUIRED_DOCUMENT_PATHS = ['AGENTS.md', 'docs/STATUS.md', 'docs/agents/HARNESS.md', 'docs/agents/issue-tracker.md',
  'docs/KINEO_PRODUCT_DESIGN.md', 'docs/KINEO_IMPLEMENTATION_MILESTONES.md', 'docs/technical/00_TECHNICAL_DESIGN_INDEX.md'];

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kineo-harness-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Harness fixture');
  await writeFile(path.join(root, '.gitignore'), '.agent-runs/\nignored.txt\n');
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
  const task = { id: 'valid', goal: 'Goal', base: 'a'.repeat(COMMIT_SHA_HEX_LENGTH), scope: ['docs/example.md'],
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

test('scope gates reject ignored files outside the exact task scope', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  await writeFile(path.join(root, 'ignored.txt'), 'unapproved\n');
  await assert.rejects(invoke('check'), { code: 'SCOPE_DRIFT' });
});

test('pre-existing ignored files are allowed but later changes are scope drift', async (t) => {
  const modified = await fixture(t);
  await writeFile(path.join(modified.root, 'ignored.txt'), 'before\n');
  await modified.invoke('start');
  assert.equal((await modified.invoke('status')).phase, 'started');
  await writeFile(path.join(modified.root, 'ignored.txt'), 'after modification\n');
  await assert.rejects(modified.invoke('check'), { code: 'SCOPE_DRIFT' });

  const deleted = await fixture(t);
  await writeFile(path.join(deleted.root, 'ignored.txt'), 'before\n');
  await deleted.invoke('start');
  await rm(path.join(deleted.root, 'ignored.txt'));
  await assert.rejects(deleted.invoke('check'), { code: 'SCOPE_DRIFT' });
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

test('failed actions still report scope drift created during the command', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  await assert.rejects(invoke('agent', { run: async () => {
    await writeFile(path.join(root, 'outside.md'), 'unapproved\n');
    return { code: 1 };
  } }), { code: 'SCOPE_DRIFT' });
});

test('throwing actions still report scope drift created during the command', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  await assert.rejects(invoke('agent', { run: async () => {
    await writeFile(path.join(root, 'outside.md'), 'unapproved\n');
    throw new Error('command infrastructure failed');
  } }), { code: 'SCOPE_DRIFT' });
});

test('failed checks can be retried without retaining failed evidence', async (t) => {
  const { invoke, state } = await fixture(t);
  await invoke('start');
  await assert.rejects(invoke('check', { run: async () => ({ code: 1 }) }), { code: 'CHECK_FAILED' });
  assert.equal((await state()).checks, null);
  await invoke('check');
  assert.equal((await invoke('status')).checksCurrent, true);
});

test('malformed task and checkpoint JSON map to typed harness failures', async (t) => {
  const { root, invoke } = await fixture(t);
  await writeFile(path.join(root, 'task.json'), '{');
  await assert.rejects(invoke('start'), { code: 'INVALID_TASK' });

  const next = await fixture(t);
  await next.invoke('start');
  await writeFile(path.join(next.root, '.agent-runs/fixture/checkpoint.json'), '{');
  await assert.rejects(next.invoke('status'), { code: 'CHECKPOINT_MISMATCH' });
  await writeFile(path.join(next.root, '.agent-runs/fixture/checkpoint.json'), 'null');
  await assert.rejects(next.invoke('status'), { code: 'CHECKPOINT_MISMATCH' });
});

test('semantically corrupt checkpoint evidence cannot appear current', async (t) => {
  const { root, invoke, state } = await fixture(t);
  await invoke('start');
  await invoke('check');
  const checkpoint = await state();
  checkpoint.phase = 'failed';
  await writeFile(path.join(root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(checkpoint));
  await assert.rejects(invoke('status'), { code: 'CHECKPOINT_MISMATCH' });

  const next = await fixture(t);
  await next.invoke('start');
  await next.invoke('check');
  const nextCheckpoint = await next.state();
  nextCheckpoint.checks.profiles = ['mobile'];
  await writeFile(path.join(next.root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(nextCheckpoint));
  await assert.rejects(next.invoke('status'), { code: 'CHECKPOINT_MISMATCH' });

  const invalidTimestamp = await fixture(t);
  await invalidTimestamp.invoke('start');
  await invalidTimestamp.invoke('check');
  const invalidTimestampCheckpoint = await invalidTimestamp.state();
  invalidTimestampCheckpoint.checks.completedAt = 'not-a-timestamp';
  await writeFile(path.join(invalidTimestamp.root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(invalidTimestampCheckpoint));
  await assert.rejects(invalidTimestamp.invoke('status'), { code: 'CHECKPOINT_MISMATCH' });

  const unknownPhase = await fixture(t);
  await unknownPhase.invoke('start');
  const unknownPhaseCheckpoint = await unknownPhase.state();
  unknownPhaseCheckpoint.phase = 'unknown';
  await writeFile(path.join(unknownPhase.root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(unknownPhaseCheckpoint));
  await assert.rejects(unknownPhase.invoke('status'), { code: 'CHECKPOINT_MISMATCH' });
});

test('documentation checks map malformed task contracts to a typed failure', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kineo-harness-docs-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of REQUIRED_DOCUMENT_PATHS) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'fixture\n');
  }
  await mkdir(path.join(root, 'docs/agent-tasks'), { recursive: true });
  await writeFile(path.join(root, 'docs/agent-tasks/malformed.json'), '{');
  await assert.rejects(checkDocs(root), { code: 'INVALID_TASK' });
});

test('documentation checks map missing paths to typed failures', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kineo-harness-missing-docs-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(checkDocs(root), (error) => {
    assert.equal(error.code, 'DOCS_FAILED');
    assert.equal(error.cause?.code, 'ENOENT');
    return true;
  });

  for (const file of REQUIRED_DOCUMENT_PATHS) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), 'fixture\n');
  }
  await assert.rejects(checkDocs(root), (error) => {
    assert.equal(error.code, 'DOCS_FAILED');
    assert.equal(error.cause?.code, 'ENOENT');
    return true;
  });
});

test('checkpoint data and its directory use private modes', async (t) => {
  const { root, invoke } = await fixture(t);
  await invoke('start');
  const directory = path.join(root, '.agent-runs/fixture');
  assert.equal((await stat(directory)).mode & FILE_MODE_MASK, PRIVATE_DIRECTORY_MODE);
  assert.equal((await stat(path.join(directory, 'checkpoint.json'))).mode & FILE_MODE_MASK, PRIVATE_FILE_MODE);
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
  checkpoint.reservedMs = FIXTURE_MINUTE_MS;
  await writeFile(path.join(root, '.agent-runs/fixture/checkpoint.json'), JSON.stringify(checkpoint));
  await assert.rejects(invoke('check'), { code: 'LIMIT_REACHED' });
});

test('process runner reports spawn failure and terminates a timed-out process', async () => {
  await assert.rejects(runCommand('kineo-nonexistent-executable', [], { cwd: tmpdir(), timeoutMs: TEST_TIMEOUT_MS }), { code: 'COMMAND_FAILED' });
  await assert.rejects(runCommand(process.execPath, ['-e', `setInterval(() => {}, ${PROCESS_KEEPALIVE_INTERVAL_MS})`],
    { cwd: tmpdir(), timeoutMs: TEST_TIMEOUT_MS }), { code: 'TIMEOUT' });
});

test('checkpoint and lock cleanup failures preserve primary error and close traces', async (t) => {
  const { root, invoke, state } = await fixture(t);
  await invoke('start');
  const directory = path.join(root, '.agent-runs/fixture');
  let traceFd;
  try {
    await assert.rejects(invoke('agent', { run: async (_command, _args, options) => {
      traceFd = options.outputFd;
      await chmod(directory, RESTRICTED_DIRECTORY_MODE);
      return { code: 1 };
    } }), (error) => {
      assert.equal(error.code, 'AGENT_FAILED');
      assert.deepEqual(error.cleanupFailures.map((failure) => failure.code), ['CHECKPOINT_FAILED', 'CLEANUP_FAILED']);
      return true;
    });
    assert.throws(() => fstatSync(traceFd), { code: 'EBADF' });
    assert.equal((await state()).phase, 'running', 'Pre-launch reservation remains conservative on disk');
  } finally {
    await chmod(directory, PRIVATE_DIRECTORY_MODE);
  }
});

test('timeout kills stubborn descendants even after their leader exits', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kineo-harness-process-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'child.pid');
  const heartbeatFile = path.join(root, 'heartbeat');
  const descendant = `process.on('SIGTERM', () => {});
    setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(heartbeatFile)}, '.'), ${HEARTBEAT_INTERVAL_MS});`;
  const leader = `const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
    require('node:fs').writeFileSync(process.argv[1], String(child.pid));
    setInterval(() => {}, ${PROCESS_KEEPALIVE_INTERVAL_MS});`;
  await assert.rejects(runCommand(process.execPath, ['-e', leader, pidFile],
    { cwd: root, timeoutMs: DESCENDANT_START_TIMEOUT_MS }), { code: 'TIMEOUT' });
  const pid = Number(await readFile(pidFile, 'utf8'));
  t.after(() => {
    try { process.kill(pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  const stoppedHeartbeat = await readFile(heartbeatFile, 'utf8');
  assert.ok(stoppedHeartbeat.length > 0, 'Descendant ran before the deadline');
  await new Promise((resolve) => setTimeout(resolve, TEST_TIMEOUT_MS));
  assert.equal(await readFile(heartbeatFile, 'utf8'), stoppedHeartbeat, 'Descendant kept writing after timeout');
});
