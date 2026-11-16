// End-to-end check of the networking core without Electron: two "devices" in one process
// find each other over UDP, then one sends a folder and a file to the other.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Discovery } = require('../src/main/discovery');
const { TransferServer, sendFiles, sendText, safeSegments, DeclinedError, MAX_TEXT_BYTES } = require('../src/main/transfer');

const TEST_PORT = 47899;

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function makeDevice(name, inbox, decide) {
  const server = new TransferServer({ decide, downloadDir: () => inbox });
  const port = await server.start();
  const self = { id: crypto.randomUUID(), name, platform: process.platform, port };
  const discovery = new Discovery(self, { port: TEST_PORT });
  discovery.start();
  return { self, server, discovery };
}

function waitForPeer(device, id, ms = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${device.self.name} never saw the other device`)), ms);
    const check = () => {
      const peer = device.discovery.get(id);
      if (peer) {
        clearTimeout(timer);
        device.discovery.off('change', check);
        resolve(peer);
      }
    };
    device.discovery.on('change', check);
    check();
  });
}

async function main() {
  // Unsafe peer paths must never resolve outside the download folder.
  assert.equal(safeSegments('../evil.txt'), null);
  assert.equal(safeSegments('a/../../b'), null);
  assert.deepEqual(safeSegments('/etc/passwd'), ['etc', 'passwd']);
  assert.deepEqual(safeSegments('C:\\Windows\\x'), ['C_', 'Windows', 'x']);
  assert.deepEqual(safeSegments('notes:v2.txt'), ['notes_v2.txt']);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-smoke-'));
  const outbox = path.join(tmp, 'outbox');
  const inbox = path.join(tmp, 'inbox');
  fs.mkdirSync(path.join(outbox, 'Album', 'Nested', 'Empty'), { recursive: true });
  fs.writeFileSync(path.join(outbox, 'Album', 'a.bin'), crypto.randomBytes(3 * 1024 * 1024 + 17));
  fs.writeFileSync(path.join(outbox, 'Album', 'Nested', 'b.txt'), 'привет, Mac');
  fs.writeFileSync(path.join(outbox, 'Album', '.DS_Store'), 'junk');
  fs.writeFileSync(path.join(outbox, 'single.txt'), 'hello');

  let accept = true;
  const mac = await makeDevice('Test Mac', path.join(tmp, 'unused'), async () => true);
  const pc = await makeDevice('Test PC', inbox, async () => accept);

  try {
    const peer = await waitForPeer(mac, pc.self.id);
    await waitForPeer(pc, mac.self.id);
    console.log(`discovery ok: Mac sees ${peer.name} at ${peer.address}:${peer.port}`);

    const events = [];
    for (const type of ['start', 'progress', 'done', 'failed']) pc.server.on(type, (e) => events.push({ type, ...e }));

    const paths = [path.join(outbox, 'Album'), path.join(outbox, 'single.txt')];
    const progress = [];
    const result = await sendFiles({ peer, from: mac.self, paths, onProgress: (p) => progress.push(p) });
    assert.equal(result.fileCount, 3);
    assert.equal(progress.at(-1).sent, progress.at(-1).total);

    // Give the receiver a tick to emit 'done' after the last upload's response.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(hash(path.join(inbox, 'Album', 'a.bin')), hash(path.join(outbox, 'Album', 'a.bin')));
    assert.equal(fs.readFileSync(path.join(inbox, 'Album', 'Nested', 'b.txt'), 'utf8'), 'привет, Mac');
    assert.ok(fs.existsSync(path.join(inbox, 'Album', 'Nested', 'Empty')));
    assert.ok(!fs.existsSync(path.join(inbox, 'Album', '.DS_Store')));
    assert.ok(events.some((e) => e.type === 'done' && e.fileCount === 3));
    console.log('transfer ok: folder + file arrived intact');

    // Sending the same things again must not overwrite: they land as "Album (1)" etc.
    await sendFiles({ peer, from: mac.self, paths });
    assert.ok(fs.existsSync(path.join(inbox, 'Album (1)', 'a.bin')));
    assert.ok(fs.existsSync(path.join(inbox, 'single (1).txt')));
    console.log('collision ok: second copy renamed');

    accept = false;
    await assert.rejects(sendFiles({ peer, from: mac.self, paths }), DeclinedError);
    console.log('decline ok');

    // Text arrives whole, whatever the script, and needs no accepting.
    const messages = [];
    pc.server.on('message', (m) => messages.push(m));
    const text = '안녕하세요, PC 👋\n  second line\twith a tab\n';
    await sendText({ peer, from: mac.self, text });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, text);
    assert.equal(messages[0].from.id, mac.self.id);
    assert.equal(messages[0].from.name, 'Test Mac');
    console.log('text ok: arrived intact');

    // Too much text is refused on both ends, and so is nothing at all.
    const huge = 'x'.repeat(MAX_TEXT_BYTES + 1);
    await assert.rejects(sendText({ peer, from: mac.self, text: huge }), { code: 'TOO_LONG' });
    const post = (body) =>
      fetch(`http://${peer.address}:${peer.port}/message`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ id: 'big', from: mac.self, text: huge })).status, 413);
    assert.equal((await post({ id: 'blank', from: mac.self, text: '  \n' })).status, 400);
    assert.equal((await post({ id: 'anon', text: 'hi' })).status, 400);
    assert.equal(messages.length, 1);
    console.log('text limits ok');

    // A Hop from before text existed answers 404; the sender is told to update it.
    const old = http.createServer((req, res) => res.writeHead(404).end('{}'));
    await new Promise((resolve) => old.listen(0, '127.0.0.1', resolve));
    try {
      const oldPeer = { address: '127.0.0.1', port: old.address().port, name: 'Old Mac' };
      await assert.rejects(sendText({ peer: oldPeer, from: mac.self, text: 'hi' }), { code: 'UNSUPPORTED', message: /Update Hop on Old Mac/ });
    } finally {
      old.close();
    }
    console.log('old peer ok');

    console.log('\nAll smoke tests passed.');
  } finally {
    for (const device of [mac, pc]) {
      device.discovery.stop();
      device.server.stop();
    }
    setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 300);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 500);
});
