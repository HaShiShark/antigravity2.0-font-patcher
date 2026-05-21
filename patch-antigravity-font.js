#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const DEFAULT_INSTALL_DIR = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'Programs',
  'antigravity'
);
const PATCH_START = '/* antigravity-font-patcher:start */';
const PATCH_END = '/* antigravity-font-patcher:end */';

function usage() {
  console.log(`Usage:
  node patch-antigravity-font.js --font "思源宋体"
  node patch-antigravity-font.js --font "Source Han Serif SC" --install-dir "C:\\Users\\you\\AppData\\Local\\Programs\\antigravity"
  node patch-antigravity-font.js --restore

Options:
  --font <name>          Font family to inject globally.
  --fallback <list>      Extra CSS font fallback list. Default: "Source Han Serif SC", "Noto Serif CJK SC", serif
  --install-dir <path>   Antigravity install directory. Default: ${DEFAULT_INSTALL_DIR}
  --restore              Restore the newest app.asar.bak-* backup.
  --interactive          Prompt for options in the terminal.
  --keep-temp            Keep extracted temporary files for debugging.
  --no-process-check     Do not check whether Antigravity is running.
  --help                 Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    installDir: DEFAULT_INSTALL_DIR,
    fallback: '"Source Han Serif SC", "Noto Serif CJK SC", serif',
    keepTemp: false,
    restore: false,
    interactive: argv.length === 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--font') args.font = argv[++i];
    else if (arg === '--fallback') args.fallback = argv[++i];
    else if (arg === '--install-dir') args.installDir = argv[++i];
    else if (arg === '--restore') args.restore = true;
    else if (arg === '--interactive') args.interactive = true;
    else if (arg === '--keep-temp') args.keepTemp = true;
    else if (arg === '--no-process-check') args.noProcessCheck = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return args;
}

function run(command, args, options = {}) {
  const candidates = process.platform === 'win32' && command === 'npx'
    ? ['npx.cmd', 'npx']
    : [command];
  let lastResult;

  for (const executable of candidates) {
    const result = spawnSync(executable, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });
    if (!result.error && result.status === 0) return;
    lastResult = result;
  }

  if (lastResult?.error?.code === 'ENOENT') {
    const result = spawnSync(command, args, {
      stdio: 'inherit',
      shell: true,
      ...options,
    });
    if (result.status === 0) return;
  }

  throw new Error(`Command failed: ${command} ${args.join(' ')}`);
}

async function extractAsar(appAsar, tempDir) {
  try {
    const asar = require('@electron/asar');
    asar.extractAll(appAsar, tempDir);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    run('npx', ['--yes', '@electron/asar', 'extract', appAsar, tempDir]);
  }
}

async function packAsar(tempDir, appAsar) {
  try {
    const asar = require('@electron/asar');
    await asar.createPackage(tempDir, appAsar);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    run('npx', ['--yes', '@electron/asar', 'pack', tempDir, appAsar]);
  }
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForEnter() {
  await ask('\nPress Enter to exit...');
}

async function fillInteractiveArgs(args) {
  console.log('Antigravity 2.0 Font Patcher');
  console.log(`Install dir: ${args.installDir}`);
  console.log('Close Antigravity before continuing.\n');

  const action = await ask('Choose action: [1] Patch font  [2] Restore backup  (default: 1): ');
  if (action === '2') {
    args.restore = true;
    return args;
  }

  const font = await ask('Font name (default: 思源宋体): ');
  args.font = font || '思源宋体';
  return args;
}

function cssString(value) {
  return JSON.stringify(String(value));
}

function getAppAsarPath(installDir) {
  return path.join(installDir, 'resources', 'app.asar');
}

function ensureAntigravityNotRunning() {
  if (process.platform !== 'win32') return;

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Process Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Id',
  ], { encoding: 'utf8', shell: false });

  if (result.stdout.trim()) {
    throw new Error('Antigravity is running. Close it before patching app.asar.');
  }
}

function newestBackup(resourcesDir) {
  const backups = fs.readdirSync(resourcesDir)
    .filter((name) => name.startsWith('app.asar.bak-'))
    .map((name) => ({
      name,
      path: path.join(resourcesDir, name),
      mtimeMs: fs.statSync(path.join(resourcesDir, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return backups[0];
}

function restoreBackup(installDir, noProcessCheck) {
  if (!noProcessCheck) ensureAntigravityNotRunning();

  const appAsar = getAppAsarPath(installDir);
  const resourcesDir = path.dirname(appAsar);
  const backup = newestBackup(resourcesDir);
  if (!backup) throw new Error(`No backup found in ${resourcesDir}`);

  fs.copyFileSync(backup.path, appAsar);
  console.log(`Restored ${backup.name} -> app.asar`);
}

function patchUtilsJs(utilsJsPath, font, fallback) {
  let source = fs.readFileSync(utilsJsPath, 'utf8');
  source = source.replace(
    new RegExp(`\\n?    ${escapeRegExp(PATCH_START)}[\\s\\S]*?    ${escapeRegExp(PATCH_END)}\\n?`, 'g'),
    '\n'
  );

  const needle = '    (0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);\n';
  if (!source.includes(needle)) {
    throw new Error('Could not find BrowserWindow injection point in dist/utils.js.');
  }

  const family = `${cssString(font)}, ${fallback}`;
  const patch = `${needle}    ${PATCH_START}\n    const globalFontCss = \`\n      html, body, body *, input, textarea, select, button {\n        font-family: ${family} !important;\n      }\n    \`;\n    win.webContents.on('did-finish-load', () => {\n        void win.webContents.insertCSS(globalFontCss, { cssOrigin: 'user' });\n    });\n    ${PATCH_END}\n`;

  source = source.replace(needle, patch);
  fs.writeFileSync(utilsJsPath, source, 'utf8');
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function patchApp(args) {
  if (!args.font) throw new Error('Missing --font <name>.');
  if (!args.noProcessCheck) ensureAntigravityNotRunning();

  const appAsar = getAppAsarPath(args.installDir);
  if (!fs.existsSync(appAsar)) {
    throw new Error(`app.asar not found: ${appAsar}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-font-patcher-'));
  const backupPath = path.join(path.dirname(appAsar), `app.asar.bak-${timestamp()}`);

  try {
    console.log(`Extracting ${appAsar}`);
    await extractAsar(appAsar, tempDir);

    const utilsJsPath = path.join(tempDir, 'dist', 'utils.js');
    if (!fs.existsSync(utilsJsPath)) {
      throw new Error('dist/utils.js not found after extracting app.asar.');
    }

    patchUtilsJs(utilsJsPath, args.font, args.fallback);

    console.log(`Backing up original app.asar -> ${backupPath}`);
    fs.copyFileSync(appAsar, backupPath);

    console.log(`Packing patched app.asar`);
    await packAsar(tempDir, appAsar);

    console.log(`Done. Restart Antigravity to use font: ${args.font}`);
  } finally {
    if (args.keepTemp) {
      console.log(`Kept temp directory: ${tempDir}`);
    } else {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let shouldPause = args.interactive;

  try {
    if (args.help) {
      usage();
      return;
    }
    if (args.interactive) await fillInteractiveArgs(args);
    if (args.restore) restoreBackup(args.installDir, args.noProcessCheck);
    else await patchApp(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    if (!shouldPause) process.exit(1);
  } finally {
    if (shouldPause) await waitForEnter();
  }
}

main();
