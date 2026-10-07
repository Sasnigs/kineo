import path from 'node:path';
import { checkDocs, CHECK_PROFILES, HarnessError, runCommand } from './agent-task.mjs';

const CHECK_TIMEOUT_MS = 30 * 60_000;
const root = process.cwd();
const profiles = [...new Set(process.argv.slice(2))];
try {
  if (!profiles.length || !profiles.every((profile) => CHECK_PROFILES.includes(profile))) {
    throw new HarnessError('INVALID_PROFILE', `Choose one or more: ${CHECK_PROFILES.join(', ')}.`);
  }
  const commands = [];
  if (profiles.includes('docs') || profiles.includes('tooling')) {
    await checkDocs(root);
    console.log('PASS docs: repository entry points and task contracts');
  }
  if (profiles.includes('tooling')) commands.push([process.execPath, ['--test', 'Scripts/tests/agent-task.test.mjs'], root]);
  if (profiles.includes('mobile')) {
    for (const script of ['typecheck', 'lint', 'test:ci']) commands.push(['npm', ['run', script], path.join(root, 'apps/mobile')]);
  }
  if (profiles.includes('database')) commands.push([process.execPath, ['Scripts/test-account-api.mjs'], root]);
  for (const [command, args, cwd] of commands) {
    // Join the controller's process group so its deadline also terminates nested checks.
    const result = await runCommand(command, args, { cwd, timeoutMs: CHECK_TIMEOUT_MS, ownProcessGroup: false });
    if (result.code !== 0) throw new HarnessError('CHECK_FAILED', `${command} ${args.join(' ')} failed.`);
  }
  console.log(`PASS profiles: ${profiles.join(', ')}`);
} catch (error) {
  console.error(`${error.code ?? 'CHECK_FAILED'}: ${error.message}`);
  process.exitCode = 1;
}
