const { fileURLToPath } = require('node:url');
const path = require('node:path');
function trustedPage(url, indexPath) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' && path.resolve(fileURLToPath(parsed)).toLowerCase() === path.resolve(indexPath).toLowerCase();
  } catch { return false; }
}
function assertSender(event, knownWindows, indexPath, allowedRoles) {
  const entry = knownWindows.get(event.sender.id);
  const expectedPath = entry?.role === 'roller' ? path.join(path.dirname(indexPath), 'roller.html') : indexPath;
  if (!entry || entry.win.isDestroyed() || event.senderFrame !== event.sender.mainFrame || !trustedPage(event.senderFrame.url, expectedPath) || !allowedRoles.includes(entry.role)) throw new Error('此窗口无权执行此操作');
  return entry;
}
module.exports = { trustedPage, assertSender };
