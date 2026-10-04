const path = require('node:path');
const { existsSync } = require('node:fs');
const { spawn } = require('node:child_process');
function launchCommand(platform = process.platform, env = process.env, exists = existsSync) {
  if (platform === 'darwin') return ['/usr/bin/open', ['-a', 'Ollama']];
  if (platform === 'win32') {
    const binary = env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe');
    return [binary && exists(binary) ? binary : 'ollama.exe', ['serve']];
  }
  return ['ollama', ['serve']];
}
async function probe() {
  try { return (await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(500) })).ok; }
  catch { return false; }
}
function launch() {
  const [command, args] = launchCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true, shell: false });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function ensureOllama({ check = probe, start = launch, wait = ms => new Promise(r => setTimeout(r, ms)), attempts = 12 } = {}) {
  if (await check()) return true;
  await start();
  for (let i = 0; i < attempts; i++) { await wait(250); if (await check()) return true; }
  return false;
}
module.exports = { launchCommand, ensureOllama };
