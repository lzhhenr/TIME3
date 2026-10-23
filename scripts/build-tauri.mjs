import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'tauri-dist');
const built = spawnSync(process.execPath, [path.join(root, 'build.mjs')], {
  cwd: root, stdio: 'inherit', windowsHide: true,
});
if (built.error) throw built.error;
if (built.status !== 0) throw Error(`Frontend build failed (${built.status})`);

// Only this dedicated generated directory is ever replaced.
if (path.dirname(output) !== root || path.basename(output) !== 'tauri-dist') {
  throw Error('Invalid Tauri frontend output directory');
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const files = [
  'app.js', 'calendar.mjs', 'i18n.mjs', 'mini.mjs', 'sound.mjs', 'style.css',
  'scene.bundle.js', 'observances.bundle.js', 'roller.bundle.js', 'roller.css',
  'tauri-bridge.js', 'LUNAR-LICENSE.md', 'THIRD_PARTY_NOTICES.md',
];
for (const name of files) await fs.copyFile(path.join(root, name), path.join(output, name));
await fs.cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
for (const name of ['index.html', 'roller.html']) {
  let html = await fs.readFile(path.join(root, name), 'utf8');
  // Tauri provides its IPC origin; the normal browser and Electron CSP stays intact.
  html = html.replace(/connect-src (?:'none'|'self')/,
    "connect-src 'self' ipc: http://ipc.localhost");
  const entry = '<script type="module"';
  if (!html.includes(entry)) throw Error(`No application entry script in ${name}`);
  html = html.replace(entry, '<script src="tauri-bridge.js"></script>\n  ' + entry);
  await fs.writeFile(path.join(output, name), html);
}
console.log(`Tauri frontend ready: ${output}`);
