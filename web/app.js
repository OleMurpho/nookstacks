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
      const r = indexedDB.open('nookstacks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
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

/* ---------------------------------------------------------------- seed */
function seed(){
  const mk = (kind, title, x, y, w, h, extra = {}) => ({ id: 'o' + Math.random().toString(36).slice(2, 9), kind, title, x, y, w, h, ...extra });
  return { levels: [
    { id:'eng', name:'Engineering', shelves:[
      { id:'stormbreaker', name:'STORMBREAKER', pan:{x:0,y:0,z:1}, groups:[
          { id:'g1', name:'THERMALS', x:60, y:90, w:530, h:290 },
          { id:'g2', name:'POWER', x:612, y:90, w:300, h:230 },
          { id:'g3', name:'AGENTS', x:60, y:420, w:470, h:190 } ],
        docs:[
          mk('note','Ryzen 5 5500', 84, 140, 250, 170, { text:'<p>93&nbsp;°C under load with the stock cooler. Replaced paste and the top exhaust; idles at 41&nbsp;°C now.</p>' }),
          mk('text','Cooling plan.md', 352, 140, 210, 210, { text:'# Targets\n\n- CPU under 80 °C sustained\n- Case pressure neutral\n\nTwo 120 mm in,\none 140 mm out,\nbottom filtered.' }),
          mk('note','Loose cable', 634, 140, 250, 150, { text:'<p>Intermittent shutdown traced to a partially seated 24-pin. Reseated, then cable-tied to the frame.</p>' }),
          mk('note','Gateway', 84, 460, 420, 120, { text:'<p>One multiplexed host gateway serves default, archimedes and mnemosyne.</p>' })
        ] },
      { id:'wetnoodle', name:'WETNOODLE', pan:{x:0,y:0,z:1}, groups:[
          { id:'g4', name:'ARCHIVE', x:70, y:100, w:540, h:400 } ],
        docs:[ mk('note','Local memory', 96, 150, 260, 160, { text:'<p>Transcripts, skills and notes in one local SQLite archive.</p>' }) ] },
      { id:'nookstacks', name:'NOOKSTACKS', pan:{x:0,y:0,z:1}, groups:[
          { id:'g5', name:'CONCEPT', x:70, y:100, w:540, h:400 } ],
        docs:[ mk('note','The tower', 96, 150, 300, 170, { text:'<p>Category levels stacked vertically. Each level holds project bookshelves. Each bookshelf is an endless board.</p>' }) ] }
    ]},
    { id:'games', name:'Games', shelves:[
      { id:'suijin', name:'SUIJIN', pan:{x:0,y:0,z:1}, groups:[
          { id:'g6', name:'SYSTEMS', x:70, y:100, w:540, h:400 } ],
        docs:[ mk('text','Movement.txt', 96, 150, 280, 200, { text:'Water-driven traversal.\nCurrents push the player;\nthe player redirects them.' }) ] }
    ]},
    { id:'writing', name:'Writing', shelves:[
      { id:'novel', name:'LONG PROJECT', pan:{x:0,y:0,z:1}, groups:[
          { id:'g7', name:'DRAFT', x:70, y:100, w:540, h:400 } ],
        docs:[ mk('text','Chapter 1.md', 96, 150, 360, 280, { text:'# Chapter 1\n\nThe rain had stopped an hour before, which made the street louder rather than quieter.' }) ] }
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

let db = seed();

/* ---------------------------------------------------------------- settings */
const DEFAULT_SETTINGS = { theme:'obsidian', size:'regular', grid:'on', motion:'full' };
const THEMES = [
  { id:'obsidian',   name:'Obsidian',   sw:['#07080a','#151a20','#e0a94f','#f6f1e5'] },
  { id:'manuscript', name:'Manuscript', sw:['#12100c','#221c15','#d79a4a','#f5e8d0'] },
  { id:'graphite',   name:'Graphite',   sw:['#0b0d0f','#1a1f24','#8fb0dd','#eef1f5'] },
  { id:'daylight',   name:'Daylight',   sw:['#e8e4db','#ffffff','#a2621f','#fffdf8'] }
];
function settings(){ if (!db.settings) db.settings = { ...DEFAULT_SETTINGS }; return db.settings; }
function applySettings(){
  const s = settings(), r = document.documentElement;
  r.dataset.theme = s.theme; r.dataset.size = s.size;
  r.dataset.grid = s.grid; r.dataset.motion = s.motion;
  paintSettings();
}
function paintSettings(){
  const s = settings();
  document.querySelectorAll('#themeGrid button').forEach(b => b.classList.toggle('on', b.dataset.theme === s.theme));
  document.querySelectorAll('#settings .seg').forEach(seg => {
    const key = seg.dataset.set;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === s[key]));
  });
}
function buildThemes(){
  const grid = document.getElementById('themeGrid');
  if (!grid || grid.childElementCount) return;
  THEMES.forEach(t => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.theme = t.id;
    b.innerHTML = '<span class="swatch">' + t.sw.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>'
                + '<span class="trow"><span class="tname">' + t.name + '</span><span class="tick">●</span></span>';
    b.onclick = () => { settings().theme = t.id; applySettings(); save(); };
    grid.appendChild(b);
  });
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
  const reachable = await vault.ping();
  if (reachable){
    try {
      const res = await vault.getState();
      if (res && res.state && res.state.levels && res.state.levels.length){
        db = res.state;
        setSaveState('vault · ' + (res.saved ? new Date(res.saved).toLocaleString() : 'loaded'), 'ok');
        if (DESKTOP && vault.path) document.getElementById('saveState').title = vault.path;
      } else {
        // first run on a fresh vault: adopt whatever this browser already had
        const local = (() => { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch { return null; } })();
        if (local && local.levels && local.levels.length){ db = local; }
        storeReady = true;
        await vault.putState(db);
        setSaveState('vault created', 'ok');
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
  const u = doc.blobId ? `__pending__${doc.id}` : null;
  if (u) resolveBlobUrl(doc);
  return urls.get(doc.id) || null;
}
async function resolveBlobUrl(doc){
  let blob = null;
  if (vault.ok){
    try { blob = await vault.getBlob(doc.blobId); } catch {}
  }
  if (!blob){
    const rec = await idb.get(doc.blobId);
    if (rec) blob = rec.blob;
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
    default:
      return `<div class="body"><div class="filletile">${esc(doc.ext || 'file')} · ${(doc.size/1024||0).toFixed(0)} KB<br><br>${urls.get(doc.id) ? `<a href="${urls.get(doc.id)}" download="${esc(doc.title)}">download</a>` : 'stored locally'}</div></div>`;
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
  const state = { renderer, scene, camera, controls, raf:0, dead:false, ro:null, dirty:false };
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
  controls.addEventListener('change', schedule);
  if (typeof ResizeObserver !== 'undefined'){
    state.ro = new ResizeObserver(schedule);
    state.ro.observe(canvas.parentElement || canvas);
  }
  schedule();
  const origFit = fit;
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
    const groups = s.groups.map(g => `<div class="group" data-gid="${g.id}" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px">
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
  $('#btnDelete').disabled = !selected;
  $('#navPrev').hidden = shelf === 0;
  $('#navNext').hidden = shelf >= shelflist.length - 1;

  renderRail();

  // regions are objects now: give any legacy group an id
  cur.groups.forEach(g => { if (!g.id) g.id = 'g' + Math.random().toString(36).slice(2,9); });

  // wire current panel only
  world.querySelectorAll('.panel:not(.peek) .obj').forEach(el => {
    const doc = findDoc(el.dataset.id);
    if (!doc) return;
    if (doc.blobId && !urls.has(doc.id)) resolveBlobUrl(doc);
    wireBody(el, doc);
    wireHead(el, doc);
    wireHandles(el, doc);
    el.addEventListener('pointerdown', e => { if (e.button === 0) select(doc.id); }, true);
    el.querySelector('.close').onclick = e => { e.stopPropagation(); removeDoc(doc.id); };
    if (doc.kind === 'model'){
      const canvas = el.querySelector('canvas.mesh');
      if (canvas) viewers.push(makeViewer(canvas, doc));
    }
    if (selected === doc.id) el.classList.add('selected');
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

    // move by the label
    label.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const z = cam.z * fitZoom();
      const sx = e.clientX, sy = e.clientY, ox = g.x, oy = g.y;
      const move = ev => {
        g.x = ox + (ev.clientX - sx) / z;
        g.y = oy + (ev.clientY - sy) / z;
        el.style.left = g.x + 'px'; el.style.top = g.y + 'px';
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); save(); };
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
  wireRail($('#catList'));
  wireRail($('#projList'));
}

function wireRail(box){
  box.querySelectorAll('.ritem').forEach(row => {
    const kind = row.dataset.kind, i = +row.dataset.i;
    row.addEventListener('click', e => {
      if (e.target.closest('.mv') || e.target.tagName === 'INPUT') return;
      if (kind === 'cat') goLevel(i); else goShelf(i);
    });
    row.querySelector('.nm').addEventListener('dblclick', e => { e.stopPropagation(); startRename(row, kind, i); });
    row.querySelectorAll('.mv button').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation(); moveItem(kind, i, b.dataset.mv === 'up' ? -1 : 1);
    }));
  });
}

function startRename(row, kind, i){
  const nm = row.querySelector('.nm');
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
  level = db.levels.length - 1; shelf = 0; selected = null;
  cam = { x:0, y:0, z:1 };
  save(); render();
}

function addProject(){
  const id = 'p' + Math.random().toString(36).slice(2,9);
  curLevel().shelves.push({ id, name: 'New project', pan:{x:0,y:0,z:1}, groups:[], docs:[] });
  shelf = curLevel().shelves.length - 1;
  cam = { x:0, y:0, z:1 }; selected = null;
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
    e.preventDefault(); e.stopPropagation();
    select(doc.id);
    note('carddown');
    const z = cam.z * fitZoom();
    const sx = e.clientX, sy = e.clientY, ox = doc.x, oy = doc.y;
    const move = ev => {
      note('cardmove');
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
function select(id){ selected = id; $('#btnDelete').disabled = !id;
  const el = id && document.querySelector(`.obj[data-id="${id}"]`);
  if (el) el.style.zIndex = ++zTop;
  document.querySelectorAll('.obj').forEach(o => o.classList.toggle('selected', o.dataset.id === id)); }

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
  if (selected === id) selected = null;
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
function goLevel(i){
  if (i < 0 || i >= db.levels.length || i === level) return;
  const w = $('#world'), dir = i > level ? 1 : -1;
  w.style.transition = 'transform .26s ease, opacity .26s ease';
  w.style.opacity = '0';
  setTimeout(() => {
    level = i; shelf = 0; selected = null;
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
    if (k === 'c' && selected){ e.preventDefault(); copySelection(); return; }
    if (k === 'x' && selected){ e.preventDefault(); cutSelection(); return; }
    if (k === 'v' && CLIP){ e.preventDefault(); pasteClipboard(); return; }
    if (k === 'a'){ e.preventDefault(); return; }
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
    case ']': if (selected){ e.preventDefault(); bringToFront(); } break;
    case '[': if (selected){ e.preventDefault(); sendToBack(); } break;
    case 'c': case 'C': if (selected){ e.preventDefault(); centreSelection(); } break;
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
    case 'Delete': case 'Backspace': if (selected){ e.preventDefault(); removeDoc(selected); } break;
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
      case 'delete': if (selected) removeDoc(selected); break;
    }
  };
});
$('#fileinput').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

/* settings panel */
buildThemes();
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
    // chrome that owns its own gesture (card header, resize handle, close, field, rail)
    const owned = e.target.closest('.obj .head, .obj .h, .obj .close, input, textarea, .navarrow, #rail, canvas.mesh');
    if (e.button === 0 && owned) return;
    note('down');
    down = true; sx = e.clientX; sy = e.clientY; ox = cam.x; oy = cam.y;
    world.classList.add('dragging');            // no transition while the hand is down
    if (e.button === 0 && !e.target.closest('.obj')) select(null);
    e.preventDefault();
  });
  let pending = null, frame = 0;
  const move = e => {
    note('move');
    if (!down) return;
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
window.__nookstacks = { get db(){ return db; }, addFiles, place, removeDoc, DBG,
  get cam(){ return { ...cam }; },
  get state(){ return { level, shelf, selected, docs: curShelf().docs.length }; },
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
  selected = null;
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
let CLIP = null;
const canPaste = () => !!CLIP;

function copySelection(){
  const d = curShelf().docs.find(x => x.id === selected);
  if (!d) return false;
  CLIP = JSON.parse(JSON.stringify(d));
  setSaveState('copied “' + d.title + '”', 'ok');
  return true;
}
function cutSelection(){
  if (!copySelection()) return;
  removeDoc(selected);
  setSaveState('cut', 'ok');
}
function pasteClipboard(){
  if (!CLIP) return;
  const d = JSON.parse(JSON.stringify(CLIP));
  d.id = 'o' + Math.random().toString(36).slice(2, 9);
  d.x = CLIP.x + 28; d.y = CLIP.y + 28;
  CLIP.x = d.x; CLIP.y = d.y;          // walk the next paste a step further
  if (d.title) d.title = d.title.replace(/(\scopy)?$/, ' copy');
  curShelf().docs.push(d);
  save(); render(); select(d.id);
}

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
  if (!selected) return;
  const s = curShelf();
  const src = s.docs.find(d => d.id === selected);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = 'o' + Math.random().toString(36).slice(2, 9);
  copy.x += 28; copy.y += 28;
  copy.title = src.title.replace(/(\scopy)?$/, ' copy');
  copy.blobId = src.blobId;          // content-addressed, so sharing is safe
  s.docs.push(copy);
  save(); render(); select(copy.id);
}

function bringToFront(){
  if (!selected) return;
  const s = curShelf(); const i = s.docs.findIndex(d => d.id === selected);
  if (i < 0) return;
  const [d] = s.docs.splice(i, 1); s.docs.push(d);
  save(); render(); select(d.id);
}
function sendToBack(){
  if (!selected) return;
  const s = curShelf(); const i = s.docs.findIndex(d => d.id === selected);
  if (i < 0) return;
  const [d] = s.docs.splice(i, 1); s.docs.unshift(d);
  save(); render(); select(d.id);
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
    setSaveState('exported ' + (res.bytes ? Math.round(res.bytes / 1024) + ' KB' : ''), 'ok');
    if (res.path) $('#saveState').title = res.path;
  } catch (e){
    note('errors', e);
    setSaveState('export failed — ' + (e.message || e), 'bad');
  }
}

/* Import a bundle as a new project (board) or replace the tower (vault). */
async function importNks(){
  try {
    const res = await vault.importBundle();
    if (!res) { setSaveState('import cancelled', 'bad'); return; }
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
    { label: 'Delete', key: 'Del', run: () => selected && removeDoc(selected), need: 'selection' },
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
  if (!selected) return;
  const d = curShelf().docs.find(x => x.id === selected);
  if (!d) return;
  cam.x = -(d.x + d.w / 2 - SW / 2);
  cam.y = -(d.y + d.h / 2 - SH / 2);
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
    const blocked = it.need === 'selection' ? !selected
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
buildMenus();
window.__nookstacksMenu = { menus: MENUS, open: () => mbOpen, exportNks, importNks, tidyBoard, showShortcuts, showAbout };
