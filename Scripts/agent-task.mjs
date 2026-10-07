import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, rm, lstat, open, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MINUTE_MS = 60_000;
const MAX_AGENT_TURNS = 3;
const MAX_TASK_MINUTES = 60;
const AGENT_TURN_TIMEOUT_MS = 5 * MINUTE_MS;
const TERMINATION_GRACE_MS = 1_000;
const CHECKPOINT_VERSION = 1;
const COMMIT_SHA_HEX_LENGTH = 40;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const COMMIT_SHA_PATTERN = new RegExp(`^[a-f0-9]{${COMMIT_SHA_HEX_LENGTH}}$`);
export const CHECK_PROFILES = ['docs', 'tooling', 'mobile', 'database'];

export class HarnessError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'HarnessError';
    this.code = code;
  }
}

const fail = (code, message, cause) => { throw new HarnessError(code, message, cause); };
const parseJson = (raw, code, message) => {
  try { return JSON.parse(raw); }
  catch (cause) { fail(code, message, cause); }
};
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const safePath = (value) => nonempty(value) && !value.includes('\\') && !/[\x00-\x1f*?\[\]]/.test(value)
  && !path.posix.isAbsolute(value) && value.split('/').every((part) => part && part !== '.' && part !== '..')
  && !value.split('/').some((part) => ['.git', '.agent-runs', '.codex', '.agents'].includes(part));

export function validateTask(task) {
  if (!task || !nonempty(task.id) || !/^[a-z0-9][a-z0-9-]*$/.test(task.id) || !nonempty(task.goal)
    || !COMMIT_SHA_PATTERN.test(task.base)
    || !Array.isArray(task.scope) || !task.scope.length || !task.scope.every(safePath)
    || new Set(task.scope).size !== task.scope.length
    || !Array.isArray(task.acceptance) || !task.acceptance.length || !task.acceptance.every(nonempty)
    || !Array.isArray(task.checks) || !task.checks.length || !task.checks.every((name) => CHECK_PROFILES.includes(name))
    || !Number.isInteger(task.limits?.agentTurns) || task.limits.agentTurns < 1 || task.limits.agentTurns > MAX_AGENT_TURNS
    || !Number.isInteger(task.limits?.minutes) || task.limits.minutes < 1 || task.limits.minutes > MAX_TASK_MINUTES) {
    fail('INVALID_TASK', 'Task requires exact safe paths, criteria, known checks, a pinned base, and bounded limits.');
  }
  return task;
}

function git(root, ...args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (cause) { fail('GIT_FAILED', 'Git precondition failed; inspect branch and base commit.', cause); }
}

async function assertNoSymlinks(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail('SCOPE_DRIFT', `Symlink is not permitted: ${relative}`);
    } catch (error) {
      if (error.code === 'ENOENT') return; // New or deleted scoped files are valid.
      throw error;
    }
  }
}

async function fingerprint(root, task) {
  const changed = git(root, 'diff', '--no-renames', '--name-only', '-z', task.base).split('\0').filter(Boolean);
  const staged = git(root, 'diff', '--cached', '--no-renames', '--name-only', '-z', task.base).split('\0').filter(Boolean);
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const files = [...new Set([...changed, ...staged, ...untracked])].sort();
  const outside = files.filter((file) => !task.scope.includes(file));
  if (outside.length) fail('SCOPE_DRIFT', `Unapproved changes: ${outside.join(', ')}`);
  const content = [git(root, 'rev-parse', 'HEAD'), git(root, 'diff', '--no-renames', '--binary', task.base),
    git(root, 'diff', '--cached', '--no-renames', '--binary', task.base)];
  for (const file of files) {
    await assertNoSymlinks(root, file);
    try { content.push(file, hash(await readFile(path.join(root, file)))); }
    catch (error) {
      if (error.code === 'ENOENT') content.push(file, 'deleted');
      else throw error;
    }
  }
  return hash(JSON.stringify(content));
}

export function runCommand(command, args, { cwd, timeoutMs, outputFd, ownProcessGroup = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: ownProcessGroup, stdio: ['ignore', outputFd ?? 'inherit', outputFd ?? 'inherit'] });
    let timedOut = false;
    let forceTimer;
    const stop = (signal) => {
      if (!child.pid) return;
      try { if (ownProcessGroup) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') reject(new HarnessError('COMMAND_FAILED', 'Could not stop command group.', error)); }
    };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      forceTimer = setTimeout(() => {
        stop('SIGKILL');
        reject(new HarnessError('TIMEOUT', `${command} exceeded its runtime allowance.`));
      }, TERMINATION_GRACE_MS);
    }, timeoutMs);
    child.once('error', (cause) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      reject(new HarnessError('COMMAND_FAILED', `Cannot start ${command}.`, cause));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      // The leader can exit before a stubborn descendant. Keep group escalation
      // and do not release the task lock until SIGKILL has been sent.
      if (!timedOut) { clearTimeout(forceTimer); resolve({ code, signal }); }
    });
  });
}

async function save(checkpointPath, state) {
  const temporary = `${checkpointPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
  await rename(temporary, checkpointPath);
}

async function cleanup(operation, primaryError, code, message) {
  try { await operation(); }
  catch (cause) {
    const failure = new HarnessError(code, message, cause);
    if (!primaryError) return failure;
    // Preserve the action failure, but surface every failed cleanup. The safe
    // state is a retained checkpoint/reservation and a lock requiring inspection.
    primaryError.cleanupFailures ??= [];
    primaryError.cleanupFailures.push(failure);
    primaryError.message += ` ${message}`;
  }
  return primaryError;
}

/** Public task boundary. Infrastructure failures are mapped here once. */
export async function executeTask(action, taskFile, { root = process.cwd(), run = runCommand, phase = 'implement', now = Date.now } = {}) {
  let lock;
  let primaryError;
  try {
    if (!['start', 'status', 'check', 'agent'].includes(action) || !safePath(taskFile)) fail('INVALID_TASK', 'Use start, status, check, or agent with a relative task path.');
    await assertNoSymlinks(root, taskFile);
    const raw = await readFile(path.join(root, taskFile), 'utf8');
    const task = validateTask(parseJson(raw, 'INVALID_TASK', 'Task contract is not valid JSON.'));
    const branch = git(root, 'branch', '--show-current').trim();
    if (!branch || ['main', 'master'].includes(branch)) fail('UNSAFE_BRANCH', 'Use a dedicated feature branch, not main or detached HEAD.');
    git(root, 'merge-base', '--is-ancestor', task.base, 'HEAD');
    const directory = path.join(root, '.agent-runs', task.id);
    await assertNoSymlinks(root, `.agent-runs/${task.id}`);
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const checkpointPath = path.join(directory, 'checkpoint.json');
    await assertNoSymlinks(root, `.agent-runs/${task.id}/checkpoint.json`);
    await assertNoSymlinks(root, `.agent-runs/${task.id}/checkpoint.json.tmp`);
    if (action !== 'status') {
      const candidate = path.join(directory, 'run.lock');
      try { await mkdir(candidate); lock = candidate; }
      catch (cause) { if (cause.code === 'EEXIST') fail('BUSY', 'Task is locked. Inspect the active process before recovery.'); throw cause; }
    }
    let state;
    try {
      state = parseJson(await readFile(checkpointPath, 'utf8'), 'CHECKPOINT_MISMATCH',
        'Checkpoint is corrupt; do not reuse its evidence.');
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (action !== 'start') fail('NOT_STARTED', 'Start the approved task before continuing.');
      state = { version: CHECKPOINT_VERSION, taskHash: hash(raw), branch, agentTurns: 0, reservedMs: 0, checks: null, phase: 'started' };
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || state.version !== CHECKPOINT_VERSION || state.taskHash !== hash(raw) || state.branch !== branch
      || !Number.isFinite(state.reservedMs) || state.reservedMs < 0 || !Number.isInteger(state.agentTurns) || state.agentTurns < 0) {
      fail('CHECKPOINT_MISMATCH', 'Checkpoint does not match this contract and branch; do not reuse its evidence.');
    }
    const before = await fingerprint(root, task);
    if (state.checks?.fingerprint !== before) {
      state.checks = null;
      if (state.phase === 'checks-passed') state.phase = 'needs-checks-and-review';
    }
    if (action === 'status') return { ...state, checksCurrent: state.checks !== null, independentReviewRequired: true };
    if (action === 'start') { await save(checkpointPath, state); return state; }
    if (action === 'agent' && !['implement', 'review'].includes(phase)) fail('INVALID_TASK', 'Agent phase must be implement or review.');
    const remainingMs = task.limits.minutes * MINUTE_MS - state.reservedMs;
    if (remainingMs <= 0 || (action === 'agent' && state.agentTurns >= task.limits.agentTurns)) fail('LIMIT_REACHED', 'Task allowance exhausted. Preserve checkpoint and report the next action.');
    const allowance = action === 'agent' ? Math.min(AGENT_TURN_TIMEOUT_MS, remainingMs) : remainingMs;
    state.phase = 'running';
    state.checks = null;
    state.reservedMs += allowance; // Persist before launch: a killed coordinator cannot replenish the allowance.
    if (action === 'agent') state.agentTurns += 1;
    await save(checkpointPath, state);
    const started = now();
    let trace;
    let actionError;
    try {
      let result;
      let commandError;
      try {
        if (action === 'check') {
          result = await run(process.execPath, ['Scripts/agent-check.mjs', '--controller-group', ...task.checks], { cwd: root, timeoutMs: allowance });
        } else {
          const prompt = `You are the ${phase} agent for one approved Kineo task. Read AGENTS.md and owning contracts.\n`
            + `${raw}\nOnly edit the exact scope above. Do not edit the task, commit, push, merge, install dependencies, or change production services.\n`
            + (phase === 'review' ? 'Review the diff against the base. Do not edit. Report blockers with file/evidence and acceptance gaps.'
              : 'Implement the smallest correct change. Check factual claims against existing evidence. Report changes, tests, and open gates.');
          await writeFile(path.join(directory, `turn-${state.agentTurns}-prompt.txt`), prompt, { mode: PRIVATE_FILE_MODE });
          trace = await open(path.join(directory, `turn-${state.agentTurns}.jsonl`), 'wx', PRIVATE_FILE_MODE);
          result = await run('codex', ['exec', '--sandbox', phase === 'review' ? 'read-only' : 'workspace-write', '--json',
            '--output-last-message', path.join(directory, `turn-${state.agentTurns}-result.txt`), prompt],
          { cwd: root, timeoutMs: allowance, outputFd: trace.fd });
        }
      } catch (error) {
        commandError = error;
      }
      const after = await fingerprint(root, task);
      if (commandError) throw commandError;
      if (result.code !== 0) fail(action === 'check' ? 'CHECK_FAILED' : 'AGENT_FAILED', 'Command failed; no passing evidence was recorded.');
      if (action === 'check' && before !== after) fail('STALE_CHECK', 'Files changed while checks ran; rerun against stable code.');
      if (action === 'agent' && phase === 'review' && before !== after) fail('SCOPE_DRIFT', 'Read-only review changed files.');
      state.phase = action === 'check' ? 'checks-passed' : 'needs-checks-and-review';
      if (action === 'check') state.checks = { fingerprint: after, profiles: task.checks, completedAt: new Date(now()).toISOString() };
    } catch (error) {
      state.phase = 'failed';
      state.checks = null;
      actionError = error;
    } finally {
      state.reservedMs -= allowance - Math.min(allowance, Math.max(0, now() - started));
      actionError = await cleanup(() => save(checkpointPath, state), actionError, 'CHECKPOINT_FAILED',
        'Checkpoint write failed; do not trust prior evidence.');
      if (trace) actionError = await cleanup(() => trace.close(), actionError, 'CLEANUP_FAILED', 'Trace closure failed.');
    }
    if (actionError) throw actionError;
    return state;
  } catch (error) {
    primaryError = error instanceof HarnessError ? error : new HarnessError('COMMAND_FAILED',
      'Harness could not complete; inspect its checkpoint and environment.', error);
    throw primaryError;
  } finally {
    if (lock) {
      const failure = await cleanup(() => rm(lock, { recursive: true }), primaryError, 'CLEANUP_FAILED',
        'Task lock removal failed; inspect processes before recovery.');
      if (failure && !primaryError) throw failure;
    }
  }
}

export async function checkDocs(root) {
  try {
    const required = ['AGENTS.md', 'docs/STATUS.md', 'docs/agents/HARNESS.md', 'docs/agents/issue-tracker.md',
      'docs/KINEO_PRODUCT_DESIGN.md', 'docs/KINEO_IMPLEMENTATION_MILESTONES.md', 'docs/technical/00_TECHNICAL_DESIGN_INDEX.md'];
    for (const file of required) {
      if (!(await readFile(path.join(root, file), 'utf8')).trim()) fail('DOCS_FAILED', `Missing or empty entry point: ${file}`);
    }
    for (const file of await readdir(path.join(root, 'docs/agent-tasks'))) {
      if (file.endsWith('.json')) {
        const raw = await readFile(path.join(root, 'docs/agent-tasks', file), 'utf8');
        validateTask(parseJson(raw, 'INVALID_TASK', `Task contract is not valid JSON: ${file}`));
      }
    }
  } catch (cause) {
    if (cause instanceof HarnessError) throw cause;
    fail('DOCS_FAILED', 'Documentation validation could not read required paths.', cause);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, taskFile, phase] = process.argv.slice(2);
  try { console.log(JSON.stringify(await executeTask(action, taskFile, { phase: phase ?? 'implement' }), null, 2)); }
  catch (error) { console.error(`${error.code}: ${error.message}`); process.exitCode = 1; }
}
