import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { parseBlend, createObjects } from './vendor/blend/index.js';

/* ---------------------------------------------------------------- consts */
const SW = 1240, SH = 780, RAILW = 232;
const LKEY = 'nookstacks.v3';
const TEXT_EXT = /\.(txt|md|markdown|csv|json|ya?ml|toml|ini|cfg|conf|log|xml|html?|css|js|mjs|ts|tsx|jsx|py|rb|go|rs|c|h|cpp|hpp|cs|java|kt|lua|sh|bash|zsh|sql|glsl|hlsl|vsh|fsh|vue|svelte)$/i;
const MODEL_EXT = /\.(glb|gltf|obj|stl|fbx|ply|dae|blend)$/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const PDF_EXT = /\.pdf$/i;
const VID_EXT = /\.(mp4|webm|mov|mkv)$/i;
const AUD_EXT = /\.(mp3|wav|ogg|m4a|flac)$/i;

/* ---------------------------------------------------------------- storage */
const idb = {
  db: null,
  async open(){
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('nookstacks', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async put(key, val){ const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('blobs','readwrite');
      t.objectStore('blobs').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(key){ const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('blobs','readonly');
      const q = t.objectStore('blobs').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async del(key){ const db = await this.open();
    return new Promise((res) => { const t = db.transaction('blobs','readwrite');
      t.objectStore('blobs').delete(key); t.oncomplete = res; }); }
};

/* No server and no desktop shell (a static host, a file:// copy): the browser's
   own IndexedDB becomes the vault. Same interface, so nothing above it changes. */
/* ------------------------------------------------------- a tiny zip, no deps
   .nks is a zip of nookstacks.json + state.json + blobs/<id>. Media is already
   compressed, so writing stored entries loses nothing and keeps this small. */
const CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++){ let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(u8){ let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC32[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const utf8 = s => new TextEncoder().encode(s);
function dosStamp(d = new Date()){
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}
function zipStore(entries){
  const { time, date } = dosStamp();
  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries){
    const name = utf8(e.name), data = e.data, crc = crc32(data), n = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint16(8, 0, true); cd.setUint16(10, 0, true); cd.setUint16(12, time, true);
    cd.setUint16(14, date, true); cd.setUint32(16, crc, true); cd.setUint32(20, n, true);
    cd.setUint32(24, n, true); cd.setUint16(28, name.length, true);
    cd.setUint16(30, 0, true); cd.setUint16(32, 0, true); cd.setUint16(34, 0, true);
    cd.setUint16(36, 0, true); cd.setUint32(38, 0, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + n;
  }
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(4, 0, true); eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true); eocd.setUint16(20, 0, true);
  const all = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const a of all) total += a.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of all){ out.set(a, at); at += a.length; }
  return out;
}
async function unzip(bytes){
  const u8 = new Uint8Array(bytes), dv = new DataView(u8.buffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--){
    if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++){
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(dataStart, dataStart + csize);
    if (method === 0){ out[name] = raw; }
    else if (method === 8 && typeof DecompressionStream === 'function'){
      const d = new DecompressionStream('deflate-raw');
      const w = d.writable.getWriter(); w.write(raw); w.close();
      out[name] = new Uint8Array(await new Response(d.readable).arrayBuffer());
    } else { throw new Error('unsupported compression in bundle'); }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
const saveAs = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
};
const nksFile = name => (String(name || 'board').replace(/[^\w \-]+/g, '-').trim() || 'board') + '.nks';

const localVault = {
  kind: 'local', ok: true, path: '',
  async ping(){ return true; },
  async getState(){
    const d = await idb.open();
    const rec = await new Promise((res, rej) => { const t = d.transaction('kv','readonly');
      const q = t.objectStore('kv').get('state'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    return rec ? { state: rec.state, saved: rec.saved } : { state: null, saved: 0 };
  },
  async putState(state){
    const d = await idb.open(), saved = Date.now();
    await new Promise((res, rej) => { const t = d.transaction('kv','readwrite');
      t.objectStore('kv').put({ state, saved }, 'state'); t.oncomplete = res; t.onerror = () => rej(t.error); });
    return { saved };
  },
  async getBlob(id){ try { const rec = await idb.get(id); return rec ? rec.blob : null; } catch { return null; } },
  async putBlob(id, blob){ await idb.put(id, { blob, name: blob.name, type: blob.type }); },
  async delBlob(){},
  async pick(){ return null; },
  async importPaths(){ return []; },
  /* the same .nks container, built here instead of in Rust */
  async exportBundle(state, scope, name){
    const copy = JSON.parse(JSON.stringify(state));
    const ids = [];
    const seen = new Set();
    const docs = [];
    const walk = v => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object'){
        if (v.kind && v.id && v.w !== undefined) docs.push(v);
        Object.values(v).forEach(walk);
      }
    };
    walk(copy);
    const entries = [];
    for (const doc of docs){
      let blob = null, id = doc.blobId;
      if (id) blob = await this.getBlob(id);
      // demo cards keep their file beside the app: pull it in so the bundle travels whole
      if (!blob && doc.src){
        try { const r = await fetch(doc.src); if (r.ok) blob = await r.blob(); } catch {}
        if (blob){ id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); doc.blobId = id; delete doc.src; }
      }
      if (!blob || !id) { if (doc.src) delete doc.src; continue; }
      if (seen.has(id)) continue;
      seen.add(id); ids.push(id);
      entries.push({ name: 'blobs/' + id, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    const manifest = { format: 'nookstacks.bundle', version: 1, app: '0.1.0', scope, name,
                       exported_ms: Date.now(), blobs: ids };
    const zip = zipStore([
      { name: 'nookstacks.json', data: utf8(JSON.stringify(manifest, null, 2)) },
      { name: 'state.json', data: utf8(JSON.stringify(copy)) },
      ...entries
    ]);
    const blob = new Blob([zip], { type: 'application/zip' });
    const file = nksFile(name);
    saveAs(blob, file);
    return { bytes: blob.size, path: file, blobs: ids.length, scope, name };
  },

  async importBundle(){
    const picked = await new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.nks,application/zip';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
    });
    if (!picked) return null;
    return this.importNksBytes(await picked.arrayBuffer());
  },

  async importNksBytes(buffer){
    const files = await unzip(buffer);
    if (!files['state.json']) throw new Error('no state.json in bundle');
    if (!files['nookstacks.json']) throw new Error('no nookstacks.json in bundle');
    const manifest = JSON.parse(new TextDecoder().decode(files['nookstacks.json']));
    if (manifest.format && manifest.format !== 'nookstacks.bundle') throw new Error('not a nookstacks bundle');
    const state = JSON.parse(new TextDecoder().decode(files['state.json']));
    let added = 0;
    for (const [path, bytes] of Object.entries(files)){
      const id = path.startsWith('blobs/') ? path.slice(6) : '';
      if (!id || id.includes('/') || id.includes('..')) continue;
      const have = await this.getBlob(id).catch(() => null);
      if (have) continue;
      await idb.put(id, { blob: new Blob([bytes]), name: id, type: '' });
      added++;
    }
    return { manifest, state, blobs_added: added };
  }
};

/* ---------------------------------------------------------------- seed */
function seed(){
  const mk = (kind, title, x, y, w, h, extra = {}) => ({ id: 'o' + Math.random().toString(36).slice(2, 9), kind, title, x, y, w, h, ...extra });
  const demo = (kind, title, file, ext, x, y, w, h, extra = {}) =>
    mk(kind, title, x, y, w, h, { ...(file ? { src: 'demo/' + file } : {}), ext, size: 0, ...extra });

  return { demo: true, demoVersion: DEMO_VERSION, levels: [
    { id:'ex1', name:'Example Category 1', shelves:[
      { id:'ex1s1', name:'Example Project 1', pan:{x:0,y:0,z:1}, groups:[
          { id:'g1', name:'START HERE', x:40, y:40, w:790, h:620, color:'amber' },
          { id:'g2', name:'DOCUMENTS', x:860, y:40, w:980, h:620, color:'sky' },
          { id:'g3', name:'MEDIA', x:40, y:700, w:1100, h:620, color:'violet' },
          { id:'g4', name:'ODDS AND ENDS', x:1170, y:700, w:670, h:620, color:'mint' } ],
        docs:[
          /* --- the tutorial, as ordinary notes on the board --- */
          mk('note','1 · This is a demo', 80, 90, 340, 200, { text:'<p>Everything here is an example. Rename it, drag it, delete it — nothing on this board is precious.</p>' }),
          mk('note','2 · Drag a card by its tab', 440, 90, 360, 200, { text:'<p>Grab the strip at the top of a card. The body stays put so you can click and edit inside it.</p>' }),
          mk('note','3 · Regions group things', 80, 330, 340, 300, { text:'<p>A region is a coloured frame around part of a board — like these four. Drag its tab to move it; the contents do not follow unless you select them too.</p><p>Right-click a region tab for its colour, or to fit the board to it.</p>' }),
          mk('note','4 · Your board is a file', 440, 330, 360, 300, { text:'<p>Notes, documents and every attached file live in one vault folder. Nothing leaves the machine.</p><p>Press <b>S</b> for settings and themes, <b>?</b> for every shortcut.</p>' }),

          /* --- one of everything --- */
          demo('text','notes.md','notes.md','md', 900, 90, 320, 240),
          demo('text','hello.py','hello.py','py', 1240, 90, 300, 240),
          demo('text','data.csv','data.csv','csv', 1560, 90, 250, 240),
          demo('pdf','example-sheet.pdf','example-sheet.pdf','pdf', 900, 370, 430, 260),
          demo('image','board-render.png','board-render.png','png', 1360, 370, 440, 260),

          demo('video','example-clip.mp4','example-clip.mp4','mp4', 80, 750, 500, 330),
          demo('audio','example-tone.mp3','example-tone.mp3','mp3', 620, 750, 480, 160),
          demo('model','rogue.obj','rogue.obj','obj', 620, 950, 480, 320),

          demo('link','example.com','','', 1210, 750, 590, 300, { url:'https://example.com' }),
          demo('file','example.zip','example.zip','zip', 1210, 1090, 320, 170, { size: 177 })
        ] },
      { id:'ex1s2', name:'Example Project 2', pan:{x:0,y:0,z:1}, groups:[
          { id:'g5', name:'A SECOND BOARD', x:60, y:60, w:700, h:420, color:'rose' } ],
        docs:[
          mk('note','Every project gets its own infinite board', 100, 110, 380, 220, { text:'<p>Nothing is shared between boards. Move around with the arrow keys, or click a project in the rail.</p>' }),
          mk('note','Right-click anything', 520, 110, 200, 220, { text:'<p>A note, a model and a region each get their own menu.</p>' })
        ] },
      { id:'ex1s3', name:'Example Project 3', pan:{x:0,y:0,z:1}, groups:[],
        docs:[ mk('note','An empty-ish board', 120, 120, 340, 180, { text:'<p>Press <b>N</b> for a note, <b>T</b> for a document, <b>G</b> to draw a region.</p>' }) ] }
    ]},
    { id:'ex2', name:'Example Category 2', shelves:[
      { id:'ex2s1', name:'Example Project 4', pan:{x:0,y:0,z:1}, groups:[
          { id:'g6', name:'THEMES', x:60, y:60, w:760, h:460, color:'violet' } ],
        docs:[
          mk('note','Sixteen themes, or build your own', 100, 110, 380, 260, { text:'<p>Press <b>S</b>. Every surface is drawn from one set of colour tokens, so a theme is a palette swap.</p><p>Custom lets you pick five colours and derives the rest.</p>' }),
          mk('note','Text size, grid, motion', 520, 110, 270, 260, { text:'<p>Same panel. Reduce motion also honours your system setting.</p>' })
        ] }
    ]},
    { id:'ex3', name:'Example Category 3', shelves:[
      { id:'ex3s1', name:'Example Project 5', pan:{x:0,y:0,z:1}, groups:[
          { id:'g7', name:'BOARDS AS FILES', x:60, y:60, w:820, h:520, color:'mint' } ],
        docs:[
          mk('note','.nks bundles', 100, 110, 380, 300, { text:'<p>File → Export this board writes a <b>.nks</b> file: the board, its cards and every attached file, in one zip.</p><p>Open board reads one back. It is how you move a project between machines.</p>' }),
          mk('note','Portable by design', 520, 110, 320, 300, { text:'<p>Paths never appear in the bundle — files are addressed by content hash, so a board exported on Windows opens on Linux.</p>' })
        ] }
    ]}
  ]};
}

/* ---------------------------------------------------------------- vault
   One storage interface, two shells:
     desktop  — Tauri IPC straight to the file system (this is the real app)
     http     — the dev server in dev/server.py, for working in a browser
   Whichever is in use, the on-disk layout is identical: state.json + blobs/. */
const TAURI = (typeof window !== 'undefined' && window.__TAURI__) ? window.__TAURI__ : null;
const DESKTOP = !!TAURI;
const call = (cmd, args) => TAURI.core.invoke(cmd, args || {});

const vault = {
  ok: false,
  kind: DESKTOP ? 'desktop' : 'http',
  path: '',

  async ping(){
    if (DESKTOP){
      try { const i = await call('vault_info'); this.path = i.vault; this.ok = true; }
      catch { this.ok = false; }
      return this.ok;
    }
    try { const r = await fetch('/api/health', {cache:'no-store'}); this.ok = r.ok; } catch { this.ok = false; }
    return this.ok;
  },

  async getState(){
    if (DESKTOP){
      const r = await call('get_state');
      this.path = r.vault;
      return { state: r.state, saved: r.saved_ms || 0 };
    }
    const r = await fetch('/api/state', {cache:'no-store'});
    if (!r.ok) throw new Error('state ' + r.status);
    const j = await r.json();
    return { state: j.state, saved: j.saved ? Date.parse(j.saved) : 0 };
  },

  async putState(state){
    if (DESKTOP){
      const r = await call('put_state', {state});
      return { saved: r.saved_ms };
    }
    const r = await fetch('/api/state', {method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({state})});
    if (!r.ok) throw new Error('save ' + r.status);
    return { saved: Date.now() };
  },

  async getBlob(id){
    if (DESKTOP){
      try { const buf = await call('get_blob', {id}); return new Blob([buf]); } catch { return null; }
    }
    const r = await fetch('/api/blob/' + encodeURIComponent(id), {cache:'no-store'});
    if (!r.ok) return null;
    return r.blob();
  },

  async putBlob(id, blob){
    if (DESKTOP) return;                       // desktop imports by path, bytes stay put
    const r = await fetch('/api/blob/' + encodeURIComponent(id), {method:'PUT', body: blob});
    if (!r.ok) throw new Error('blob ' + r.status);
  },

  async delBlob(id){
    if (DESKTOP){ try { await call('delete_blob', {id}); } catch {} return; }
    try { await fetch('/api/blob/' + encodeURIComponent(id), {method:'DELETE'}); } catch {}
  },

  /* desktop only: native picker and path import (no bytes through JS) */
  async pick(){ return DESKTOP ? call('pick_files') : null; },
  async importPaths(paths){ return DESKTOP ? call('import_files', {paths}) : []; },
  async openFolder(){ if (DESKTOP) call('open_vault'); },

  /* .nks bundles: one file for one board, or for the whole tower */
  async exportBundle(state, scope, name){
    if (DESKTOP){
      try {
        return await call('export_nks', { state, scope, name });
      } catch (e){
        if (String(e).includes('cancelled')) return { cancelled: true };
        throw e;
      }
    }
    const r = await fetch('/api/export', { method:'POST',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify({ state, scope, name }) });
    if (!r.ok) throw new Error('export ' + r.status);
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (r.headers.get('X-Bundle-Name') || name || 'board') + '.nks';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return { bytes: blob.size, path: a.download };
  },

  async importBundle(){
    let bytes = null, label = '';
    if (DESKTOP){
      try { return await call('import_nks'); }
      catch (e){ if (String(e).includes('cancelled')) return null; throw e; }
    }
    bytes = await new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.nks';
      inp.onchange = async () => resolve(inp.files[0] ? { file: inp.files[0] } : null);
      inp.click();
    });
    if (!bytes) return null;
    const r = await fetch('/api/import', { method:'POST', headers:{'Content-Type':'application/octet-stream'},
      body: bytes.file });
    if (!r.ok) throw new Error('import ' + r.status);
    return await r.json();
  }
};

const DEMO_VERSION = 2;
let db = seed();

/* ---------------------------------------------------------------- settings */
const DEFAULT_SETTINGS = { theme:'obsidian', size:'regular', grid:'on', motion:'full' };
const THEMES = [
  { id:'obsidian',   name:'Obsidian',      sw:['#07080a','#151a20','#e0a94f','#f6f1e5'] },
  { id:'manuscript', name:'Manuscript',    sw:['#12100c','#221c15','#d79a4a','#f5e8d0'] },
  { id:'graphite',   name:'Graphite',      sw:['#0b0d0f','#1a1f24','#8fb0dd','#eef1f5'] },
  { id:'daylight',   name:'Daylight',      sw:['#e8e4db','#ffffff','#a2621f','#fffdf8'] },
  { id:'electro',    name:'Electro',       sw:['#05070d','#101a26','#3ad0ff','#eef6fb'] },
  { id:'lava',       name:'Lava',          sw:['#0a0503','#1e0f08','#ff6a2a','#fbeee0'] },
  { id:'meadow',     name:'Meadow',        sw:['#060b06','#131d12','#7ed957','#f2f7ea'] },
  { id:'ocean',      name:'Ocean',         sw:['#03080f','#0d1b26','#2fbfc9','#eef8fa'] },
  { id:'sakura',     name:'Sakura',        sw:['#0f070c','#241420','#f48fb1','#fdf1f5'] },
  { id:'terminal',   name:'Terminal',      sw:['#000000','#08120a','#39ff14','#eafbe6'] },
  { id:'ember',      name:'Ember',         sw:['#120505','#26120e','#d1453b','#fdf0ec'] },
  { id:'neon',       name:'Neon',          sw:['#05000a','#1a0a2a','#ff2fb0','#f8ecff'] },
  { id:'iris',       name:'Iris',          sw:['#08060f','#191430','#a78bfa','#f4f0ff'] },
  { id:'mono',       name:'Mono',          sw:['#000000','#1a1a1a','#ffffff','#ffffff'] },
  { id:'frost',      name:'Frost',         sw:['#e6eef6','#ffffff','#2f7fb8','#ffffff'] },
  { id:'sand',       name:'Sand',          sw:['#ece3d2','#fffaf1','#a4632a','#fffaf1'] },
  { id:'custom',     name:'Custom',        sw:['#101216','#1b1f26','#e0a94f','#f6f1e5'] }
];

/* ---- custom theme: five colours in, the whole token set out ------------- */
const DEFAULT_CUSTOM = { bg:'#0d1014', surface:'#181d24', paper:'#f6f1e5', text:'#e7ecf3', accent:'#e0a94f' };

const hex2rgb = h => { h = (h || '#000').replace('#',''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0,2),16) || 0, parseInt(h.slice(2,4),16) || 0, parseInt(h.slice(4,6),16) || 0]; };
const rgb2hex = r => '#' + r.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0')).join('');
const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); return rgb2hex(x.map((v, i) => v + (y[i] - v) * t)); };
const shade = (c, amt) => mix(c, amt < 0 ? '#000000' : '#ffffff', Math.abs(amt));
const lum = c => { const [r, g, b] = hex2rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const rgba = (c, a) => { const [r, g, b] = hex2rgb(c); return `rgba(${r},${g},${b},${a})`; };

function customVars(c){
  const dark = lum(c.bg) < 0.5;
  const paperInk = lum(c.paper) > 0.5 ? shade(c.paper, -0.86) : shade(c.paper, 0.88);
  const t = {
    '--amber': c.accent, '--amber-rgb': hex2rgb(c.accent).join(','),
    '--accent-bright': shade(c.accent, 0.22), '--gdel': mix(c.text, c.bg, 0.45), '--gdel-hover': shade(c.accent, 0.22),
    '--bg': c.bg, '--bg-deep': shade(c.bg, -0.35), '--bg2': mix(c.bg, c.surface, 0.6),
    '--chip': c.surface, '--chip-ink': c.text,
    '--card-top': c.surface, '--card-bot': shade(c.surface, -0.35), '--card-ink': c.text,
    '--card-dim': mix(c.text, c.surface, 0.45), '--card-badge': mix(c.text, c.surface, 0.55),
    '--code-bg': shade(c.surface, -0.25), '--viewer-a': shade(c.surface, 0.08), '--viewer-b': shade(c.surface, -0.45),
    '--paper': c.paper, '--paper2': shade(c.paper, -0.07), '--paper-ink': paperInk,
    '--grip': mix(c.paper, paperInk, 0.35), '--badge-ink': mix(c.paper, paperInk, 0.5),
    '--close-ink': mix(c.paper, paperInk, 0.45), '--close-hover': paperInk,
    '--body-h': mix(c.paper, paperInk, 0.62), '--bone-ink': mix(c.paper, paperInk, 0.7),
    '--file-ink': mix(c.paper, paperInk, 0.75), '--file-link': shade(c.accent, -0.25),
    '--text': c.text, '--muted': mix(c.text, c.bg, 0.5), '--dim': mix(c.text, c.bg, 0.62),
    '--dim2': mix(c.text, c.bg, 0.66), '--dim3': mix(c.text, c.bg, 0.74),
    '--rail-ink': mix(c.text, c.bg, 0.45), '--rail-head': mix(c.text, c.bg, 0.6), '--rail-item': mix(c.text, c.bg, 0.25),
    '--rail-on': shade(c.accent, 0.35), '--rail-count': mix(c.text, c.bg, 0.55), '--rail-plus': mix(c.text, c.bg, 0.45),
    '--rail-tick': mix(c.text, c.bg, 0.72),
    '--sep': mix(c.text, c.bg, 0.78), '--dot-line': mix(c.text, c.bg, 0.72), '--ui-text': mix(c.text, c.bg, 0.2),
    '--ok': dark ? '#7fb07f' : '#3f7a45', '--bad': dark ? '#e08a6a' : '#b4472f',
    '--hair': rgba(c.text, dark ? 0.10 : 0.12),
    '--chrome-rgb': hex2rgb(shade(c.bg, -0.25)).join(','), '--chrome-hover-rgb': hex2rgb(shade(c.surface, -0.1)).join(',')
  };
  return t;
}

const CUSTOM_KEYS = Object.keys(customVars(DEFAULT_CUSTOM));
function clearCustomVars(){
  const r = document.documentElement.style;
  CUSTOM_KEYS.forEach(k => r.removeProperty(k));
}

function settings(){
  if (!db.settings) db.settings = { ...DEFAULT_SETTINGS };
  if (!db.settings.custom) db.settings.custom = { ...DEFAULT_CUSTOM };
  return db.settings;
}
function applySettings(){
  const s = settings(), r = document.documentElement;
  r.dataset.theme = s.theme; r.dataset.size = s.size;
  r.dataset.grid = s.grid; r.dataset.motion = s.motion;
  if (s.theme === 'custom'){
    if (!s.custom) s.custom = { ...DEFAULT_CUSTOM };
    const vars = customVars(s.custom);
    Object.keys(vars).forEach(k => r.style.setProperty(k, vars[k]));
  } else {
    clearCustomVars();
  }
  paintSettings();
}
function paintSettings(){
  const s = settings();
  document.querySelectorAll('#themeGrid button').forEach(b => b.classList.toggle('on', b.dataset.theme === s.theme));
  document.querySelectorAll('#settings .seg').forEach(seg => {
    const key = seg.dataset.set;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s[key]));
  });
  paintCustomEditor();
}
function buildThemes(){
  const grid = document.getElementById('themeGrid');
  if (!grid || grid.childElementCount) return;
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.theme = t.id;
    b.innerHTML = '<span class="swatch">' + t.sw.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>'
                + '<span class="trow"><span class="tname">' + t.name + '</span><span class="tick">●</span></span>';
    b.onclick = () => {
      const s = settings();
      if (t.id === 'custom' && s.theme !== 'custom') s.customBase = s.theme || 'obsidian';
      s.theme = t.id; applySettings(); save();
    };
    grid.appendChild(b);
  });
  paintCustomEditor();
}

/* the five colours a custom theme is built from */
function paintCustomEditor(){
  const box = document.getElementById('customGroup');
  if (!box) return;
  const s = settings();
  box.hidden = s.theme !== 'custom';
  box.querySelectorAll('input[data-ck]').forEach(inp => {
    inp.value = s.custom[inp.dataset.ck] || '#000000';
  });
}

function wireCustomEditor(){
  const box = document.getElementById('customGroup');
  if (!box) return;
  box.querySelectorAll('input[data-ck]').forEach(inp => {
    inp.addEventListener('input', () => {
      const s = settings();
      s.custom[inp.dataset.ck] = inp.value;
      s.theme = 'custom';
      applySettings(); save();
    });
  });
  const sel = document.getElementById('customBase');
  if (sel){
    THEMES.filter(t => t.id !== 'custom').forEach(t => {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; sel.appendChild(o);
    });
    sel.value = settings().customBase || 'obsidian';
  }
  const seed = document.getElementById('customSeed');
  if (seed) seed.onclick = () => {
    const s = settings();
    const base = (document.getElementById('customBase') || {}).value || 'obsidian';
    const r = document.documentElement;
    const was = s.theme;
    clearCustomVars();                           // inline custom values would win over the CSS block
    r.dataset.theme = base;                      // read that theme's tokens
    const cs = getComputedStyle(r);
    const get = n => (cs.getPropertyValue(n) || '').trim();
    s.custom = {
      bg: get('--bg') || DEFAULT_CUSTOM.bg,
      surface: get('--card-top') || DEFAULT_CUSTOM.surface,
      paper: get('--paper') || DEFAULT_CUSTOM.paper,
      text: get('--text') || DEFAULT_CUSTOM.text,
      accent: get('--amber') || DEFAULT_CUSTOM.accent
    };
    s.customBase = base; s.theme = 'custom'; r.dataset.theme = was;
    applySettings(); save(); paintCustomEditor();
  };
  const reset = document.getElementById('customReset');
  if (reset) reset.onclick = () => {
    settings().custom = { ...DEFAULT_CUSTOM }; applySettings(); save(); paintCustomEditor();
  };
}
function setSetting(key, value){ settings()[key] = value; applySettings(); save(); }
const settingsOpen = () => !document.getElementById('settings').hidden;
function openSettings(){ document.getElementById('settings').hidden = false; paintSettings(); }
function closeSettings(){ document.getElementById('settings').hidden = true; }

// paint before boot so a saved theme is on screen from the first frame
try {
  const cached = JSON.parse(localStorage.getItem(LKEY) || 'null');
  if (cached && cached.settings) db.settings = { ...DEFAULT_SETTINGS, ...cached.settings };
} catch {}
applySettings();

let storeReady = false;
let dirtyAfterBoot = false;
let saveT = 0;

function setSaveState(txt, cls){
  const el = document.getElementById('saveState');
  if (!el) return;
  el.textContent = txt;
  el.className = 'savestate ' + (cls || '');
}

let level = 0, shelf = 0, cam = { x:0, y:0, z:1 };
let drawMode = false;
const DBG = { errors: [], down: 0, move: 0, up: 0, wheel: 0, zooms: 0, carddown: 0, cardmove: 0, dblclick: 0, focused: 0 };
function note(kind, extra){ DBG[kind]++; if (extra) DBG.errors.push(String(extra).slice(0, 200)); }
/* selection is a set: ctrl-click adds, the marquee fills it, and everything
   that acts on 'the selection' acts on all of it. `selected` stays the primary
   (last touched) id for the few places that need exactly one. */
let sel = new Set();          // selected cards
let gsel = new Set();         // selected regions
let selected = null;
  const viewers = [];
const urls = new Map();

const $ = s => document.querySelector(s);
const curLevel = () => db.levels[level];
const curShelf = () => curLevel().shelves[shelf];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function save(){
  histPush();
  // mirror locally first: even if the server write fails, this tab keeps working
  try { localStorage.setItem(LKEY, JSON.stringify(db)); } catch {}
  if (!storeReady) { dirtyAfterBoot = true; return; }
  setSaveState('saving…', 'busy');
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try {
      const r = await vault.putState(db);
      setSaveState('saved ' + new Date(r.saved || Date.now()).toLocaleTimeString(), 'ok');
    } catch (e){
      setSaveState('NOT SAVED — ' + (DESKTOP ? 'vault write failed' : 'server unreachable'), 'bad');
      note('errors', e);
    }
  }, 400);
}

async function boot(){
  let reachable = await vault.ping();
  if (!reachable && !DESKTOP){
    Object.assign(vault, localVault);
    reachable = true;
    note('vault', 'no server — this browser keeps the board');
  }
  if (reachable){
    try {
      const res = await vault.getState();
      if (res && res.state && res.state.levels && res.state.levels.length){
        db = res.state;
        // a stored board that is an older copy of the demo is nobody's work:
        // move it forward instead of leaving last month's example on screen
        if (db.demo && (db.demoVersion || 0) < DEMO_VERSION){
          db = seed();
          dirtyAfterBoot = true;
        }
        setSaveState((vault.kind === 'local' ? 'this browser · ' : 'vault · ') +
          (res.saved ? new Date(res.saved).toLocaleString() : 'loaded'), 'ok');
        if (DESKTOP && vault.path) document.getElementById('saveState').title = vault.path;
      } else {
        // first run on a fresh vault: adopt whatever this browser already had
        const local = (() => { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch { return null; } })();
        if (local && local.levels && local.levels.length){ db = local; }
        storeReady = true;
        await vault.putState(db);
        setSaveState(vault.kind === 'local' ? 'saved in this browser' : 'vault created', 'ok');
        if (DESKTOP && vault.path) document.getElementById('saveState').title = vault.path;
      }
    } catch (e){ note('errors', e); setSaveState('vault unreadable — using local copy', 'bad'); }
  } else {
    setSaveState(DESKTOP ? 'vault unavailable' : 'offline — changes kept in this browser only', 'bad');
  }
  storeReady = true;
  // a fresh vault should record its defaults, not just imply them
  if (!db.settings){ db.settings = { ...DEFAULT_SETTINGS }; dirtyAfterBoot = true; }
  applySettings();
  render();
  document.body.classList.remove('booting');
  if (dirtyAfterBoot){ dirtyAfterBoot = false; save(); }
}

/* ---------------------------------------------------------------- camera */
const fitZoom = () => Math.min(innerWidth / (SW * 1.34), innerHeight / (SH * 1.30));
function applyCam(animate = true){
  const w = $('#world');
  const z = cam.z * fitZoom();
  if (!isFinite(cam.x) || !isFinite(cam.y) || !isFinite(cam.z) || cam.z <= 0){ cam = { x:0, y:0, z:1 }; }
  const cx = SW / 2 + cam.x, cy = SH / 2 + cam.y;
  const midX = (innerWidth + RAILW) / 2;
  w.style.transform = `translate(${midX - cx*z}px, ${innerHeight/2 - cy*z}px) scale(${z})`;
  // the transition is switched by the gesture handlers, never per frame:
  // toggling it here made every mousemove start a .5s animation the next one cut short.
}
function stash(){ curShelf().pan = { ...cam }; save(); }
function screenToPanel(px, py){
  const z = cam.z * fitZoom();
  const rect = $('#world').getBoundingClientRect();
  return { x: (px - rect.left) / z, y: (py - rect.top) / z };
}

/* ---------------------------------------------------------------- objects */
function blobUrlFor(doc){
  if (urls.has(doc.id)) return urls.get(doc.id);
  const u = (doc.blobId || doc.src) ? `__pending__${doc.id}` : null;
  if (u) resolveBlobUrl(doc);
  return urls.get(doc.id) || null;
}
async function resolveBlobUrl(doc){
  let blob = null;
  if (doc.blobId && vault.ok){
    try { blob = await vault.getBlob(doc.blobId); } catch {}
  }
  if (!blob && doc.blobId){
    const rec = await idb.get(doc.blobId);
    if (rec) blob = rec.blob;
  }
  // demo cards ship their file beside the app instead of in the vault
  if (!blob && doc.src){
    try { const r = await fetch(doc.src); if (r.ok) blob = await r.blob(); } catch {}
  }
  if (!blob) return;
  urls.set(doc.id, URL.createObjectURL(blob));
  if (findDoc(doc.id)) render();
}

async function storeBlob(id, blob){
  // vault first (any browser, survives restarts), IndexedDB as a local cache
  try { await idb.put(id, { blob, name: blob.name, type: blob.type }); } catch {}
  if (vault.ok){
    try { await vault.putBlob(id, blob); } catch (e){ note('errors', e); setSaveState('file not saved to vault', 'bad'); }
  }
}

function bodyHTML(doc){
  switch (doc.kind){
    case 'note':
      return `<div class="body pad" contenteditable="false" spellcheck="false">${doc.text || '<p><br></p>'}</div>`;
    case 'text':
      return `<div class="body"><textarea spellcheck="false">${esc(doc.text || '')}</textarea></div>`;
    case 'image': {
      const u = urls.get(doc.id);
      return `<div class="body">${u ? `<img src="${u}" alt="">` : `<div class="filletile">loading…</div>`}</div>`;
    }
    case 'pdf': {
      const u = urls.get(doc.id);
      return `<div class="body">${u ? `<iframe src="${u}#toolbar=1&view=FitH"></iframe>` : `<div class="filletile">loading…</div>`}</div>`;
    }
    case 'video': {
      const u = urls.get(doc.id);
      return `<div class="body">${u ? `<video src="${u}" controls></video>` : `<div class="filletile">loading…</div>`}</div>`;
    }
    case 'audio': {
      const u = urls.get(doc.id);
      return `<div class="body">${u ? `<audio src="${u}" controls></audio>` : `<div class="filletile">loading…</div>`}</div>`;
    }
    case 'model':
      return `<div class="body"><canvas class="mesh"></canvas><span class="viewerhint">drag orbit · scroll zoom</span></div>`;
    case 'link':
      return `<div class="body"><iframe src="${esc(doc.url || 'about:blank')}" referrerpolicy="no-referrer"></iframe></div>`;
    default: {
      const kb = (doc.size || 0) / 1024;
      const size = !doc.size ? '' : kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb >= 1 ? Math.round(kb) + ' KB' : doc.size + ' B';
      return `<div class="body"><div class="filletile">${esc(doc.ext || 'file')} · ${size}<br><br>${urls.get(doc.id) ? `<a href="${urls.get(doc.id)}" download="${esc(doc.title)}">download</a>` : 'stored locally'}</div></div>`; }
  }
}

function hydrate(el, doc){
  const body = el.querySelector('.body');
  if (!body) return;
  const fresh = document.createElement('div');
  fresh.innerHTML = bodyHTML(doc);
  body.replaceWith(fresh.firstElementChild);
  wireBody(el, doc);
}

function objHTML(doc){
  const dark = !['note','text'].includes(doc.kind);
  const badge = { note:'note', text:'doc', image:'image', pdf:'pdf', model:'3d', video:'video', audio:'audio', link:'web', file:'file' }[doc.kind] || 'file';
  return `<article class="obj ${dark ? 'dark' : ''}" data-id="${doc.id}"
      style="left:${doc.x}px; top:${doc.y}px; width:${doc.w}px; height:${doc.h}px">
    <div class="head"><span class="title">${esc(doc.title)}</span><span class="badge">${badge}</span>
      <button class="close" title="Delete">✕</button></div>
    ${bodyHTML(doc)}
    <span class="h nw" data-dir="nw"></span><span class="h ne" data-dir="ne"></span>
    <span class="h sw" data-dir="sw"></span><span class="h se" data-dir="se"></span>
  </article>`;
}

/* ---------------------------------------------------------------- 3d */
function makeViewer(canvas, doc){
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
  camera.position.set(2.2, 1.8, 2.8);
  scene.add(new THREE.HemisphereLight(0xdce7ff, 0x1a1f26, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 6, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd9a0, .7); rim.position.set(-4, 2, -3); scene.add(rim);

  const controls = new OrbitControls(camera, canvas);
  // damping needs a frame every tick; without it we can render only when something changes
  controls.enableDamping = false;
  controls.enablePan = true;

  const group = new THREE.Group(); scene.add(group);
  const box = new THREE.Box3();
  const url = urls.get(doc.id);

  const fit = () => {
    box.setFromObject(group);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length();
    const centre = box.getCenter(new THREE.Vector3());
    group.position.sub(centre);
    const dist = size * 1.35;
    camera.position.set(dist * .6, dist * .45, dist * .8);
    camera.near = Math.max(size / 500, 0.001); camera.far = size * 40; camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0); controls.update();
  };

  const fail = msg => {
    const b = canvas.parentElement;
    if (b) b.innerHTML = `<div class="filletile" style="padding:16px">${msg}</div>`;
  };
  const ext = '.' + (doc.ext || '').toLowerCase();   // inner tests match on '.stl', '.obj', …
  const finish = (obj, flat) => {
    group.add(obj);
    if (flat){ obj.geometry.computeVertexNormals(); }
    let tris = 0;
    group.traverse(o => { if (o.isMesh && o.geometry){ const g = o.geometry;
      tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3; } });
    canvas.dataset.tris = Math.round(tris);
    if (!tris) return fail('this file has no triangles');
    fit();
  };

  const stdMat = (opts = {}) => new THREE.MeshStandardMaterial({ color:0xcfd7e1, metalness:.08, roughness:.62, ...opts });

  if (url && MODEL_EXT.test(ext)) {
    if (/\.(glb|gltf)$/i.test(ext)){
      new GLTFLoader().load(url, g => finish(g.scene), undefined, () => fail('could not read this glTF'));
    } else if (/\.obj$/i.test(ext)){
      new OBJLoader().load(url, o => finish(o), undefined, () => fail('could not read this .obj'));
    } else if (/\.stl$/i.test(ext)){
      new STLLoader().load(url, g => {
        g.computeVertexNormals();
        finish(new THREE.Mesh(g, stdMat({ color:0xd2dae4 })), false);
      }, undefined, () => fail('could not read this .stl'));
    } else if (/\.fbx$/i.test(ext)){
      new FBXLoader().load(url, o => {
        o.traverse(c => { if (c.isMesh){ c.castShadow = true; c.receiveShadow = true;
          if (!c.material || Array.isArray(c.material) && !c.material.length) c.material = stdMat(); } });
        finish(o);
      }, undefined, () => fail('could not read this .fbx (binary FBX only)'));
    } else if (/\.ply$/i.test(ext)){
      new PLYLoader().load(url, g => {
        g.computeVertexNormals();
        const hasColour = !!(g.attributes.color);
        finish(new THREE.Mesh(g, stdMat({ color: hasColour ? 0xffffff : 0xd2dae4, vertexColors: hasColour })), false);
      }, undefined, () => fail('could not read this .ply'));
    } else if (/\.dae$/i.test(ext)){
      new ColladaLoader().load(url, c => finish(c.scene), undefined, () => fail('could not read this .dae'));
    } else if (/\.blend$/i.test(ext)){
      fetch(url).then(r => r.arrayBuffer()).then(async buf => {
        const file = await parseBlend(buf, doc.title);
        const objs = createObjects(file) || [];
        const g = new THREE.Group();
        objs.forEach(o => o && g.add(o));
        // Blender scenes are Z-up; three is Y-up
        g.rotation.x = -Math.PI / 2;
        if (!g.children.length) return fail('this .blend has no visible meshes (modifiers are not evaluated)');
        finish(g);
        const note = canvas.parentElement?.querySelector('.blendnote');
        if (note) note.remove();
      }).catch(e => fail('could not parse this .blend — ' + (e.message || 'unsupported version')));
      const body = canvas.parentElement;
      if (body){
        const n = document.createElement('span');
        n.className = 'viewerhint blendnote';
        n.textContent = 'reading .blend…';
        body.appendChild(n);
      }
    }
  } else if (!url) {
    canvas.parentElement && (canvas.parentElement.dataset.pending = '1');
  } else {
    fail('unrecognised model format');
  }

  // ---- render only when something actually changed (no idle 60fps loop) ----
  const state = { renderer, scene, camera, controls, raf:0, dead:false, ro:null, dirty:false, fit, wire:false };
  const draw = () => {
    state.raf = 0;
    if (state.dead) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (canvas.width !== Math.floor(w*renderer.getPixelRatio()) || canvas.height !== Math.floor(h*renderer.getPixelRatio()))){
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    controls.update();
    renderer.render(scene, camera);
    canvas.dataset.cam = camera.position.x.toFixed(2) + ',' + camera.position.y.toFixed(2) + ',' + camera.position.z.toFixed(2);
    canvas.dataset.dist = camera.position.distanceTo(controls.target).toFixed(3);
    state.dirty = false;
  };
  const schedule = () => {
    if (state.dead || state.dirty) return;
    state.dirty = true;
    state.raf = requestAnimationFrame(draw);
  };
  state.schedule = schedule;
  controls.addEventListener('change', schedule);
  if (typeof ResizeObserver !== 'undefined'){
    state.ro = new ResizeObserver(schedule);
    state.ro.observe(canvas.parentElement || canvas);
  }
  schedule();
  canvas.__viewer = state;
  return state;
}

function disposeViewers(){
  for (const v of viewers){
    v.dead = true;
    if (v.raf) cancelAnimationFrame(v.raf);
    if (v.ro) v.ro.disconnect();
    v.controls.dispose();
    // free GPU memory: geometries, materials, textures
    v.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats){
        for (const k in m){ const val = m[k]; if (val && val.isTexture) val.dispose(); }
        m.dispose();
      }
    });
    v.renderer.dispose();
    if (v.renderer.forceContextLoss) v.renderer.forceContextLoss();
  }
  viewers.length = 0;
}

/* ---------------------------------------------------------------- render */
function render(){
  disposeViewers();
  const shelflist = curLevel().shelves;
  const cur = shelflist[shelf];
  const world = $('#world');
  const parts = [];
  const panel = (s, isCur, side) => {
    const groups = s.groups.map(g => `<div class="group${gsel.has(g.id) ? ' selected' : ''}" data-gid="${g.id}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;${regionVars(g)}">
        <span class="grouphead" title="Drag to move · double-click to rename">${esc(g.name)}<button class="gdel" title="Delete region">✕</button></span>
        <i class="gh" data-dir="nw"></i><i class="gh" data-dir="ne"></i><i class="gh" data-dir="sw"></i><i class="gh" data-dir="se"></i>
      </div>`).join('');
    return `<div class="panel ${isCur ? '' : 'peek ' + (side||'')}" style="left:${isCur ? 0 : (side === 'left' ? -(SW+GAP) : SW+GAP)}px;top:0">
      <div class="label"><b>${esc(s.name)}</b></div>${groups}${s.docs.map(objHTML).join('')}</div>`;
  };
  parts.push(panel(cur, true));
  world.innerHTML = parts.join('');

  $('#levelName').textContent = curLevel().name;
  $('#projectName').textContent = cur.name;
  $('#counts').textContent = `${cur.docs.length} items · ${shelf+1}/${shelflist.length}`;
  $('#empty').hidden = cur.docs.length > 0;
  paintSelection();
  $('#navPrev').hidden = shelf === 0;
  $('#navNext').hidden = shelf >= shelflist.length - 1;

  renderRail();

  // regions are objects now: give any legacy group an id
  cur.groups.forEach(g => { if (!g.id) g.id = 'g' + Math.random().toString(36).slice(2,9); });

  // wire current panel only
  world.querySelectorAll('.panel:not(.peek) .obj').forEach(el => {
    const doc = findDoc(el.dataset.id);
    if (!doc) return;
    if ((doc.blobId || doc.src) && !urls.has(doc.id)) resolveBlobUrl(doc);
    wireBody(el, doc);
    wireHead(el, doc);
    wireHandles(el, doc);
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey){ toggleSel(doc.id); e.stopPropagation(); return; }
      if (e.shiftKey){ addSel(doc.id); e.stopPropagation(); return; }
      if (!sel.has(doc.id)) select(doc.id);       // clicking inside a multi-selection keeps it
      else { selected = doc.id; paintSelection(); }
    }, true);
    el.querySelector('.close').onclick = e => { e.stopPropagation(); removeDoc(doc.id); };
    if (doc.kind === 'model'){
      const canvas = el.querySelector('canvas.mesh');
      if (canvas) viewers.push(makeViewer(canvas, doc));
    }
    if (sel.has(doc.id)) el.classList.add('selected');
  });

  wireGroups(world.querySelector('.panel:not(.peek)'), cur);

  applyCam(false);
}

/* ---------------------------------------------------------------- regions */
function wireGroups(panelEl, shelf){
  if (!panelEl) return;
  panelEl.querySelectorAll('.group').forEach(el => {
    const g = shelf.groups.find(x => x.id === el.dataset.gid);
    if (!g) return;
    const label = el.querySelector('.grouphead');

    // a region moves by its tab, and only by its tab
    label.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (e.ctrlKey || e.metaKey){              // add or drop one region
        if (gsel.has(g.id)) gsel.delete(g.id); else gsel.add(g.id);
        paintSelection();
        return;
      }
      if (e.shiftKey){ gsel.add(g.id); paintSelection(); return; }
      if (!gsel.has(g.id)){ sel = new Set(); gsel = new Set([g.id]); selected = null; paintSelection(); }

      const z = cam.z * fitZoom();
      const sx = e.clientX, sy = e.clientY;
      // the tab drags the whole selection: every selected region and every selected card
      const groups = curShelf().groups.filter(x => gsel.has(x.id)).map(x => ({ o: x, x: x.x, y: x.y, el: document.querySelector(`.group[data-gid="${x.id}"]`) }));
      const cards = curShelf().docs.filter(d => sel.has(d.id)).map(d => ({ o: d, x: d.x, y: d.y, el: document.querySelector(`.obj[data-id="${d.id}"]`) }));
      const move = ev => {
        const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        groups.forEach(it => {
          it.o.x = it.x + dx; it.o.y = it.y + dy;
          if (it.el){ it.el.style.left = it.o.x + 'px'; it.el.style.top = it.o.y + 'px'; }
        });
        cards.forEach(it => {
          it.o.x = it.x + dx; it.o.y = it.y + dy;
          if (it.el){ it.el.style.left = it.o.x + 'px'; it.el.style.top = it.o.y + 'px'; }
        });
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); save(); render(); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });

    // rename by double-clicking the label
    label.addEventListener('dblclick', e => {
      e.stopPropagation(); e.preventDefault();
      const inp = document.createElement('input');
      inp.value = g.name; inp.className = 'grename';
      label.replaceWith(inp); inp.focus(); inp.select();
      const commit = ok => { if (ok && inp.value.trim()) g.name = inp.value.trim(); save(); render(); };
      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter'){ ev.preventDefault(); commit(true); }
        if (ev.key === 'Escape'){ ev.preventDefault(); commit(false); }
        ev.stopPropagation();
      });
      inp.addEventListener('blur', () => commit(true));
      inp.addEventListener('mousedown', ev => ev.stopPropagation());
    });

    // resize from a corner
    el.querySelectorAll('.gh').forEach(h => {
      h.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const dir = h.dataset.dir, z = cam.z * fitZoom();
        const sx = e.clientX, sy = e.clientY, ow = g.w, oh = g.h, ox = g.x, oy = g.y;
        const move = ev => {
          const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
          let w = ow, hh = oh, x = ox, y = oy;
          if (dir.includes('e')) w = Math.max(120, ow + dx);
          if (dir.includes('s')) hh = Math.max(90, oh + dy);
          if (dir.includes('w')){ w = Math.max(120, ow - dx); x = ox + (ow - w); }
          if (dir.includes('n')){ hh = Math.max(90, oh - dy); y = oy + (oh - hh); }
          g.w = w; g.h = hh; g.x = x; g.y = y;
          el.style.width = w + 'px'; el.style.height = hh + 'px';
          el.style.left = x + 'px'; el.style.top = y + 'px';
        };
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); save(); };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      });
    });

    el.querySelector('.gdel').addEventListener('mousedown', e => e.stopPropagation());
    el.querySelector('.gdel').addEventListener('click', e => {
      e.stopPropagation();
      const i = shelf.groups.indexOf(g);
      if (i >= 0) shelf.groups.splice(i, 1);
      save(); render();
    });
  });
}

function renderRail(){
  const list = curLevel().shelves;
  $('#catList').innerHTML = db.levels.map((l,i) =>
    `<div class="ritem ${i===level?'on':''}" data-kind="cat" data-i="${i}">
       <span class="nm">${esc(l.name)}</span>
       <span class="mv"><button data-mv="up">↑</button><button data-mv="down">↓</button></span></div>`).join('');
  $('#projList').innerHTML = list.map((s,i) =>
    `<div class="ritem ${i===shelf?'on':''}" data-kind="proj" data-i="${i}">
       <span class="nm">${esc(s.name)}</span>
       <span class="mv"><button data-mv="up">↑</button><button data-mv="down">↓</button></span></div>`).join('');
  wireRail();
}

/* Delegated, and bound once. Per-row listeners died the moment a click
   re-rendered the rail, which is why double-clicking a project you were not
   already on never opened the rename box: the first click rebuilt the row, so
   the browser delivered the dblclick to the list instead of the label. */
let railWired = false;
function wireRail(){
  if (railWired) return;
  railWired = true;
  ['#catList', '#projList'].forEach(sel => {
    const box = $(sel);
    if (!box) return;

    // Two quick clicks on the same row is the rename gesture, detected here
    // rather than trusted to dblclick: the first click re-renders the rail, and
    // a dblclick whose two targets are different nodes is delivered to their
    // common ancestor, so a handler on the label would never see it.
    let last = { kind: '', i: -1, t: 0 };
    box.addEventListener('click', e => {
      const mv = e.target.closest('.mv button');
      if (mv){
        e.stopPropagation();
        const row = mv.closest('.ritem');
        moveItem(row.dataset.kind, +row.dataset.i, mv.dataset.mv === 'up' ? -1 : 1);
        return;
      }
      if (e.target.tagName === 'INPUT') return;
      const row = e.target.closest('.ritem');
      if (!row) return;
      const i = +row.dataset.i, kind = row.dataset.kind;
      const now = Date.now();

      if (last.kind === kind && last.i === i && now - last.t < 450){
        last = { kind: '', i: -1, t: 0 };
        if (!row.querySelector('input')) startRename(row, kind, i);
        return;
      }
      last = { kind, i, t: now };

      if (kind === 'cat') goLevel(i); else goShelf(i);
    });

    // native dblclick still works where the browser delivers it to the label
    box.addEventListener('dblclick', e => {
      if (e.target.tagName === 'INPUT') return;
      const row = e.target.closest('.ritem');
      if (!row || !e.target.closest('.nm') || row.querySelector('input')) return;
      e.preventDefault(); e.stopPropagation();
      startRename(row, row.dataset.kind, +row.dataset.i);
    });
  });
}

function startRename(row, kind, i){
  cancelNav();
  const nm = row.querySelector('.nm');
  if (!nm) return;
  const arr = kind === 'cat' ? db.levels : curLevel().shelves;
  const inp = document.createElement('input');
  inp.value = arr[i].name;
  nm.replaceWith(inp); inp.focus(); inp.select();
  const commit = (ok) => {
    if (ok && inp.value.trim()) arr[i].name = inp.value.trim();
    save(); render();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); commit(true); }
    if (e.key === 'Escape'){ e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('click', e => e.stopPropagation());
}

function moveItem(kind, i, dir){
  const arr = kind === 'cat' ? db.levels : curLevel().shelves;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  if (kind === 'cat'){ if (level === i) level = j; else if (level === j) level = i; }
  else { if (shelf === i) shelf = j; else if (shelf === j) shelf = i; }
  save(); render();
}

function addCategory(){
  const n = db.levels.length + 1;
  const id = 'l' + Math.random().toString(36).slice(2,9);
  db.levels.push({ id, name: 'New category ' + n, shelves: [
    { id: 'p' + Math.random().toString(36).slice(2,9), name: 'New project', pan:{x:0,y:0,z:1}, groups:[], docs:[] } ] });
  level = db.levels.length - 1; shelf = 0; clearSel();
  cam = { x:0, y:0, z:1 };
  save(); render();
}

function addProject(){
  const id = 'p' + Math.random().toString(36).slice(2,9);
  curLevel().shelves.push({ id, name: 'New project', pan:{x:0,y:0,z:1}, groups:[], docs:[] });
  shelf = curLevel().shelves.length - 1;
  cam = { x:0, y:0, z:1 }; clearSel();
  save(); render();
}

function wireBody(el, doc){
  const body = el.querySelector('.body');
  if (!body) return;
  if (doc.kind === 'note'){
    body.addEventListener('input', () => { doc.text = body.innerHTML; save(); });
    body.addEventListener('mousedown', e => { if (e.button === 0) e.stopPropagation(); });
    // editing is deliberate: double-click to type, click elsewhere to stop.
    body.addEventListener('dblclick', e => {
      e.stopPropagation(); e.preventDefault();
      note('dblclick');
      body.setAttribute('contenteditable', 'true');
      requestAnimationFrame(() => { body.focus(); note('focused'); });
    });
    body.addEventListener('blur', () => {
      body.setAttribute('contenteditable', 'false');
      doc.text = body.innerHTML; save();
    });
  }
  if (doc.kind === 'video'){
    // paint the first frame instead of leaving the card black until play
    const v = body.querySelector('video');
    if (v){
      const seek = () => { if (v.currentTime === 0 && v.duration) { try { v.currentTime = Math.min(0.06, v.duration / 2); } catch {} } };
      v.addEventListener('loadedmetadata', seek);
      if (v.readyState >= 1) seek();
    }
  }
  if (doc.kind === 'text'){
    const ta = body.querySelector('textarea');
    if (ta) ta.addEventListener('input', () => { doc.text = ta.value; save(); });
  }
  body.addEventListener('dblclick', e => e.stopPropagation());
}

function wireHead(el, doc){
  const head = el.querySelector('.head');
  head.addEventListener('mousedown', e => {
    if (e.target.closest('.close')) return;
    if (e.button !== 0) return;               // right/middle belongs to the board
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;  // that click is for selecting
    e.preventDefault(); e.stopPropagation();
    if (!sel.has(doc.id)) select(doc.id);
    note('carddown');
    const z = cam.z * fitZoom();
    const sx = e.clientX, sy = e.clientY, ox = doc.x, oy = doc.y;
    // every other selected card travels with this one -- and every selected
    // region does too, so a card and its frame never drift apart
    const mates = selDocs().filter(d => d.id !== doc.id).map(d => ({ d, x: d.x, y: d.y }));
    const frames = curShelf().groups.filter(g => gsel.has(g.id)).map(g => ({ g, x: g.x, y: g.y }));
    const move = ev => {
      note('cardmove');
      const ddx = (ev.clientX - sx) / z, ddy = (ev.clientY - sy) / z;
      mates.forEach(m => { m.d.x = m.x + ddx; m.d.y = m.y + ddy;
        const me = document.querySelector(`.obj[data-id="${m.d.id}"]`);
        if (me){ me.style.left = m.d.x + 'px'; me.style.top = m.d.y + 'px'; }
      });
      frames.forEach(f => { f.g.x = f.x + ddx; f.g.y = f.y + ddy;
        const fe = document.querySelector(`.group[data-gid="${f.g.id}"]`);
        if (fe){ fe.style.left = f.g.x + 'px'; fe.style.top = f.g.y + 'px'; }
      });
      doc.x = ox + (ev.clientX - sx) / z;
      doc.y = oy + (ev.clientY - sy) / z;
      el.style.left = doc.x + 'px'; el.style.top = doc.y + 'px';
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      save();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function wireHandles(el, doc){
  el.querySelectorAll('.h').forEach(h => {
    h.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      select(doc.id);
      const dir = h.dataset.dir, z = cam.z * fitZoom();
      const sx = e.clientX, sy = e.clientY, ow = doc.w, oh = doc.h, ox = doc.x, oy = doc.y;
      const move = ev => {
        const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
        let w = ow, hh = oh, x = ox, y = oy;
        if (dir.includes('e')) w = Math.max(140, ow + dx);
        if (dir.includes('s')) hh = Math.max(90, oh + dy);
        if (dir.includes('w')){ w = Math.max(140, ow - dx); x = ox + (ow - w); }
        if (dir.includes('n')){ hh = Math.max(90, oh - dy); y = oy + (oh - hh); }
        doc.w = w; doc.h = hh; doc.x = x; doc.y = y;
        el.style.width = w + 'px'; el.style.height = hh + 'px';
        el.style.left = x + 'px'; el.style.top = y + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        save();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  });
}

/* ---------------------------------------------------------------- docs */
function findDoc(id){ return curShelf().docs.find(d => d.id === id); }
let zTop = 10;
const REGION_COLORS = [
  { key:'amber',  name:'Amber',   hex:'#e0a94f' },
  { key:'sky',    name:'Sky',     hex:'#5ec8f0' },
  { key:'mint',   name:'Mint',    hex:'#6fd9a0' },
  { key:'rose',   name:'Rose',    hex:'#f08fa6' },
  { key:'violet', name:'Violet',  hex:'#a78bfa' },
  { key:'lime',   name:'Lime',    hex:'#c6e85a' },
  { key:'orange', name:'Orange',  hex:'#f2924e' },
  { key:'slate',  name:'Slate',   hex:'#8fa6b8' }
];
const regionHex = g => (REGION_COLORS.find(c => c.key === g.color) || REGION_COLORS[0]).hex;
function regionVars(g){
  if (!g.color) return '';
  const hex = regionHex(g), r = parseInt(hex.slice(1,3),16), gr = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `--rg:${hex};--rg-rgb:${r},${gr},${b};`;
}

function paintSelection(){
  document.querySelectorAll('.obj').forEach(o => o.classList.toggle('selected', sel.has(o.dataset.id)));
  document.querySelectorAll('.group').forEach(g => g.classList.toggle('selected', gsel.has(g.dataset.gid)));
  const btn = $('#btnDelete');
  const n = sel.size + gsel.size;
  if (btn) btn.disabled = n === 0;
  if (btn && n > 1) btn.title = 'Delete ' + n + ' items';
  else if (btn) btn.title = 'Delete';
}

function select(id){
  sel = new Set(id ? [id] : []);
  gsel = new Set();
  selected = id || null;
  if (id){ const el = document.querySelector(`.obj[data-id="${id}"]`); if (el) el.style.zIndex = ++zTop; }
  paintSelection();
}

function toggleSel(id){
  const el = document.querySelector(`.obj[data-id="${id}"]`);
  if (sel.has(id)) sel.delete(id); else { sel.add(id); if (el) el.style.zIndex = ++zTop; }
  selected = sel.has(id) ? id : (sel.size ? [...sel][sel.size - 1] : null);
  paintSelection();
}

function addSel(id){
  if (!sel.has(id)){ sel.add(id); const el = document.querySelector(`.obj[data-id="${id}"]`); if (el) el.style.zIndex = ++zTop; }
  selected = id;
  paintSelection();
}

function selectMany(ids){
  sel = new Set(ids);
  gsel = new Set();
  selected = ids.length ? ids[ids.length - 1] : null;
  paintSelection();
}

function clearSel(){ sel = new Set(); gsel = new Set(); selected = null; paintSelection(); }

const selDocs = () => curShelf().docs.filter(d => sel.has(d.id));
const selIds  = () => [...sel].filter(id => findDoc(id));

function place(kind, title, extra = {}, size = { w: 300, h: 200 }){
  const p = screenToPanel(innerWidth/2, innerHeight/2);
  const n = curShelf().docs.length;
  const doc = { id:'o'+Math.random().toString(36).slice(2,9), kind, title,
    x: p.x - size.w/2 + (n % 5) * 24, y: p.y - size.h/2 + (n % 5) * 20,
    w: size.w, h: size.h, ...extra };
  curShelf().docs.push(doc);
  save(); render(); select(doc.id);
  return doc;
}

function newNote(){ const d = place('note','Untitled note', { text:'<p><br></p>' }, { w:300, h:180 });
  const el = document.querySelector(`.obj[data-id="${d.id}"] .body`); if (el) el.focus(); }
function newText(){ place('text','Untitled.md', { text:'' }, { w:420, h:320 }); }

function removeSelection(){
  const ids = selIds();
  const gids = [...gsel].filter(id => curShelf().groups.some(g => g.id === id));
  if (!ids.length && !gids.length) return;
  if (gids.length){
    const s0 = curShelf();
    s0.groups = s0.groups.filter(g => !gsel.has(g.id));
  }
  if (!ids.length){ clearSel(); save(); render(); return; }
  const s = curShelf();
  const gone = [];
  ids.forEach(id => {
    const i = s.docs.findIndex(d => d.id === id);
    if (i >= 0) gone.push(s.docs.splice(i, 1)[0]);
  });
  // a card's file only goes when nothing else on any shelf still points at it
  gone.forEach(doc => {
    if (!doc.blobId) return;
    const inUse = db.levels.some(l => l.shelves.some(sh => sh.docs.some(d => d.blobId === doc.blobId)));
    if (!inUse){ idb.del(doc.blobId); vault.delBlob(doc.blobId); }
    if (urls.has(doc.id)){ URL.revokeObjectURL(urls.get(doc.id)); urls.delete(doc.id); }
  });
  clearSel();
  save(); render();
  setSaveState(gone.length > 1 ? 'deleted ' + gone.length + ' items' : 'deleted', 'ok');
}

function removeDoc(id){
  const s = curShelf();
  const i = s.docs.findIndex(d => d.id === id);
  if (i < 0) return;
  const [doc] = s.docs.splice(i, 1);
  if (doc.blobId){
    // a duplicated or pasted card shares the same content-addressed blob
    const stillUsed = db.levels.some(l => l.shelves.some(sh => sh.docs.some(d => d.blobId === doc.blobId)));
    if (!stillUsed){ idb.del(doc.blobId); vault.delBlob(doc.blobId); }
  }
  if (urls.has(doc.id)){ URL.revokeObjectURL(urls.get(doc.id)); urls.delete(doc.id); }
  sel.delete(id);
  if (selected === id) selected = sel.size ? [...sel][sel.size - 1] : null;
  paintSelection();
  save(); render();
}

function kindFor(name){
  if (MODEL_EXT.test(name)) return 'model';
  if (PDF_EXT.test(name)) return 'pdf';
  if (IMG_EXT.test(name)) return 'image';
  if (VID_EXT.test(name)) return 'video';
  if (AUD_EXT.test(name)) return 'audio';
  if (TEXT_EXT.test(name)) return 'text';
  return 'file';
}

function placeDoc(meta, at){
  const kind = meta.kind || kindFor(meta.name);
  const p = at || screenToPanel(innerWidth/2, innerHeight/2);
  const w = kind === 'image' ? 360 : kind === 'pdf' ? 420 : kind === 'model' ? 420 : 340;
  const h = kind === 'image' ? 260 : kind === 'pdf' ? 520 : kind === 'model' ? 320 : 300;
  const k = curShelf().docs.length;
  const doc = { id:'o'+Math.random().toString(36).slice(2,9), kind, title:meta.name,
    x:p.x - w/2 + (k % 3) * (w + 26), y:p.y - h/2 + Math.floor(k / 3) * (h + 22),
    w, h, blobId:meta.blobId, ext:meta.ext, size:meta.size,
    ...(meta.text !== null && meta.text !== undefined ? { text: meta.text } : {}) };
  curShelf().docs.push(doc);
  return doc;
}

async function addFiles(files, at){
  for (const f of files){
    const kind = kindFor(f.name);
    const id = 'b' + Math.random().toString(36).slice(2,10);
    await storeBlob(id, f);
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    let text = null;
    if (kind === 'text') text = await f.text();
    const doc = placeDoc({ name:f.name, ext, kind, blobId:id, size:f.size, text }, at);
    const rec = await idb.get(id);
    if (rec) urls.set(doc.id, URL.createObjectURL(rec.blob));
  }
  save(); render();
}

/* desktop: the picker hands back paths, the Rust side copies the files and
   returns metadata, so multi-hundred-megabyte models never cross into JS */
async function desktopImport(at){
  const paths = await vault.pick();
  if (paths && paths.length) await importPaths(paths, at);
}

async function importPaths(paths, at){
  if (!paths || !paths.length) return;
  let items = [];
  try { items = await vault.importPaths(paths); }
  catch (e){ note('errors', e); setSaveState('could not read those files', 'bad'); return; }
  for (const it of items){
    const kind = kindFor(it.name);
    let text = null;
    if (kind === 'text'){
      const b = await vault.getBlob(it.blob_id);
      if (b) text = await b.text();
    }
    placeDoc({ name: it.name, ext: it.ext, kind, blobId: it.blob_id, size: it.size, text }, at);
  }
  save(); render();
}

async function addUrl(){
  const raw = prompt('Paste a URL (image, .glb/.obj/.stl model, PDF, or any page)');
  if (!raw) return;
  const url = raw.trim();
  const name = (url.split('/').pop() || 'link').split('?')[0] || 'link';
  const kind = kindFor(name);
  const p = screenToPanel(innerWidth/2, innerHeight/2);
  if (kind === 'file'){
    const doc = { id:'o'+Math.random().toString(36).slice(2,9), kind:'link', title:name, url,
      x:p.x-260, y:p.y-180, w:520, h:360 };
    curShelf().docs.push(doc); save(); render(); return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type });
    await addFiles([file], p);
  } catch (e){
    alert('Could not download that (the site may block cross-origin requests).\nAdding it as an embedded link instead.');
    const doc = { id:'o'+Math.random().toString(36).slice(2,9), kind:'link', title:name, url,
      x:p.x-260, y:p.y-180, w:520, h:360 };
    curShelf().docs.push(doc); save(); render();
  }
}

/* ---------------------------------------------------------------- nav */
function goShelf(i){
  if (i < 0 || i >= curLevel().shelves.length) return;
  stash(); shelf = i; cam = { ...(curShelf().pan || {x:0,y:0,z:1}) };
  selected = null; render();
}
let navTimer = 0;
/* A rename starting mid-transition would be wiped by the render this schedules,
   so the pending switch is cancelled when the second click turns a label into a
   text box — you asked to rename the category, not to travel into it. */
function cancelNav(){
  if (!navTimer) return;
  clearTimeout(navTimer); navTimer = 0;
  const w = $('#world');
  w.style.transition = 'opacity .2s ease';
  w.style.opacity = '1';
}

function goLevel(i){
  if (i < 0 || i >= db.levels.length || i === level) return;
  const w = $('#world');
  w.style.transition = 'transform .26s ease, opacity .26s ease';
  w.style.opacity = '0';
  navTimer = setTimeout(() => {
    navTimer = 0;
    level = i; shelf = 0; clearSel();
    cam = { ...(curShelf().pan || {x:0,y:0,z:1}) };
    render();
    w.style.transition = 'opacity .3s ease';
    w.style.opacity = '1';
  }, 240);
}
/* Every card and region on the shelf, as one rectangle. */
function contentBounds(){
  const s = curShelf();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, w, h) => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  };
  (s.docs || []).forEach(d => add(d.x, d.y, d.w || 300, d.h || 200));
  (s.groups || []).forEach(g => add(g.x, g.y, g.w, g.h));
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/* Fit means: every element on screen, whatever its distance from the centre. */
function fitView(pad = 88){
  const b = contentBounds();
  if (!b){ cam = { x:0, y:0, z:1 }; stash(); applyCam(); return; }
  const availW = Math.max(240, innerWidth - RAILW - pad * 2);
  const availH = Math.max(180, innerHeight - 34 - pad * 2);
  const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
  // never magnify past 1.5x world scale — a single card should not fill the screen
  const zAbs = Math.min(availW / w, availH / h, 1.5);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  // screen = midX + z * (world - SW/2 - cam.x), so the bbox centre lands at midX
  cam = { z: zAbs / fitZoom(), x: cx - SW / 2, y: cy - SH / 2 };
  stash(); applyCam();
}

function toggleDraw(on){
  drawMode = (on === undefined) ? !drawMode : !!on;
  document.body.classList.toggle('drawmode', drawMode);
  const b = document.querySelector('[data-tool="region"]');
  if (b) b.classList.toggle('on', drawMode);
}

/* ---------------------------------------------------------------- input */
addEventListener('keydown', e => {
  const typing = e.target.isContentEditable || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT';
  if (e.key === 'Escape'){
    if (settingsOpen()){ closeSettings(); return; }
    if (drawMode) toggleDraw(false);
    if (typing) e.target.blur();
    select(null); return;
  }
  if (settingsOpen()) return;
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey){
    const k = (e.key || '').toLowerCase();
    if (k === 'z' && !e.shiftKey){ e.preventDefault(); undo(); return; }
    if ((k === 'z' && e.shiftKey) || k === 'y'){ e.preventDefault(); redo(); return; }
    if (k === 'c' && sel.size){ e.preventDefault(); copySelection(); return; }
    if (k === 'x' && sel.size){ e.preventDefault(); cutSelection(); return; }
    if (k === 'v' && CLIP){ e.preventDefault(); pasteClipboard(); return; }
    if (k === 'a'){ e.preventDefault(); selectMany(curShelf().docs.map(d => d.id)); return; }
  }
  switch (e.key){
    case 'ArrowUp': e.preventDefault(); goLevel(level-1); break;
    case 'ArrowDown': e.preventDefault(); goLevel(level+1); break;
    case 'ArrowLeft': e.preventDefault(); goShelf(shelf-1); break;
    case 'ArrowRight': e.preventDefault(); goShelf(shelf+1); break;
    case 'n': case 'N': e.preventDefault(); newNote(); break;
    case 't': case 'T': e.preventDefault(); newText(); break;
    case 'f': case 'F': e.preventDefault(); fitView(); break;
    case 'g': case 'G': e.preventDefault(); toggleDraw(); break;
    case 's': case 'S': e.preventDefault(); openSettings(); break;
    case '?': e.preventDefault(); showShortcuts(); break;
    case ']': if (sel.size){ e.preventDefault(); bringToFront(); } break;
    case '[': if (sel.size){ e.preventDefault(); sendToBack(); } break;
    case 'c': case 'C': if (sel.size){ e.preventDefault(); centreSelection(); } break;
    case 'a': case 'A': if (!(e.ctrlKey || e.metaKey)){ e.preventDefault(); selectMany(curShelf().docs.map(d => d.id)); } break;
    case 'Escape': if (sel.size || gsel.size){ clearSel(); render(); } break;
    case 'F2': e.preventDefault(); renameCurrent('project'); break;
    case 'd': case 'D':
      if (e.ctrlKey || e.metaKey){ e.preventDefault(); duplicateSelected(); }
      break;
    case 'o': case 'O':
      if (e.ctrlKey || e.metaKey){ e.preventDefault(); importNks(); }
      break;
    case 'e': case 'E':
      if ((e.ctrlKey || e.metaKey) && e.shiftKey){ e.preventDefault(); exportNks('board'); }
      break;
    case '=': case '+':
      if (e.ctrlKey || e.metaKey){ e.preventDefault(); zoomBy(1.25); }
      break;
    case '-':
      if (e.ctrlKey || e.metaKey){ e.preventDefault(); zoomBy(0.8); }
      break;
    case '0':
      if (e.ctrlKey || e.metaKey){ e.preventDefault(); zoomActual(); }
      break;
    case 'Delete': case 'Backspace': if (sel.size || gsel.size){ e.preventDefault(); removeSelection(); } break;
  }
});

document.querySelectorAll('.tb-tools button').forEach(b => {
  b.onclick = () => {
    switch (b.dataset.tool){
      case 'note': newNote(); break;
      case 'text': newText(); break;
      case 'import': DESKTOP ? desktopImport() : $('#fileinput').click(); break;
      case 'url': addUrl(); break;
      case 'fit': fitView(); break;
      case 'region': toggleDraw(); break;
      case 'delete': if (sel.size || gsel.size) removeSelection(); break;
    }
  };
});
$('#fileinput').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

/* settings panel */
buildThemes();
wireCustomEditor();
document.getElementById('openSettings').onclick = openSettings;
document.querySelectorAll('#settings [data-close]').forEach(el => el.onclick = closeSettings);
document.querySelectorAll('#settings .seg').forEach(seg =>
  seg.querySelectorAll('button').forEach(b => b.onclick = () => setSetting(seg.dataset.set, b.dataset.v)));
document.getElementById('settingsReset').onclick = () => { db.settings = { ...DEFAULT_SETTINGS }; applySettings(); save(); };
document.getElementById('vaultBtn').onclick = () => {
  if (DESKTOP) call('open_vault', {}).catch(e => note('errors', e));
  else alert('In the browser build the board lives in the dev server\u2019s vault folder.');
};

addEventListener('dragover', e => { e.preventDefault(); });
addEventListener('drop', async e => {
  e.preventDefault();
  const at = screenToPanel(e.clientX, e.clientY);
  if (e.dataTransfer && e.dataTransfer.files.length) await addFiles([...e.dataTransfer.files], at);
});

/* desktop: the OS drop arrives as paths through the Rust side, not as File objects */
if (DESKTOP && TAURI.event){
  TAURI.event.listen('nookstacks://drop', e => {
    importPaths(e.payload || []);
  });
}

/* pan + zoom */
const PAN = { moved: 0 };        // how far the last right-drag travelled: a pan is not a menu
(function(){
  const world = $('#world');
  // input goes on the stage, never on #world: #world is transformed, so its hit area
  // shrinks when zoomed out and the empty space around the board stops responding.
  const surface = $('#stage');
  let down = false, winPointer = -1, sx = 0, sy = 0, ox = 0, oy = 0;
  surface.addEventListener('contextmenu', e => e.preventDefault());

  // Mouse events, not pointer events: there is no capture state to wedge, and a lost
  // pointerup can never leave the board stuck in "dragging".
  surface.addEventListener('mousedown', e => {
    if (e.button > 2) return;
    // a 3D viewer owns the mouse on every button: right/middle pan the model, not the board
    if (e.target.closest('canvas.mesh')) return;
    if (drawMode && e.button === 0){
      const panelEl = world.querySelector('.panel:not(.peek)');
      if (!panelEl || e.target.closest('.obj, .grouphead, .gh, .gdel, #rail, .navarrow, .tb-tools')) return;
      e.preventDefault();
      const a0 = screenToPanel(e.clientX, e.clientY);
      const draft = document.createElement('div');
      draft.className = 'group draft';
      draft.innerHTML = '<span class="grouphead">new region</span>';
      panelEl.appendChild(draft);
      let last = a0;
      const move = ev => {
        last = screenToPanel(ev.clientX, ev.clientY);
        const x = Math.min(a0.x, last.x), y = Math.min(a0.y, last.y);
        const w = Math.abs(last.x - a0.x), h = Math.abs(last.y - a0.y);
        draft.style.left = x + 'px'; draft.style.top = y + 'px';
        draft.style.width = w + 'px'; draft.style.height = h + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        const x = Math.min(a0.x, last.x), y = Math.min(a0.y, last.y);
        const w = Math.abs(last.x - a0.x), h = Math.abs(last.y - a0.y);
        draft.remove();
        if (w < 80 || h < 60){ toggleDraw(false); return; }
        curShelf().groups.push({ id: 'g' + Math.random().toString(36).slice(2,9),
          name: 'Region ' + (curShelf().groups.length + 1), x, y, w, h });
        save(); toggleDraw(false); render();
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      return;
    }
    // chrome that owns its own gesture (card header, resize handle, close, field,
    // rail, and the whole top strip). A toolbar button used to fall through to
    // here: the press started a pan, which cleared the selection, so Delete had
    // nothing to delete and the board stayed locked to the cursor.
    const chrome = e.target.closest(
      '.obj .head, .obj .h, .obj .close, input, textarea, select, button, .navarrow,' +
      ' #rail, #topbar, .tb-tools, #menubar, .mb-drop, #settings, .drawer, #sheet, a[href]');
    if (chrome) return;

    const overElement = e.target.closest('.obj, .group');

    // right button moves the board, and only over bare canvas: an element keeps
    // the right button for its own context menu
    if (e.button === 2){
      // a card owns the right button (its own menu); a region does not — the board
      // still pans when the drag starts on a region's surface
      if (e.target.closest('.obj')) return;
      note('down');
      down = true; sx = e.clientX; sy = e.clientY; ox = cam.x; oy = cam.y; PAN.moved = 0;
      world.classList.add('dragging');
      return;
    }

    if (e.button !== 0) return;

    // left button over bare canvas draws a selection box; over a card the card
    // owns the press (select / drag / edit). Alt forces the box even inside a
    // region, so a board full of regions can still be swept in one gesture.
    if (overElement) return;
    startMarquee(e);
  });

  /* ------------------------------------------------------------ marquee */
  let mq = null;
  function startMarquee(e){
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const base = additive ? new Set(sel) : new Set();
    const gbase = additive ? new Set(gsel) : new Set();
    const box = document.createElement('div');
    box.id = 'marquee';
    document.body.appendChild(box);
    const x0 = e.clientX, y0 = e.clientY;
    mq = { x0, y0, additive, base, box, hit: new Set(), moved: false };

    const move = ev => {
      if (!mq) return;
      const x = Math.min(x0, ev.clientX), y = Math.min(y0, ev.clientY);
      const w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0);
      if (w > 3 || h > 3) mq.moved = true;
      mq.box.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      const r = { l:x, t:y, r:x + w, b:y + h };
      const hit = new Set(base);
      document.querySelectorAll('.panel:not(.peek) .obj').forEach(o => {
        const b = o.getBoundingClientRect();
        const inside = b.left < r.r && b.right > r.l && b.top < r.b && b.bottom > r.t;
        o.classList.toggle('marquee-hit', inside);
        if (inside) hit.add(o.dataset.id);
      });
      const ghit = new Set(gbase);
      document.querySelectorAll('.panel:not(.peek) .group:not(.draft)').forEach(o => {
        const b = o.getBoundingClientRect();
        const inside = b.left < r.r && b.right > r.l && b.top < r.b && b.bottom > r.t;
        o.classList.toggle('marquee-hit', inside);
        if (inside) ghit.add(o.dataset.gid);
      });
      mq.hit = hit; mq.ghit = ghit;
    };
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      if (!mq) return;
      const { moved, hit, ghit, box } = mq;
      mq = null;
      box.remove();
      document.querySelectorAll('.marquee-hit').forEach(o => o.classList.remove('marquee-hit'));
      if (!moved){ if (!additive){ clearSel(); } return; }   // a click on empty canvas
      selectMany([...hit]);
      gsel = new Set(ghit || []);
      paintSelection();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    e.preventDefault();
  }

  let pending = null, frame = 0;
  const move = e => {
    note('move');
    if (!down) return;
    // self-heal a missed mouseup: no buttons held means the gesture is over
    if (e.buttons === 0){ end(); return; }
    PAN.moved = Math.max(PAN.moved, Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy));
    // Windows fires contextmenu on the right press, before any movement: a drag
    // that has actually travelled dismisses the menu it opened
    if (PAN.moved > 4 && ctxEl) closeCtx();
    pending = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const ev = pending; if (!ev) return;
      try {
        const z = cam.z * fitZoom();
        cam.x = ox - (ev.clientX - sx) / z; cam.y = oy - (ev.clientY - sy) / z;
        applyCam(false);
      } catch (err) { note('errors', err); }
    });
  };
  const end = () => {
    note('up');
    if (!down) return;
    down = false;
    if (frame){ cancelAnimationFrame(frame); frame = 0; }
    world.classList.remove('dragging');
    stash();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  window.addEventListener('blur', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  const scrollsUnder = (el) => {
    for (let n = el; n && n !== surface; n = n.parentElement){
      if (!n.tagName) continue;
      if (n.tagName === 'TEXTAREA') return true;
      if (n.tagName === 'CANVAS' && n.classList.contains('mesh')) return true;   // orbit/zoom the model
      if (n.tagName === 'IFRAME') return true;
      const cs = getComputedStyle(n);
      const oy = cs.overflowY, ox = cs.overflowX;
      const canY = (oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1;
      const canX = (ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1;
      if (canY || canX) return true;
    }
    return false;
  };

  surface.addEventListener('wheel', e => {
    note('wheel');
    if (scrollsUnder(e.target)) return;      // the element keeps the wheel
    e.preventDefault();
    note('zooms');
    // exact: the world point under the cursor must not move
    const z0 = cam.z * fitZoom();
    const midX = (innerWidth + RAILW) / 2;
    const tx0 = midX - (SW/2 + cam.x) * z0;
    const ty0 = innerHeight/2 - (SH/2 + cam.y) * z0;
    const wx = (e.clientX - tx0) / z0, wy = (e.clientY - ty0) / z0;

    const step = e.ctrlKey ? 0.010 : 0.0022;          // ctrl = trackpad pinch, finer
    const MAXZ = 150, MINZ = 0.02;                    // screen px per world unit
    const z1 = Math.min(MAXZ, Math.max(MINZ, z0 * Math.exp(-Math.max(-600, Math.min(600, e.deltaY)) * step)));

    const tx1 = e.clientX - wx * z1, ty1 = e.clientY - wy * z1;
    cam.z = z1 / fitZoom();
    cam.x = (midX - tx1) / z1 - SW/2;
    cam.y = (innerHeight/2 - ty1) / z1 - SH/2;
    world.classList.add('dragging');
    applyCam(false);
    clearTimeout(world._zt);
    world._zt = setTimeout(() => { world.classList.remove('dragging'); stash(); }, 220);
  }, { passive:false });

  // double-click empty board zooms in a step, at the cursor
  surface.addEventListener('dblclick', e => {
    if (e.target.closest('.obj')) return;
    const z0 = cam.z * fitZoom();
    const midX = (innerWidth + RAILW) / 2;
    const tx0 = midX - (SW/2 + cam.x) * z0;
    const ty0 = innerHeight/2 - (SH/2 + cam.y) * z0;
    const wx = (e.clientX - tx0) / z0, wy = (e.clientY - ty0) / z0;
    const z1 = Math.min(150, z0 * 1.6);
    const tx1 = e.clientX - wx * z1, ty1 = e.clientY - wy * z1;
    cam.z = z1 / fitZoom();
    cam.x = (midX - tx1) / z1 - SW/2;
    cam.y = (innerHeight/2 - ty1) / z1 - SH/2;
    applyCam(); stash();
  });
})();

addEventListener('resize', () => applyCam(false));
addEventListener('blur', () => document.getElementById('world').classList.remove('dragging'));
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('.obj')) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (e.target.closest && e.target.closest('.obj .body')) return; e.preventDefault(); });

$('#addCat').onclick = addCategory;
$('#addProj').onclick = addProject;
$('#navPrev').onclick = () => goShelf(shelf - 1);
$('#navNext').onclick = () => goShelf(shelf + 1);

/* boot */
try { render(); } catch (e) {
  window.__err = e.message + '\n' + (e.stack || '');
  console.error(e);
}
window.__nookstacks = { get db(){ return db; }, vault, importNks, exportNks, addFiles, place, removeDoc, DBG,
  get cam(){ return { ...cam }; },
  get state(){ return { level, shelf, selected, selection: [...sel], docs: curShelf().docs.length }; },
  selectMany, toggleSel, clearSel,
  // test surface: drive layout and history without the mouse
  fitView, tidyBoard, render, undo, redo, select, save,
  get contentBounds(){ return contentBounds(); } };

/* go: read the vault, then draw */
/* ------------------------------------------------------------- undo / redo */
/* Snapshots rather than command objects: the board is small JSON, and a
   snapshot cannot get out of step with the state the way an inverse operation
   can once a drag, a rename and a paste have been replayed in a new order. */
const HIST = { past: [], future: [], last: '', t: 0, quiet: false };

function histPush(){
  if (HIST.quiet) return;
  const s = JSON.stringify(db);
  if (HIST.last === s) return;
  const now = Date.now();
  // a burst of typing is one undo step, not one per keystroke
  if (now - HIST.t < 700 && HIST.past.length > 1) HIST.past[HIST.past.length - 1] = s;
  else HIST.past.push(s);
  if (HIST.past.length > 80) HIST.past.shift();
  HIST.last = s; HIST.t = now; HIST.future.length = 0;
  paintHistory();
}

function restore(json, label){
  HIST.quiet = true;
  db = JSON.parse(json);
  HIST.last = json;
  level = Math.max(0, Math.min(db.levels.length - 1, level));
  shelf = Math.max(0, Math.min(curLevel().shelves.length - 1, shelf));
  clearSel();
  if (db.settings) applySettings();
  renderRail(); render(); save();
  HIST.quiet = false;
  setSaveState(label, 'ok');
  paintHistory();
}

function undo(){
  if (HIST.past.length < 2){ setSaveState('nothing to undo', 'bad'); return; }
  HIST.future.push(HIST.past.pop());
  restore(HIST.past[HIST.past.length - 1], 'undo');
}
function redo(){
  if (!HIST.future.length){ setSaveState('nothing to redo', 'bad'); return; }
  const s = HIST.future.pop();
  HIST.past.push(s);
  restore(s, 'redo');
}
const canUndo = () => HIST.past.length > 1;
const canRedo = () => HIST.future.length > 0;

function paintHistory(){
  const u = document.querySelector('[data-menu="Edit"]');
  if (u) u.dataset.canUndo = canUndo() ? '1' : '';
}

/* ------------------------------------------------------------- clipboard */
let CLIP = null;            // array of card snapshots
const canPaste = () => !!(CLIP && CLIP.length);

function copySelection(){
  const ds = selDocs();
  if (!ds.length) return false;
  CLIP = JSON.parse(JSON.stringify(ds));
  setSaveState(ds.length > 1 ? 'copied ' + ds.length + ' items' : 'copied “' + ds[0].title + '”', 'ok');
  return true;
}
function cutSelection(){
  if (!copySelection()) return;
  removeSelection();
  setSaveState('cut', 'ok');
}
function pasteClipboard(){
  if (!canPaste()) return;
  const made = [];
  CLIP.forEach(src => {
    const d = JSON.parse(JSON.stringify(src));
    d.id = 'o' + Math.random().toString(36).slice(2, 9);
    d.x = src.x + 28; d.y = src.y + 28;
    src.x = d.x; src.y = d.y;          // walk the next paste a step further
    if (d.title) d.title = d.title.replace(/(\scopy)?$/, ' copy');
    curShelf().docs.push(d);
    made.push(d);
  });
  save(); render(); selectMany(made.map(d => d.id));
}


/* ------------------------------------------------------------ context menu */
/* Right-click menus are built per element, the way every desktop app does it:
   the rows are the actions that make sense for that kind of card, and the
   empty board gets board-level actions instead. */
let ctxEl = null;

function closeCtx(){
  if (!ctxEl){ return; }
  ctxEl.remove(); ctxEl = null;
}

function openCtx(x, y, items){
  closeCtx();
  const el = document.createElement('div');
  el.id = 'ctx';
  el.setAttribute('role', 'menu');
  items.forEach(it => {
    if (it.sep){ const s = document.createElement('div'); s.className = 'ctx-sep'; el.appendChild(s); return; }
    if (it.head){ const h = document.createElement('div'); h.className = 'ctx-head'; h.textContent = it.head; el.appendChild(h); return; }
    const row = document.createElement('button');
    row.className = 'ctx-row' + (it.danger ? ' danger' : '') + (it.items ? ' has-sub' : '');
    row.setAttribute('role', 'menuitem');
    row.innerHTML = `<span>${it.items ? '<i class="sw-dot" style="background:' + (it.dot || 'transparent') + '"></i>' : ''}${esc(it.label)}</span>`
                  + (it.items ? '<i class="kb">▸</i>' : (it.key ? `<i class="kb">${esc(it.key)}</i>` : ''));
    if (it.need && !it.need()) row.classList.add('disabled');
    else if (it.items){
      row.addEventListener('mouseenter', () => openSub(row, it.items));
      row.addEventListener('focus', () => openSub(row, it.items));
      row.onclick = ev => { ev.stopPropagation(); openSub(row, it.items); };
    }
    else row.onclick = ev => { ev.stopPropagation(); closeCtx(); it.run(); };
    el.appendChild(row);
  });
  document.body.appendChild(el);
  ctxEl = el;
  // keep the menu on screen
  const r = el.getBoundingClientRect();
  const left = Math.min(x, innerWidth - r.width - 8);
  const top = Math.min(y, innerHeight - r.height - 8);
  el.style.left = Math.max(8, left) + 'px';
  el.style.top = Math.max(8, top) + 'px';
}

/* a submenu opens to the right of its row and stays inside the window */
function openSub(row, items){
  document.querySelectorAll('#ctx .ctx-sub').forEach(n => n.remove());
  const sub = document.createElement('div');
  sub.className = 'ctx-sub';
  const r = row.getBoundingClientRect();
  items.forEach(it => {
    if (it.sep){ const s = document.createElement('div'); s.className = 'ctx-sep'; sub.appendChild(s); return; }
    const b = document.createElement('button');
    b.className = 'ctx-row';
    b.innerHTML = (it.swatch ? '<i class="sw-dot" style="background:' + it.swatch + '"></i>' : '') + '<span>' + esc(it.label) + '</span>';
    b.onclick = ev => { ev.stopPropagation(); closeCtx(); it.run(); };
    sub.appendChild(b);
  });
  document.getElementById('ctx').appendChild(sub);
  // viewport coordinates: the menu itself is position:fixed, so its children's
  // offsetTop is not what the submenu should be measured against
  const sr0 = sub.getBoundingClientRect();
  let left = r.right + 4, top = r.top - 6;
  if (left + sr0.width > innerWidth - 8) left = Math.max(8, r.left - sr0.width - 4);
  if (top + sr0.height > innerHeight - 8) top = Math.max(8, innerHeight - sr0.height - 10);
  sub.style.left = left + 'px';
  sub.style.top = top + 'px';
}

/* one menu builder per kind of thing on the board */
function ctxForDoc(doc, at){
  const multi = sel.size > 1;
  const many = () => multi ? sel.size + ' items' : '“' + doc.title + '”';
  const items = [];

  if (doc.kind === 'note' || doc.kind === 'text'){
    items.push({ label: doc.kind === 'note' ? 'Edit note' : 'Edit document', key: 'Enter', run: () => focusDoc(doc) });
    items.push({ label: 'Copy text', run: () => copyDocText(doc) });
  } else if (doc.kind === 'link'){
    items.push({ label: 'Open link', run: () => openDoc(doc) });
    items.push({ label: 'Copy link', run: () => { if (doc.href) navigator.clipboard && navigator.clipboard.writeText(doc.href); } });
  } else if (doc.kind === 'model'){
    items.push({ label: 'Frame model', run: () => { const c = cardCanvas(doc); if (c && c.__viewer) c.__viewer.fit(); } });
    items.push({ label: 'Reset view', run: () => { const c = cardCanvas(doc); if (c && c.__viewer){ c.__viewer.fit(); c.__viewer.schedule(); } } });
    items.push({ label: 'Wireframe', run: () => toggleWire(doc) });
  } else if (doc.kind === 'video' || doc.kind === 'audio'){
    items.push({ label: 'Play / pause', run: () => togglePlay(doc) });
    items.push({ label: 'Loop', run: () => toggleLoop(doc) });
    items.push({ label: 'Open player', run: () => openDoc(doc) });
  } else {
    items.push({ label: 'Open', key: 'Enter', run: () => openDoc(doc) });
  }
  if (doc.blobId) items.push({ label: 'Save a copy…', run: () => downloadDoc(doc) });

  items.push({ sep: true });
  items.push({ label: 'Cut', key: 'Ctrl+X', run: () => cutSelection(), need: () => sel.size > 0 });
  items.push({ label: 'Copy', key: 'Ctrl+C', run: () => copySelection(), need: () => sel.size > 0 });
  items.push({ label: 'Duplicate', key: 'Ctrl+D', run: () => duplicateSelected(), need: () => sel.size > 0 });
  items.push({ label: multi ? 'Rename first item' : 'Rename…', key: 'F2', run: () => renameDoc(doc) });
  items.push({ sep: true });
  items.push({ label: 'Bring to front', key: ']', run: () => bringToFront(), need: () => sel.size > 0 });
  items.push({ label: 'Send to back', key: '[', run: () => sendToBack(), need: () => sel.size > 0 });
  items.push({ label: 'Centre on board', key: 'C', run: () => centreSelection(), need: () => sel.size > 0 });
  items.push({ sep: true });
  items.push({ label: multi ? 'Delete ' + sel.size + ' items' : 'Delete ' + many(), key: 'Del', danger: true, run: () => removeSelection() });
  return items;
}

function paintRegions(){
  const s = curShelf();
  (s.groups || []).forEach(gg => {
    const el = document.querySelector(`.group[data-gid="${gg.id}"]`);
    if (!el) return;
    const hex = regionHex(gg), [r, gr, b] = hex.slice(1).match(/../g).map(x => parseInt(x, 16));
    el.style.setProperty('--rg', hex);
    el.style.setProperty('--rg-rgb', `${r},${gr},${b}`);
  });
}

function setRegionColor(color){
  const gids = gsel.size ? [...gsel] : [];
  (curShelf().groups || []).forEach(g => { if (gids.includes(g.id)) g.color = color; });
  if (!gids.length) return;
  save(); paintRegions(); render();
  setSaveState(gids.length > 1 ? 'recoloured ' + gids.length + ' regions' : 'region colour', 'ok');
}

function ctxForRegion(g){
  const many = gsel.size > 1 ? gsel.size + ' regions' : 'this region';
  return [
    { head: g.name },
    { label: 'Colour', items: REGION_COLORS.map(c => ({
        label: c.name, swatch: c.hex,
        run: () => { if (!gsel.size) gsel = new Set([g.id]); setRegionColor(c.key); }
      })), dot: regionHex(g) },
    { sep: true },
    { label: 'Rename region…', run: () => renameRegion(g) },
    { label: 'Select the cards inside', run: () => {
        const inner = curShelf().docs.filter(d => d.x + d.w > g.x && d.x < g.x + g.w && d.y + d.h > g.y && d.y < g.y + g.h);
        selectMany(inner.map(d => d.id));
      } },
    { label: 'Fit to this region', run: () => {
        cam = { x: (g.x + g.w / 2) - SW / 2, y: (g.y + g.h / 2) - SH / 2, z: 1 };
        stash(); applyCam();
      } },
    { sep: true },
    { label: 'Delete ' + many, danger: true, run: () => {
        if (!gsel.size) gsel = new Set([g.id]);
        const s = curShelf();
        s.groups = s.groups.filter(x => !gsel.has(x.id));
        clearSel(); save(); render();
      } }
  ];
}

function ctxForBoard(){
  const empty = curShelf().docs.length === 0;
  return [
    { head: curLevel().name + ' / ' + curShelf().name },
    { label: 'New note', key: 'N', run: () => newNote() },
    { label: 'New document', key: 'T', run: () => newText() },
    { label: 'Paste', key: 'Ctrl+V', need: () => canPaste(), run: () => pasteClipboard() },
    { sep: true },
    { label: 'Select all', key: 'Ctrl+A', need: () => !empty, run: () => selectMany(curShelf().docs.map(d => d.id)) },
    { label: 'Fit board', key: 'F', run: () => fitView() },
    { label: 'Tidy board', need: () => !empty, run: () => tidyBoard() },
    { sep: true },
    { label: 'Zoom in', key: 'Ctrl++', run: () => zoomBy(1.15) },
    { label: 'Zoom out', key: 'Ctrl+−', run: () => zoomBy(1 / 1.15) },
    { label: 'Actual size', key: 'Ctrl+0', run: () => zoomActual() },
    { sep: true },
    { label: 'Settings…', key: 'S', run: () => openSettings() }
  ];
}

/* ------------------------------------------------------------ doc actions */
function cardEl(doc){ return document.querySelector(`.panel:not(.peek) .obj[data-id="${doc.id}"]`); }
function cardCanvas(doc){ const el = cardEl(doc); return el ? el.querySelector('canvas.mesh') : null; }

function focusDoc(doc){
  cam = { x: (doc.x + doc.w / 2) - SW / 2, y: (doc.y + doc.h / 2) - SH / 2, z: Math.max(cam.z, 0.9) };
  stash(); applyCam();
  const el = cardEl(doc);
  const body = el && el.querySelector('.body');
  if (body){
    if (doc.kind === 'note' && body.getAttribute('contenteditable') !== 'true') body.setAttribute('contenteditable', 'true');
    body.focus();
  }
}

function docPlainText(doc){
  const tmp = document.createElement('div');
  tmp.innerHTML = doc.text || '';
  return tmp.textContent || '';
}

function copyDocText(doc){
  const txt = docPlainText(doc);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt);
  setSaveState('copied text', 'ok');
}

function downloadDoc(doc){
  const url = urls.get(doc.id);
  if (!url){ setSaveState('no file loaded', 'bad'); return; }
  const a = document.createElement('a');
  a.href = url; a.download = doc.title || 'download';
  document.body.appendChild(a); a.click(); a.remove();
}

function openDoc(doc){
  if (doc.kind === 'link'){
    const href = doc.href || doc.url;
    if (href) window.open(href, '_blank', 'noopener');
    return;
  }
  const url = urls.get(doc.id);
  if (!url){ setSaveState('no file loaded', 'bad'); return; }
  openLightbox(doc, url);
}

function togglePlay(doc){
  const el = cardEl(doc); if (!el) return;
  const m = el.querySelector('video, audio'); if (!m) return;
  if (m.paused) m.play(); else m.pause();
}
function toggleLoop(doc){
  const el = cardEl(doc); if (!el) return;
  const m = el.querySelector('video, audio'); if (!m) return;
  m.loop = !m.loop;
  setSaveState('loop ' + (m.loop ? 'on' : 'off'), 'ok');
}
function toggleWire(doc){
  const c = cardCanvas(doc); const v = c && c.__viewer;
  if (!v) return;
  v.wire = !v.wire;
  v.scene.traverse(o => {
    if (o.isMesh && o.material && !Array.isArray(o.material)) o.material.wireframe = v.wire;
  });
  v.schedule && v.schedule();
  setSaveState('wireframe ' + (v.wire ? 'on' : 'off'), 'ok');
}

function renameDoc(doc){
  const el = cardEl(doc); if (!el) return;
  const span = el.querySelector('.head .title'); if (!span) return;
  const inp = document.createElement('input');
  inp.className = 'renamecard';
  inp.value = doc.title;
  span.replaceWith(inp);
  inp.focus(); inp.select();
  const commit = ok => {
    if (ok && inp.value.trim()) doc.title = inp.value.trim();
    save(); render();
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); commit(true); }
    if (e.key === 'Escape'){ e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('mousedown', e => e.stopPropagation());
  inp.addEventListener('click', e => e.stopPropagation());
}

function renameRegion(g){
  const el = document.querySelector(`.group[data-gid="${g.id}"] .grouphead`);
  if (!el) return;
  const inp = document.createElement('input');
  inp.value = g.name; inp.className = 'grename';
  el.textContent = '';
  el.appendChild(inp);
  inp.focus(); inp.select();
  const commit = ok => { if (ok && inp.value.trim()) g.name = inp.value.trim(); save(); render(); };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); commit(true); }
    if (e.key === 'Escape'){ e.preventDefault(); commit(false); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('mousedown', e => e.stopPropagation());
}

/* --------------------------------------------------------------- lightbox */
function openLightbox(doc, url){
  closeLightbox();
  const wrap = document.createElement('div');
  wrap.id = 'lightbox';
  const box = document.createElement('div');
  box.className = 'lb-box';
  const title = document.createElement('div');
  title.className = 'lb-head';
  title.innerHTML = `<span>${esc(doc.title)}</span><button class="lb-close" title="Close (Esc)">✕</button>`;

  let media;
  if (doc.kind === 'image') media = `<img src="${url}" alt="">`;
  else if (doc.kind === 'pdf') media = `<iframe src="${url}"></iframe>`;
  else if (doc.kind === 'video') media = `<video src="${url}" controls autoplay></video>`;
  else if (doc.kind === 'audio') media = `<audio src="${url}" controls autoplay style="width:min(640px,80vw)"></audio>`;
  else media = `<a class="lb-open" href="${url}" target="_blank" rel="noopener">Open ${esc(doc.title)}</a>`;

  box.innerHTML = '';
  box.appendChild(title);
  const stage = document.createElement('div');
  stage.className = 'lb-stage';
  stage.innerHTML = media;
  box.appendChild(stage);
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  const close = () => closeLightbox();
  title.querySelector('.lb-close').onclick = close;
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
}
function closeLightbox(){
  const w = document.getElementById('lightbox');
  if (!w) return;
  w.querySelectorAll('video, audio').forEach(m => { try { m.pause(); } catch (e) {} });
  w.remove();
}

/* ------------------------------------------------------------- right click */
document.addEventListener('contextmenu', e => {
  const inChrome = e.target.closest('#topbar, .tb-tools, #rail, #menubar, .mb-drop, #ctx, #lightbox');
  // a field that is not part of a card (rail rename, breadcrumb) keeps the native menu
  const bareField = e.target.closest('input, textarea') && !e.target.closest('.obj');
  if (inChrome || bareField) return;
  e.preventDefault();

  // a right-drag that moved was a pan, not a menu
  if (PAN.moved > 4){ PAN.moved = 0; return; }

  const objEl = e.target.closest('.panel:not(.peek) .obj');
  const grpEl = e.target.closest('.group');

  if (objEl){
    const doc = findDoc(objEl.dataset.id);
    if (!doc) return;
    if (!sel.has(doc.id)) select(doc.id);      // right-clicking outside a selection moves it
    openCtx(e.clientX, e.clientY, ctxForDoc(doc));
    return;
  }
  if (grpEl){
    const g = curShelf().groups.find(x => x.id === grpEl.dataset.gid);
    if (g) openCtx(e.clientX, e.clientY, ctxForRegion(g));
    return;
  }
  openCtx(e.clientX, e.clientY, ctxForBoard());
});

/* any press elsewhere, Escape, scroll or resize dismisses the menu */
window.addEventListener('mousedown', e => {
  if (ctxEl && !e.target.closest('#ctx')) closeCtx();
}, true);
window.addEventListener('keydown', e => { if (e.key === 'Escape'){ closeCtx(); closeLightbox(); } }, true);
window.addEventListener('blur', closeCtx);
window.addEventListener('resize', closeCtx);
window.addEventListener('wheel', closeCtx, { passive: true });


document.body.classList.add('booting');
boot();


/* ------------------------------------------------------------ menu bar */
/* One definition drives the bar, the dropdowns, the shortcuts and the About
   sheet. Adding a command means adding a row here. */

const APP_VERSION = '0.1.0';

function zoomBy(f){
  cam.z = Math.min(4, Math.max(0.25, cam.z * f));
  stash(); applyCam();
}
function zoomActual(){ cam = { ...cam, z: 1 }; stash(); applyCam(); }

function duplicateSelected(){
  const srcs = selDocs();
  if (!srcs.length) return;
  const s = curShelf();
  const made = [];
  srcs.forEach(src => {
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = 'o' + Math.random().toString(36).slice(2, 9);
    copy.x += 28; copy.y += 28;
    copy.title = src.title.replace(/(\scopy)?$/, ' copy');
    copy.blobId = src.blobId;        // content-addressed, so sharing is safe
    s.docs.push(copy);
    made.push(copy);
  });
  save(); render(); selectMany(made.map(d => d.id));
}

function bringToFront(){
  const ids = selIds(); if (!ids.length) return;
  const s = curShelf();
  const moved = s.docs.filter(d => sel.has(d.id));
  s.docs = s.docs.filter(d => !sel.has(d.id)).concat(moved);   // keeps their relative order
  save(); render(); paintSelection();
}
function sendToBack(){
  const ids = selIds(); if (!ids.length) return;
  const s = curShelf();
  const moved = s.docs.filter(d => sel.has(d.id));
  s.docs = moved.concat(s.docs.filter(d => !sel.has(d.id)));
  save(); render(); paintSelection();
}

/* Pack the board into balanced columns using each card's real size.
   A region is a layout unit: its cards stack inside it and the region is
   measured to wrap them, so tidying can never leave a card half outside a
   region or let a wide card overlap its neighbour. */
function tidyBoard(){
  const s = curShelf();
  if (!s.docs.length) return;

  const GAP_X = 40, GAP_Y = 36, ORIGIN = 90;
  const PAD_X = 30, PAD_TOP = 54, PAD_BOT = 30, ROW_GAP = 26;
  const W = d => Math.max(220, d.w || 300);
  const H = d => Math.max(120, d.h || 200);

  // 1. units: every region takes the cards that were inside it; the rest stand alone
  const claimed = new Set();
  const units = [];
  (s.groups || []).forEach(g => {
    const members = s.docs.filter(d => d.x + W(d) > g.x && d.x < g.x + g.w &&
                                       d.y + H(d) > g.y && d.y < g.y + g.h);
    members.forEach(d => claimed.add(d.id));
    units.push({ g, cards: members });
  });
  s.docs.filter(d => !claimed.has(d.id)).forEach(d => units.push({ g: null, cards: [d] }));
  if (!units.length) return;

  // 2. keep the order the board already reads in
  const top = u => u.cards.length ? Math.min(...u.cards.map(d => d.y)) : u.g.y;
  units.sort((a, b) => (top(a) - top(b)) || (a.cards[0]?.x ?? a.g.x) - (b.cards[0]?.x ?? b.g.x));

  const unitW = u => u.g
    ? Math.max(u.g.w, ...u.cards.map(d => W(d) + PAD_X * 2), 300)
    : W(u.cards[0]);
  const colW = Math.max(300, ...units.map(unitW));
  const cols = Math.max(1, Math.min(4, Math.round(Math.sqrt(units.length))));
  const colY = new Array(cols).fill(ORIGIN);

  // 3. shortest column wins; each unit owns its column band outright
  units.forEach(u => {
    let c = 0;
    for (let k = 1; k < cols; k++) if (colY[k] < colY[c] - 0.5) c = k;
    const x = ORIGIN + c * (colW + GAP_X);

    if (u.g){
      const cards = u.cards;
      // stack the members and centre each inside the region's inner width,
      // so the padding reads even on both sides
      const innerW = cards.length ? Math.max(...cards.map(W)) : 320;
      let y = colY[c] + PAD_TOP;
      cards.forEach(d => {
        d.x = x + PAD_X + (innerW - W(d)) / 2;
        d.y = y;
        y += H(d) + ROW_GAP;
      });
      const bottom = cards.length ? y - ROW_GAP : colY[c] + 140;
      u.g.x = x; u.g.y = colY[c];
      u.g.w = Math.max(260, innerW + PAD_X * 2);
      u.g.h = Math.max(120, (bottom - u.g.y) + PAD_BOT);
      colY[c] = u.g.y + u.g.h + GAP_Y;
    } else {
      const d = u.cards[0];
      d.x = x; d.y = colY[c];
      colY[c] = d.y + H(d) + GAP_Y;
    }
  });

  save(); render(); fitView();
}

function renameCurrent(what){
  const kind = what === 'project' ? 'proj' : 'cat';
  const i = what === 'project' ? shelf : level;
  const row = document.querySelector(`#${what === 'project' ? 'projList' : 'catList'} .ritem[data-i="${i}"]`);
  if (row) startRename(row, kind, i);
}

function copyVaultPath(){
  const p = (DESKTOP && vault.path) ? vault.path : '(browser build: the dev server keeps the vault)';
  navigator.clipboard.writeText(p).then(
    () => setSaveState('vault path copied', 'ok'),
    () => alert(p)
  );
}

function boardInfo(){
  const docs = db.levels.reduce((n, l) => n + l.shelves.reduce((m, s) => m + s.docs.length, 0), 0);
  const blobs = db.levels.reduce((n, l) => n + l.shelves.reduce((m, s) =>
    m + s.docs.filter(d => d.blobId).length, 0), 0);
  alert(
    'Nookstacks ' + APP_VERSION + '\n\n' +
    db.levels.length + ' categories, ' +
    db.levels.reduce((n, l) => n + l.shelves.length, 0) + ' projects\n' +
    docs + ' documents on ' + docs + ' cards (' + blobs + ' with attached files)\n\n' +
    'Vault: ' + (DESKTOP && vault.path ? vault.path : 'browser (dev server)')
  );
}

/* ---- .nks bundles ---------------------------------------------------- */
function nksName(){ return (curShelf() && curShelf().name) || 'board'; }

async function exportNks(scope){
  try {
    setSaveState('packing .nks…', 'busy');
    let payload, name;
    if (scope === 'board'){
      // the exported file carries one project, at its own camera position
      payload = { settings: db.settings, levels: [{
        id: curLevel().id, name: curLevel().name,
        shelves: [JSON.parse(JSON.stringify(curShelf()))]
      }]};
      name = nksName();
    } else {
      payload = JSON.parse(JSON.stringify(db));
      name = 'all projects';
    }
    const res = await vault.exportBundle(payload, scope, name);
    if (res && res.cancelled) { setSaveState('export cancelled', 'bad'); return; }
    // never report a save that did not happen
    if (!res || res.error) throw new Error((res && res.error) || 'nothing was written');
    if (!res.bytes) throw new Error('the bundle came back empty');
    setSaveState('exported ' + Math.round(res.bytes / 1024) + ' KB', 'ok');
    if (res.path) $('#saveState').title = res.path;
  } catch (e){
    note('errors', e);
    setSaveState('export failed — ' + (e.message || e), 'bad');
  }
}

/* Import a bundle as a new project (board) or replace the tower (vault). */
async function importNks(provided){
  try {
    const res = provided || await vault.importBundle();
    if (!res) { setSaveState('import cancelled', 'bad'); return; }
    if (res.error) throw new Error(res.error);
    const m = res.manifest || {};
    if (m.scope === 'vault'){
      if (!confirm('This bundle contains every project (' + (res.state.levels || []).length + ' categories).\n\nImporting replaces the tower you have open now. Your current board is kept in the vault history.\n\nContinue?')) return;
      db.levels = res.state.levels || db.levels;
      if (res.state.settings) db.settings = { ...db.settings, ...res.state.settings };
      level = 0; shelf = 0; cam = { ...(curShelf().pan || { x:0, y:0, z:1 }) };
      applySettings(); save(); render(); fitView();
      setSaveState('imported ' + db.levels.length + ' categories', 'ok');
      return;
    }
    // a single board arrives as a new project on the current shelf row
    const inShelf = res.state.levels?.[0]?.shelves?.[0];
    if (!inShelf) throw new Error('bundle has no board in it');
    const names = curLevel().shelves.map(s => s.name);
    let name = inShelf.name || 'Imported board';
    if (names.includes(name)) name = name + ' (imported)';
    const fresh = JSON.parse(JSON.stringify(inShelf));
    fresh.id = 's' + Math.random().toString(36).slice(2, 8);
    fresh.name = name;
    (fresh.docs || []).forEach(d => { d.id = 'o' + Math.random().toString(36).slice(2, 9); });
    fresh.pan = { x: 0, y: 0, z: 1 };
    curLevel().shelves.push(fresh);
    save(); render();
    shelf = curLevel().shelves.length - 1; cam = { ...fresh.pan }; render(); fitView();
    setSaveState('imported “' + name + '”', 'ok');
  } catch (e){
    note('errors', e);
    setSaveState('import failed — ' + (e.message || e), 'bad');
  }
}

/* ---- settings as a file ---------------------------------------------- */
function exportSettings(){
  const blob = new Blob([JSON.stringify({ format: 'nookstacks.settings', version: 1, settings: settings() }, null, 2)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nookstacks-settings.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function importSettings(){
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || !j.settings) throw new Error('no settings in that file');
      db.settings = { ...DEFAULT_SETTINGS, ...j.settings };
      applySettings(); save();
      setSaveState('settings imported', 'ok');
    } catch (e){ setSaveState('settings import failed', 'bad'); note('errors', e); }
  };
  inp.click();
}

/* ---- overlays --------------------------------------------------------- */
function sheet(html){
  let el = document.getElementById('sheet');
  if (!el){
    el = document.createElement('div'); el.id = 'sheet';
    el.innerHTML = '<div class="card"></div>';
    el.addEventListener('click', e => { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
  }
  el.querySelector('.card').innerHTML = html;
  el.hidden = false;
}
function closeSheet(){ const el = document.getElementById('sheet'); if (el) el.hidden = true; }

const KEYS = [
  ['↑ ↓', 'previous / next category'],
  ['← →', 'previous / next project'],
  ['N', 'new note'], ['T', 'new document'],
  ['G', 'draw a region'], ['F', 'fit the board'],
  ['S', 'settings'], ['Esc', 'close, cancel, deselect'],
  ['Del', 'delete selection'],
  ['Ctrl+D', 'duplicate selection'],
  ['Ctrl++', 'zoom in'], ['Ctrl+−', 'zoom out'], ['Ctrl+0', 'actual size'],
  ['[ ]', 'send to back / bring to front'],
  ['F2', 'rename project'],
  ['Ctrl+Shift+E', 'export this board as .nks'],
  ['Ctrl+O', 'open a .nks board'],
  ['Alt+F', 'open a menu with the keyboard'],
  ['double-click', 'edit a note or rename a region'],
  ['right-drag', 'pan the board'], ['wheel', 'zoom']
];
function showShortcuts(){
  sheet('<h3>Keyboard</h3><table>' + KEYS.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + '</table>');
}
function showAbout(){
  sheet(`<h3>About</h3><div class="about">
    <p><b>Nookstacks</b> — a tower of project bookshelves. Every category is a level, every project a shelf,
    every shelf an infinite board.</p>
    <p>Local only: no account, no sync service, no telemetry. Your board is a folder you own.</p>
    <p class="ver">version ${APP_VERSION} · MIT licence</p></div>`);
}

/* ---- the menu itself -------------------------------------------------- */
const MENUS = [
  { label: 'File', items: [
    { label: 'New note', key: 'N', run: () => newNote() },
    { label: 'New document', key: 'T', run: () => newText() },
    { sep: true },
    { label: 'Import files…', key: 'I', run: () => DESKTOP ? desktopImport() : $('#fileinput').click() },
    { label: 'Place from URL…', run: () => addUrl() },
    { sep: true },
    { label: 'Open board…', key: 'Ctrl+O', run: () => importNks() },
    { label: 'Export this board…', key: 'Ctrl+Shift+E', run: () => exportNks('board') },
    { label: 'Export all projects…', run: () => exportNks('vault') },
    { sep: true },
    { label: 'Quit', key: 'Ctrl+Q', run: () => { if (DESKTOP) call('quit_app', {}); else window.close(); } }
  ]},
  { label: 'Edit', items: [
    { label: 'Undo', key: 'Ctrl+Z', run: () => undo(), need: () => canUndo() },
    { label: 'Redo', key: 'Ctrl+Shift+Z', run: () => redo(), need: () => canRedo() },
    { sep: true },
    { label: 'Cut', key: 'Ctrl+X', run: () => cutSelection(), need: 'selection' },
    { label: 'Copy', key: 'Ctrl+C', run: () => copySelection(), need: 'selection' },
    { label: 'Paste', key: 'Ctrl+V', run: () => pasteClipboard(), need: () => canPaste() },
    { sep: true },
    { label: 'Duplicate', key: 'Ctrl+D', run: () => duplicateSelected(), need: 'selection' },
    { label: 'Select all', key: 'Ctrl+A', run: () => selectMany(curShelf().docs.map(d => d.id)) },
    { label: 'Delete', key: 'Del', run: () => removeSelection(), need: 'selection' },
    { sep: true },
    { label: 'Rename project', key: 'F2', run: () => renameCurrent('project') },
    { label: 'Rename category', run: () => renameCurrent('category') }
  ]},
  { label: 'Preferences', items: [
    { label: 'Preferences…', key: 'S', run: () => openSettings() },
    { sep: true },
    { title: 'Theme' },
    ...THEMES.map(t => ({ label: t.name, check: () => settings().theme === t.id,
        run: () => { settings().theme = t.id; applySettings(); save(); } })),
    { sep: true },
    { title: 'Text size' },
    ...[['compact','Small'],['regular','Normal'],['large','Large']].map(([v, n]) => ({
        label: n, check: () => settings().size === v, run: () => setSetting('size', v) })),
    { sep: true },
    { label: 'Export settings…', run: () => exportSettings() },
    { label: 'Import settings…', run: () => importSettings() }
  ]},
  { label: 'View', items: [
    { label: 'Fit board', key: 'F', run: () => fitView() },
    { label: 'Zoom in', key: 'Ctrl++', run: () => zoomBy(1.25) },
    { label: 'Zoom out', key: 'Ctrl+−', run: () => zoomBy(0.8) },
    { label: 'Actual size', key: 'Ctrl+0', run: () => zoomActual() },
    { sep: true },
    { label: 'Board grid', check: () => settings().grid === 'on',
      run: () => setSetting('grid', settings().grid === 'on' ? 'off' : 'on') },
    { label: 'Reduce motion', check: () => settings().motion === 'reduce',
      run: () => setSetting('motion', settings().motion === 'reduce' ? 'full' : 'reduce') },
    { label: 'Show sidebar', check: () => !document.body.classList.contains('norail'),
      run: () => { document.body.classList.toggle('norail');
        const on = !document.body.classList.contains('norail');
        document.getElementById('rail').style.display = on ? '' : 'none';
        applyCam(); } }
  ]},
  { label: 'Arrange', items: [
    { label: 'Bring to front', key: ']', run: () => bringToFront(), need: 'selection' },
    { label: 'Send to back', key: '[', run: () => sendToBack(), need: 'selection' },
    { sep: true },
    { label: 'Tidy board', run: () => tidyBoard() },
    { label: 'Centre selection', key: 'C', run: () => centreSelection(), need: 'selection' }
  ]},
  { label: 'Extras', items: [
    { label: 'Open vault folder', run: () => DESKTOP ? call('open_vault', {}).catch(e => note('errors', e))
        : alert('Browser build: the vault is the dev server’s folder.') },
    { label: 'Copy vault path', run: () => copyVaultPath() },
    { sep: true },
    { label: 'Board info…', run: () => boardInfo() }
  ]},
  { label: 'Help', items: [
    { label: 'Keyboard shortcuts', key: '?', run: () => showShortcuts() },
    { label: 'README on GitHub', run: () => openExternal('https://github.com/OleMurpho/nookstacks#readme') },
    { sep: true },
    { label: 'About Nookstacks', run: () => showAbout() }
  ]}
];

function openExternal(url){
  if (DESKTOP) call('open_url', { url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
}

function centreSelection(){
  const ds = selDocs();
  if (!ds.length) return;
  const x0 = Math.min(...ds.map(d => d.x)), x1 = Math.max(...ds.map(d => d.x + d.w));
  const y0 = Math.min(...ds.map(d => d.y)), y1 = Math.max(...ds.map(d => d.y + d.h));
  cam.x = -((x0 + x1) / 2 - SW / 2);
  cam.y = -((y0 + y1) / 2 - SH / 2);
  stash(); applyCam();
}

let mbOpen = null;
function focusRow(i){
  if (!mbOpen) return;
  const rows = [...mbOpen.querySelectorAll('.mb-row:not(.disabled)')];
  rows.forEach(r => r.classList.remove('kb'));
  const row = rows[i];
  if (row){ row.classList.add('kb'); row.scrollIntoView({ block:'nearest' }); }
}
function closeMenus(){
  document.querySelectorAll('.mb-item.open').forEach(el => { el.classList.remove('open'); el.querySelector('.mb-drop').hidden = true; });
  mbOpen = null;
}
function openMenu(itemEl, keep){
  const drop = itemEl.querySelector('.mb-drop');
  const wasOpen = !drop.hidden;
  closeMenus();
  if (wasOpen && keep) return;
  // rebuild on open so checkmarks reflect current state
  drop.innerHTML = '';
  const def = MENUS.find(m => m.label === itemEl.dataset.menu);
  def.items.forEach(it => {
    if (it.sep){ const s = document.createElement('div'); s.className = 'mb-sep'; drop.appendChild(s); return; }
    if (it.title){ const t = document.createElement('div'); t.className = 'mb-title'; t.textContent = it.title; drop.appendChild(t); return; }
    const row = document.createElement('div');
    row.className = 'mb-row';
    const blocked = it.need === 'selection' ? sel.size === 0
                  : (typeof it.need === 'function' ? !it.need() : false);
    if (blocked) row.classList.add('disabled');
    const check = it.check ? (it.check() ? '✓' : '') : '';
    row.innerHTML = `<span class="mb-check">${check}</span><span>${esc(it.label)}</span>` +
      (it.key ? `<span class="mb-key">${esc(it.key)}</span>` : '');
    row.onclick = () => { closeMenus(); it.run(); };
    drop.appendChild(row);
  });
  drop.hidden = false;
  itemEl.classList.add('open');
  mbOpen = itemEl;
}

function buildMenus(){
  const nav = document.getElementById('mb-menus');
  MENUS.forEach(m => {
    const item = document.createElement('div');
    item.className = 'mb-item'; item.dataset.menu = m.label;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = m.label;
    const drop = document.createElement('div');
    drop.className = 'mb-drop'; drop.hidden = true;
    btn.onclick = e => { e.stopPropagation(); openMenu(item, true); };
    btn.onmouseenter = () => { if (mbOpen && mbOpen !== item) openMenu(item, false); };
    item.appendChild(btn); item.appendChild(drop);
    nav.appendChild(item);
  });
  document.addEventListener('click', e => { if (!e.target.closest('#menubar')) closeMenus(); });

  // desktop convention: Alt+letter opens a menu, arrows walk it, Enter runs
  addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey){
      const letter = (e.key || '').toLowerCase();
      const item = [...document.querySelectorAll('.mb-item')].find(i => i.dataset.menu[0].toLowerCase() === letter);
      if (item){ e.preventDefault(); openMenu(item, false); focusRow(0); }
      return;
    }
    if (!mbOpen) return;
    const rows = [...mbOpen.querySelectorAll('.mb-row:not(.disabled)')];
    if (!rows.length) return;
    const at = rows.findIndex(r => r.classList.contains('kb'));
    if (e.key === 'ArrowDown'){ e.preventDefault(); focusRow(Math.min(rows.length - 1, at + 1)); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); focusRow(Math.max(0, at - 1)); }
    else if (e.key === 'Enter' || e.key === ' '){
      if (at >= 0){ e.preventDefault(); rows[at].click(); }
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
      e.preventDefault();
      const all = [...document.querySelectorAll('.mb-item')];
      const i = all.indexOf(mbOpen);
      const next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      openMenu(next, false); focusRow(0);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape'){ closeMenus(); closeSheet(); }
  });
}
/* the breadcrumb is the other place a project is named, so it renames too */
function wireCrumb(){
  const lvl = document.getElementById('levelName');
  const proj = document.getElementById('projectName');
  if (!lvl || !proj) return;

  const rename = (which) => {
    const target = which === 'cat' ? lvl : proj;
    const i = which === 'cat' ? level : shelf;
    const arr = which === 'cat' ? db.levels : curLevel().shelves;
    if (!arr[i]) return;
    const inp = document.createElement('input');
    inp.className = 'crumbedit';
    inp.value = arr[i].name;
    target.replaceWith(inp);
    inp.focus(); inp.select();
    const commit = ok => {
      if (ok && inp.value.trim()) arr[i].name = inp.value.trim();
      save(); render();
    };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); commit(true); }
      if (e.key === 'Escape'){ e.preventDefault(); commit(false); }
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => commit(true));
  };

  let lastT = 0, lastWhich = '';
  const hit = (which) => e => {
    e.preventDefault();
    const now = Date.now();
    if (lastWhich === which && now - lastT < 450){ lastWhich = ''; rename(which); }
    else { lastT = now; lastWhich = which; }
  };
  lvl.addEventListener('dblclick', () => rename('cat'));
  proj.addEventListener('dblclick', () => rename('proj'));
  lvl.addEventListener('click', hit('cat'));
  proj.addEventListener('click', hit('proj'));
}
wireCrumb();

buildMenus();
window.__nookstacksMenu = { menus: MENUS, open: () => mbOpen, exportNks, importNks, tidyBoard, showShortcuts, showAbout };
