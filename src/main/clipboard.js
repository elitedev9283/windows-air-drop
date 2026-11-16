const { clipboard } = require('electron');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');

const FILES = 'text/uri-list';
const IMAGE = 'image/png';
const TEXT = 'text/plain';

// What's on the clipboard, in the order Hop cares about it:
//   { kind: 'files', paths }   files or folders copied in Explorer / Finder
//   { kind: 'image', png }     a bitmap, e.g. a screenshot, as a PNG Buffer
//   { kind: 'text', text }
//   { kind: 'empty' }
// Files come first: Finder also puts the file's name on the clipboard as text, and its icon
// as an image.
//
// With `peek`, only the kind is wanted (it runs every time the window gets focus), so the
// image and text themselves are never fetched.
async function readClipboard({ peek = false } = {}) {
  const items = await clipboard.read();
  const read = async (type) => {
    const item = items.find((entry) => entry.types.includes(type));
    return item ? Buffer.from(await (await item.getType(type)).arrayBuffer()) : null;
  };
  const has = (type) => items.some((entry) => entry.types.includes(type));

  const paths = localFiles(await read(FILES));
  if (paths.length) return { kind: 'files', paths };

  if (has(IMAGE)) {
    if (peek) return { kind: 'image' };
    const png = await read(IMAGE);
    if (png?.length) return { kind: 'image', png };
  }

  if (has(TEXT)) {
    const text = (await read(TEXT)).toString('utf8');
    if (text.trim()) return peek ? { kind: 'text' } : { kind: 'text', text };
  }

  return { kind: 'empty' };
}

// The paths in a copied URI list that are files or folders still on this computer.
// A list of web links (copied from a browser) has none, and falls through to text.
function localFiles(list) {
  const paths = [];
  for (const line of String(list || '').split(/\r?\n/)) {
    if (!line.startsWith('file://')) continue;
    try {
      const file = fileURLToPath(line.trim());
      if (fs.existsSync(file)) paths.push(file);
    } catch {
      // Not a local file URL; skip it.
    }
  }
  return paths;
}

module.exports = { readClipboard };
