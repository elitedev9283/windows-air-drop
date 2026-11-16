// Stand-in for the Electron bridge so the UI can be opened in a plain browser to work on
// the design. Does nothing inside the app, where preload.js provides window.hop.
//
//   ?demo=live    no devices at first, one appears after a moment (default)
//   ?demo=empty   nobody around
//   ?demo=static  one device
//   ?demo=many    three devices, one of each kind
//   ?demo=offer   an incoming offer
//   ?demo=receive an incoming transfer starts right away
//   ?demo=burst   the hop burst fires ~600 ms after load, then every few seconds
//   ?demo=drag    files are held over the device (bridge, magnetic aura)
//   ?demo=drop    files are dragged in, dropped, and sent
//   ?demo=pick    the device is clicked and a file picked, so the chip flies from this device
//   ?demo=confirm-text | confirm-link | confirm-files | confirm-image
//                 the device is clicked with that on the clipboard: the "Send to …?" card
//   ?demo=send-text    the same, and Send is pressed
//   ?demo=message | message-link | message-long | messages
//                 text arrives from the device (messages: three in a row)
//   &platform=darwin|win32 picks which computer this is; the peer is the other one.
if (!window.hop) {
  const listeners = new Set();
  const emit = (event) => setTimeout(() => listeners.forEach((fn) => fn(event)), 0);
  const params = new URLSearchParams(location.search);
  const scenario = params.get('demo') || 'live';
  const onMac = params.get('platform') === 'darwin';

  const mac = { id: 'demo-mac', name: 'Lev’s MacBook Pro', platform: 'darwin', address: '192.168.0.12', port: 1 };
  const pc = { id: 'demo-pc', name: 'LEV-PC', platform: 'win32', address: '192.168.0.20', port: 1 };
  const imac = { id: 'demo-imac', name: 'Anna’s iMac', platform: 'darwin', address: '192.168.0.17', port: 1 };
  const nas = { id: 'demo-nas', name: 'studio-server', platform: 'linux', address: '192.168.0.31', port: 1 };
  const self = onMac ? mac : pc;
  const peer = onMac ? pc : mac;
  const downloads = onMac ? '/Users/lev/Downloads/Hop' : 'C:\\Users\\lev9e\\Downloads\\Hop';
  const sep = onMac ? '/' : '\\';
  const initialPeers = { empty: [], live: [], many: [peer, imac, nas] }[scenario] || [peer];

  const note = 'Wi‑Fi at the studio\nNetwork: Atelier‑5G\nPassword: correct horse battery staple';
  const link = 'https://github.com/0xCodez/hop/releases/latest';
  const essay = Array.from({ length: 14 }, (_, i) => `${i + 1}. Hop sends whatever you copied — a file, a screenshot, or a paragraph like this one — to the computer you click.`).join('\n\n');
  const desktop = onMac ? '/Users/lev/Desktop/' : 'C:\\Users\\lev9e\\Desktop\\';

  // A stand-in for a copied screenshot.
  function demoImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    const sky = ctx.createLinearGradient(0, 0, 640, 360);
    sky.addColorStop(0, '#5ee7ff');
    sky.addColorStop(0.5, '#3d8bff');
    sky.addColorStop(1, '#8b5cff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(60, 70, 520, 220, 18);
    ctx.fill();
    return canvas.toDataURL('image/png');
  }

  const clipboards = {
    'confirm-text': () => ({ kind: 'text', text: note }),
    'send-text': () => ({ kind: 'text', text: note }),
    'confirm-link': () => ({ kind: 'text', text: link }),
    'confirm-files': () => {
      const names = ['Vacation', 'notes.md', 'IMG_2041.HEIC', 'Budget 2026.xlsx'];
      return { kind: 'files', paths: names.map((name) => desktop + name), names, fileCount: 27, totalBytes: 24 * 1000 * 1000 };
    },
    'confirm-image': () => {
      const name = 'Clipboard 2026-11-15 at 14.32.05.png';
      return { kind: 'image', paths: [desktop + name], names: [name], fileCount: 1, totalBytes: 412 * 1000, width: 1920, height: 1080, preview: demoImage() };
    },
  };
  const readClipboard = clipboards[scenario] || (() => ({ kind: 'empty' }));
  const message = (id, text) => emit({ type: 'message', id, from: peer, text, at: Date.now() });

  function simulateSend(id, peerId, total) {
    let sent = 0;
    emit({ type: 'send-progress', id, peerId, stage: 'waiting', sent, total });
    setTimeout(() => {
      const timer = setInterval(() => {
        sent = Math.min(total, sent + total / 25);
        emit({ type: 'send-progress', id, peerId, stage: 'sending', sent, total });
        if (sent >= total) {
          clearInterval(timer);
          emit({ type: 'send-done', id, peerId, fileCount: 1, total });
        }
      }, 120);
    }, 1200);
  }

  function simulateReceive(id) {
    const total = 24 * 1000 * 1000;
    emit({ type: 'receive-start', id, from: peer, fileCount: 3, totalBytes: total });
    let sent = 0;
    const timer = setInterval(() => {
      sent = Math.min(total, sent + total / 20);
      emit({ type: 'receive-progress', id, from: peer, sent, total });
      if (sent >= total) {
        clearInterval(timer);
        emit({ type: 'receive-done', id, from: peer, fileCount: 3, totalBytes: total, paths: [`${downloads}${sep}Vacation`] });
      }
    }, 120);
  }

  // Real drag events with a real File, so the page's own drag & drop code runs.
  function drag(type, dataTransfer) {
    const avatar = document.querySelector('.peer .avatar');
    if (!avatar) return;
    const box = avatar.getBoundingClientRect();
    const clientX = box.left + box.width * 0.62;
    const clientY = box.top + box.height * 0.6;
    const target = document.elementFromPoint(clientX, clientY) || document.body;
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX, clientY, dataTransfer }));
  }

  function simulateDrag(dropAfter) {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['demo'], 'IMG_2041.HEIC', { type: 'image/heic' }));
    drag('dragenter', dataTransfer);
    drag('dragover', dataTransfer);
    if (dropAfter) setTimeout(() => drag('drop', dataTransfer), dropAfter);
  }

  window.hop = {
    init: async () => ({ self, peers: initialPeers, downloadDir: downloads, trustedCount: 0, theme: 'system' }),
    setTheme: async (theme) => theme,
    send: async (peerId) => {
      const id = `demo-${Date.now()}`;
      simulateSend(id, peerId, 48 * 1000 * 1000);
      return id;
    },
    readClipboard: async () => readClipboard(),
    peekClipboard: async () => ({ kind: readClipboard().kind }),
    sendText: async (peerId, text) => {
      const id = `demo-${Date.now()}`;
      emit({ type: 'send-progress', id, peerId, stage: 'waiting', sent: 0, total: text.length });
      setTimeout(() => emit({ type: 'send-done', id, peerId, fileCount: 0, total: text.length }), 500);
      return id;
    },
    copyText: async (text) => navigator.clipboard?.writeText(text).catch(() => {}),
    openLink: async (url) => window.open(url, '_blank', 'noopener'),
    cancel: async () => {},
    replyToOffer: async (id, accepted) => {
      if (accepted) simulateReceive(id);
    },
    pick: async () => [onMac ? '/Users/lev/Desktop/Keynote.key' : 'C:\\Users\\lev9e\\Desktop\\Keynote.key'],
    reveal: async () => {},
    openDownloads: async () => {},
    chooseDownloadDir: async () => downloads,
    rename: async (name) => name.trim(),
    forgetTrusted: async () => 0,
    pathForFile: (file) => file.name,
    onEvent: (fn) => {
      listeners.add(fn);
      if (scenario === 'live') setTimeout(() => emit({ type: 'peers', peers: [peer] }), 1400);
      if (scenario === 'offer') {
        setTimeout(
          () =>
            emit({
              type: 'offer',
              offer: { id: 'demo-offer', from: peer, fileCount: 3, totalBytes: 24 * 1000 * 1000, names: ['Vacation', 'notes.md', 'IMG_2041.HEIC'] },
            }),
          600,
        );
      }
      if (scenario === 'receive') setTimeout(() => simulateReceive('demo-receive'), 600);
      if (scenario === 'burst') {
        const fire = () => emit({ type: 'demo-burst', peerId: peer.id });
        setTimeout(() => {
          fire();
          setInterval(fire, 3200);
        }, 600);
      }
      // The peer drops out for a moment (a lost beacon on Wi-Fi) and comes back mid-animation,
      // then a transfer from it finishes while it's briefly off the radar.
      if (scenario === 'flap') {
        setTimeout(() => emit({ type: 'peers', peers: [] }), 1500);
        setTimeout(() => emit({ type: 'peers', peers: [peer] }), 1550);
        setTimeout(() => emit({ type: 'receive-start', id: 'flap', from: peer, fileCount: 1, totalBytes: 1000 }), 2500);
        setTimeout(() => emit({ type: 'peers', peers: [] }), 2800);
        setTimeout(() => emit({ type: 'receive-done', id: 'flap', from: peer, fileCount: 1, totalBytes: 1000, paths: [`${downloads}${sep}notes.md`] }), 3400);
        setTimeout(() => emit({ type: 'peers', peers: [peer] }), 3500);
      }
      if (scenario === 'drag') setTimeout(() => simulateDrag(0), 500);
      if (scenario === 'drop') setTimeout(() => simulateDrag(900), 400);
      if (scenario.startsWith('confirm-') || scenario === 'send-text') setTimeout(() => document.querySelector('.peer')?.click(), 500);
      if (scenario === 'send-text') setTimeout(() => document.querySelector('.sheet.confirm .btn.primary')?.click(), 1300);
      if (scenario === 'message') setTimeout(() => message('demo-message', note), 600);
      if (scenario === 'message-link') setTimeout(() => message('demo-message', link), 600);
      if (scenario === 'message-long') setTimeout(() => message('demo-message', essay), 600);
      if (scenario === 'messages') {
        setTimeout(() => message('demo-message-1', note), 600);
        setTimeout(() => message('demo-message-2', link), 900);
        setTimeout(() => message('demo-message-3', 'See you at 6?'), 1100);
      }
      if (scenario === 'pick') setTimeout(() => document.querySelector('.peer')?.click(), 500);
      return () => listeners.delete(fn);
    },
  };
}
