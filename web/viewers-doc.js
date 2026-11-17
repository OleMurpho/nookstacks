/* Document-shaped viewers: ebooks, DXF drawings, MIDI, 3MF meshes, mermaid
   diagrams and simple maps. */
(function(){
  const V = window.NK_VIEWERS = window.NK_VIEWERS || {};
  const esc0 = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtBytes = n => n == null ? '' : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const shell = (html, tools) => `<div class="body vbody"><div class="vtools">${tools || ''}<span class="vstat"></span>
      <button class="vbtn vexpand" title="Fill the window">⤢</button></div>
      <div class="vwrap">${html}</div></div>`;

  const sanitize = async html => {
    try { await window.NK.load('purify'); return window.DOMPurify.sanitize(html, { FORBID_TAGS: ['script', 'style', 'iframe', 'object'], FORBID_ATTR: ['onerror', 'onload', 'onclick'] }); }
    catch { return esc0(html); }
  };

  /* ---------------------------------------------------------------- ebooks */
  V.ebook = {
    size: [460, 520], badge: 'book',
    html(){ return shell('<div class="vload">opening book…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const blob = await api.blob(doc);
        if (!blob) throw new Error('no file');
        if ((doc.ext || '') === 'fb2'){
          const xml = new DOMParser().parseFromString(await blob.text(), 'application/xml');
          if (xml.querySelector('parsererror')) throw new Error('not valid FB2');
          const body = xml.querySelector('body');
          const parts = [...body.querySelectorAll(':scope > section')].map(s => {
            const t = s.querySelector('title');
            const title = t ? `<h3>${esc0(t.textContent.trim())}</h3>` : '';
            const ps = [...s.querySelectorAll('p')].map(p => `<p>${esc0(p.textContent)}</p>`).join('');
            return title + ps;
          });
          wrap.innerHTML = `<div class="book">${parts.join('<hr>') || esc0(body.textContent.slice(0, 40000))}</div>`;
          stat.textContent = `${parts.length} sections`;
          return;
        }
        const ZIP = window.NK_ZIP;
        if (!ZIP) throw new Error('zip reader missing');
        const files = await ZIP.readZip(new Uint8Array(await blob.arrayBuffer()));
        const read = async n => { const f = files.find(x => x.name.toLowerCase() === n.toLowerCase()) || files.find(x => x.name.toLowerCase().endsWith(n.toLowerCase())); if (!f) return null; return new TextDecoder().decode(await files.get(f)); };
        const container = await read('META-INF/container.xml');
        const opfPath = (container || '').match(/full-path="([^"]+)"/)?.[1];
        const opfText = opfPath ? await read(opfPath) : null;
        const opf = opfText ? new DOMParser().parseFromString(opfText, 'application/xml') : null;
        const base = opfPath ? opfPath.replace(/[^/]*$/, '') : '';
        const man = {};
        if (opf) for (const it of opf.querySelectorAll('manifest > item')) man[it.getAttribute('id')] = it.getAttribute('href');
        const spine = opf ? [...opf.querySelectorAll('spine > itemref')].map(r => man[r.getAttribute('idref')]).filter(Boolean) : [];
        const chapters = [];
        for (const href of spine.slice(0, 40)){
          const html = await read((base + href).replace(/^\.\//, ''));
          if (!html) continue;
          const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          chapters.push(await sanitize(m ? m[1] : html));
        }
        if (!chapters.length) throw new Error('no readable chapters');
        wrap.innerHTML = `<div class="book">${chapters.slice(0, 12).join('<hr>')}</div>`;
        stat.textContent = `${chapters.length} chapters${spine.length > 40 ? ' (first 40)' : ''} · ${fmtBytes(blob.size)}`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };

  /* ------------------------------------------------------------------- dxf */
  function parseDXF(text){
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([+lines[i].trim(), lines[i + 1]]);
    const ents = [];
    let inEntities = false, cur = null, poly = null;
    const push = () => { if (cur && cur.type) ents.push(cur); cur = null; };
    for (let i = 0; i < pairs.length; i++){
      const [code, val] = pairs[i];
      const v = (val || '').trim();
      if (code === 2 && v === 'ENTITIES'){ inEntities = true; continue; }
      if (code === 0 && v === 'ENDSEC'){ inEntities = false; push(); continue; }
      if (!inEntities) continue;
      if (code === 0){
        push();
        if (v === 'SEQEND'){ if (poly) { poly.closed = poly.closed || true; ents.push(poly); poly = null; } continue; }
        if (v === 'VERTEX' && poly){ poly.pts.push([]); cur = { type: 'VERTEX', pts: poly.pts[poly.pts.length - 1] }; continue; }
        cur = { type: v };
        if (v === 'POLYLINE'){ poly = { type: 'LWPOLYLINE', pts: [], closed: false }; cur = null; }
        else if (v === 'LWPOLYLINE'){ cur.pts = []; }
        continue;
      }
      const target = cur || (poly && poly.pts[poly.pts.length - 1] ? { pts: poly.pts[poly.pts.length - 1] } : null);
      if (!target) continue;
      if (code === 10) target.x = parseFloat(v);
      else if (code === 20) target.y = parseFloat(v);
      else if (code === 11) target.x2 = parseFloat(v);
      else if (code === 21) target.y2 = parseFloat(v);
      else if (code === 40) target.r = parseFloat(v);
      else if (code === 50) target.a0 = parseFloat(v);
      else if (code === 51) target.a1 = parseFloat(v);
      else if (code === 70 && cur){ cur.closed = (parseInt(v, 10) & 1) === 1; }
      else if (code === 42 && target.pts) target.bulge = parseFloat(v);
      else if (code === 8) target.layer = v;
      else if (code === 1 || code === 3) target.text = (target.text || '') + v;
    }
    push();
    return ents.filter(e => e.type && ['LINE', 'LWPOLYLINE', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT'].includes(e.type));
  }
  V.cad = {
    size: [520, 460], badge: 'cad',
    html(){ return shell('<div class="vload">reading drawing…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const text = doc.text != null ? doc.text : await (await api.blob(doc)).text();
        const ents = parseDXF(text);
        if (!ents.length) throw new Error('no geometry found');
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const box = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
        for (const e of ents){
          if (e.type === 'LINE'){ box(e.x, e.y); box(e.x2, e.y2); }
          else if (e.type === 'LWPOLYLINE') e.pts.forEach(p => box(p.x, p.y));
          else if (e.type === 'CIRCLE' || e.type === 'ARC'){ box(e.x - e.r, e.y - e.r); box(e.x + e.r, e.y + e.r); }
          else if (e.type === 'TEXT' || e.type === 'MTEXT') box(e.x, e.y);
        }
        if (!isFinite(x0)) throw new Error('geometry has no coordinates');
        const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6), pad = Math.max(w, h) * 0.04;
        const vb = `${x0 - pad} ${-(y1 + pad)} ${w + pad * 2} ${h + pad * 2}`;
        const strokes = [];
        for (const e of ents){
          if (e.type === 'LINE') strokes.push(`<line x1="${e.x}" y1="${-e.y}" x2="${e.x2}" y2="${-e.y2}"/>`);
          else if (e.type === 'LWPOLYLINE' && e.pts.length > 1)
            strokes.push(`<polyline points="${e.pts.map(p => `${p.x},${-p.y}`).join(' ')}"${e.closed ? ' class="cl"' : ''}/>`);
          else if (e.type === 'CIRCLE')
            strokes.push(`<circle cx="${e.x}" cy="${-e.y}" r="${e.r}" fill="none"/>`);
          else if (e.type === 'ARC'){
            const a0 = (e.a0 || 0) * Math.PI / 180, a1 = (e.a1 || 360) * Math.PI / 180;
            const sx = e.x + e.r * Math.cos(a0), sy = -(e.y + e.r * Math.sin(a0));
            const ex = e.x + e.r * Math.cos(a1), ey = -(e.y + e.r * Math.sin(a1));
            const large = (a1 - a0 + Math.PI * 2) % (Math.PI * 2) > Math.PI ? 1 : 0;
            strokes.push(`<path d="M${sx} ${sy}A${e.r} ${e.r} 0 ${large} 0 ${ex} ${ey}" fill="none"/>`);
          }
          else if ((e.type === 'TEXT' || e.type === 'MTEXT') && e.text)
            strokes.push(`<text x="${e.x}" y="${-e.y}" font-size="${Math.max(h / 60, 1)}">${esc0(e.text.slice(0, 80))}</text>`);
        }
        wrap.innerHTML = `<svg class="cad" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${strokes.join('')}</svg>`;
        const layers = new Set(ents.map(e => e.layer).filter(Boolean));
        stat.textContent = `${ents.length} entities · ${layers.size} layers`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };

  /* ------------------------------------------------------------------ midi */
  function parseMidi(u8){
  let p = 0;
  const tag = () => { const s = String.fromCharCode(u8[p], u8[p+1], u8[p+2], u8[p+3]); p += 4; return s; };
  const u32 = () => { const v = ((u8[p] << 24) | (u8[p+1] << 16) | (u8[p+2] << 8) | u8[p+3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = (u8[p] << 8) | u8[p+1]; p += 2; return v; };
  if (tag() !== 'MThd') throw new Error('not a MIDI file');
  const hlen = u32();
  const fmt = u16(), ntrks = u16(), div = u16();
  p += Math.max(0, hlen - 6);
  const ticksPerQ = (div & 0x8000) ? 480 : (div || 480);
  const notes = [], tempos = [{ tick: 0, us: 500000 }];

  for (let t = 0; t < ntrks && p + 8 <= u8.length; t++){
    if (tag() !== 'MTrk') break;
    const tlen = u32();
    const end = p + tlen;
    let tick = 0, status = 0;
    while (p < end){
      let delta = 0, b;
      do { b = u8[p++]; delta = (delta << 7) | (b & 0x7f); } while (b & 0x80);
      tick += delta;
      if (u8[p] & 0x80) status = u8[p++];
      const hi = status & 0xf0;

      if (status === 0xff){
        const type = u8[p++];
        let len = 0;
        do { b = u8[p++]; len = (len << 7) | (b & 0x7f); } while (b & 0x80);
        if (type === 0x51 && len >= 3) tempos.push({ tick, us: (u8[p] << 16) | (u8[p+1] << 8) | u8[p+2] });
        p += len;
      } else if (status === 0xf0 || status === 0xf7){
        let len = 0;
        do { b = u8[p++]; len = (len << 7) | (b & 0x7f); } while (b & 0x80);
        p += len;
      } else if (hi === 0x90){
        const note = u8[p++], vel = u8[p++];
        if (vel > 0) notes.push({ tick, note, vel, on: true, end: null });
        else for (let i = notes.length - 1; i >= 0; i--)
          if (notes[i].note === note && notes[i].end === null){ notes[i].end = tick; break; }
      } else if (hi === 0x80){
        const note = u8[p++]; p++;
        for (let i = notes.length - 1; i >= 0; i--)
          if (notes[i].note === note && notes[i].end === null){ notes[i].end = tick; break; }
      } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) p += 2;
      else if (hi === 0xc0 || hi === 0xd0) p += 1;
      else p += 1;                        // unknown status: step over it
    }
    p = end;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  const toSec = tick => {
    let s = 0;
    for (let i = 0; i < tempos.length; i++){
      const a = tempos[i], nxt = tempos[i + 1];
      const from = a.tick, to = nxt ? Math.min(nxt.tick, tick) : tick;
      if (to > from) s += ((to - from) / ticksPerQ) * (a.us / 1e6);
      if (nxt && tick <= nxt.tick) break;
    }
    return s;
  };
  const out = notes.filter(n => n.end !== null).map(n => ({ ...n, t0: toSec(n.tick), t1: toSec(n.end) }));
  const dur = out.reduce((a, n) => Math.max(a, n.t1), 0);
  return { notes: out, dur, format: fmt, tracks: ntrks };
}
  V.midi = {
    size: [560, 380], badge: 'midi',
    html(){ return shell('<div class="vload">reading notes…</div>', '<button class="vbtn vplay">▶ play</button>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat'), playBtn = el.querySelector('.vplay');
      try {
        const midi = parseMidi(new Uint8Array(await (await api.blob(doc)).arrayBuffer()));
        if (!midi.notes.length) throw new Error('no notes');
        const lo = Math.min(...midi.notes.map(n => n.note)) - 1, hi = Math.max(...midi.notes.map(n => n.note)) + 1;
        const H = 100, W = 1000, span = hi - lo + 1;
        const rects = midi.notes.map(n => {
          const x = (n.t0 / midi.dur) * W, w = Math.max((n.t1 - n.t0) / midi.dur * W, 0.6);
          const y = H - ((n.note - lo) / span) * H;
          return `<rect x="${x.toFixed(1)}" y="${(y - 1.4).toFixed(1)}" width="${w.toFixed(1)}" height="2.4" rx="1" opacity="${(0.45 + n.vel / 254).toFixed(2)}"/>`;
        }).join('');
        wrap.innerHTML = `<div class="midiwrap"><svg class="midi" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}
          <line class="ph" x1="0" y1="0" x2="0" y2="${H}"/></svg></div>`;
        stat.textContent = `${midi.notes.length} notes · ${Math.round(midi.dur)}s`;
        playBtn.addEventListener('click', () => {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const gain = ctx.createGain(); gain.gain.value = 0.14; gain.connect(ctx.destination);
          const t0 = ctx.currentTime + 0.05;
          for (const n of midi.notes){
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'triangle';
            o.frequency.value = 440 * Math.pow(2, (n.note - 69) / 12);
            const a = t0 + n.t0, z = a + Math.max(n.t1 - n.t0, 0.05);
            g.gain.setValueAtTime(0, a); g.gain.linearRampToValueAtTime(0.5, a + 0.01);
            g.gain.exponentialRampToValueAtTime(0.001, z);
            o.connect(g); g.connect(gain); o.start(a); o.stop(z + 0.02);
          }
          const ph = wrap.querySelector('.ph');
          const start = performance.now();
          const tick = () => {
            const t = (performance.now() - start) / 1000;
            if (t > midi.dur){ ph.setAttribute('x1', 0); ph.setAttribute('x2', 0); return; }
            const x = (t / midi.dur) * 1000;
            ph.setAttribute('x1', x); ph.setAttribute('x2', x);
            requestAnimationFrame(tick);
          };
          tick();
          setTimeout(() => ctx.close().catch(() => {}), (midi.dur + 1) * 1000);
        });
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };

  /* ------------------------------------------------------------------ 3mf */
  V.mesh3mf = {
    size: [440, 380], badge: '3d',
    html(){ return `<div class="body vbody"><canvas class="mesh"></canvas>
      <span class="viewerhint">drag orbit · scroll zoom</span></div>`; },
    async wire(el, doc, api){
      const canvas = el.querySelector('canvas');
      try {
        const ZIP = window.NK_ZIP;
        const files = await ZIP.readZip(new Uint8Array(await (await api.blob(doc)).arrayBuffer()));
        const model = files.find(f => /\.model$/i.test(f.name) && /3d/i.test(f.name)) || files.find(f => /\.model$/i.test(f.name));
        if (!model) throw new Error('no model inside the 3MF');
        const xml = new DOMParser().parseFromString(new TextDecoder().decode(await files.get(model)), 'application/xml');
        const verts = [...xml.querySelectorAll('vertices vertex')].map(v => [ +v.getAttribute('x'), +v.getAttribute('y'), +v.getAttribute('z') ]);
        const tris = [...xml.querySelectorAll('triangles triangle')].map(t => [ +t.getAttribute('v1'), +t.getAttribute('v2'), +t.getAttribute('v3') ]);
        if (!verts.length || !tris.length) throw new Error('empty mesh');
        const pos = new Float32Array(verts.length * 3);
        verts.forEach((v, i) => pos.set(v, i * 3));
        const idx = new Uint32Array(tris.length * 3);
        tris.forEach((t, i) => idx.set(t, i * 3));
        const T = await api.ready();
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        geo.setIndex(new T.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        await api.showGeometry(canvas, geo);
        const b = new T.Box3().setFromBufferAttribute(geo.getAttribute('position'));
        const s = b.getSize(new T.Vector3());
        el.querySelector('.viewerhint').textContent =
          `${tris.length.toLocaleString()} tris · ${s.x.toFixed(1)}×${s.y.toFixed(1)}×${s.z.toFixed(1)} mm`;
      } catch (err){
        const body = canvas.parentElement;
        if (body) body.innerHTML = `<div class="filletile">${esc0(err.message || err)}</div>`;
      }
    }
  };

  /* -------------------------------------------------------------- diagrams */
  V.diagram = {
    size: [520, 460], badge: 'diagram',
    html(){ return shell('<div class="vload">drawing…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const mermaid = await window.NK.load('mermaid');
        const text = doc.text != null ? doc.text : await (await api.blob(doc)).text();
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict',
          fontFamily: 'ui-sans-serif, system-ui',
          flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
          themeVariables: { background: 'transparent', fontSize: '15px', primaryColor: '#1c222c',
            primaryTextColor: '#e6edf6', primaryBorderColor: '#4a5568', lineColor: '#8fa6b8',
            secondaryColor: '#232b36', tertiaryColor: '#161b22' } });
        const id = 'm' + doc.id.replace(/[^a-z0-9]/gi, '');
        const { svg } = await mermaid.render(id, text);
        wrap.innerHTML = `<div class="diagram">${svg}</div>`;
        stat.textContent = `${text.split('\n').length} lines`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };


  /* ---------------------------------------------------------------- drawio */
  // draw.io stores a diagram as mxGraphModel XML, either inline or as base64 of
  // a raw-deflated, percent-encoded copy. Both are accepted; the result is drawn
  // as boxes and arrows rather than handed to the browser as a download.
  const inflateRaw = async bytes => {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  async function drawioModel(text){
    const raw = String(text || '').trim();
    const diagram = raw.match(/<diagram[^>]*>([\s\S]*?)<\/diagram>/i);
    let inner = diagram ? diagram[1].trim() : raw;
    if (inner.startsWith('<')) return new DOMParser().parseFromString(inner, 'application/xml');
    // compressed: base64 -> raw deflate -> URI-encoded UTF-8
    const bin = atob(inner.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const xml = decodeURIComponent(new TextDecoder().decode(await inflateRaw(bytes)));
    return new DOMParser().parseFromString(xml, 'application/xml');
  }

  const lum = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  V.drawio = {
    size: [520, 460], badge: 'diagram',
    html(){ return shell('<div class="vload">reading diagram…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const blob = await api.blob(doc);
        if (!blob) throw new Error('no file');
        const xml = await drawioModel(await blob.text());
        if (xml.querySelector('parsererror')) throw new Error('this .drawio is not readable XML');

        const nodes = new Map();
        const shapes = [], links = [];
        for (const cell of xml.querySelectorAll('mxCell')){
          const style = cell.getAttribute('style') || '';
          const value = (cell.getAttribute('value') || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          const geo = cell.querySelector('mxGeometry');
          const kind = (style.match(/(?:^|;)shape=([a-z]+)/) || [])[1] || '';
          const fill = (style.match(/fillColor=(#[0-9a-f]{3,6})/i) || [])[1] || '';
          const stroke = (style.match(/strokeColor=(#[0-9a-f]{3,6})/i) || [])[1] || '';
          if (cell.getAttribute('vertex') === '1' && geo){
            const x = +geo.getAttribute('x') || 0, y = +geo.getAttribute('y') || 0;
            const w = +geo.getAttribute('width') || 0, h = +geo.getAttribute('height') || 0;
            if (!w || !h) continue;
            const node = { x, y, w, h, value, kind, fill, stroke,
              ellipse: /ellipse/.test(style), rhombus: /rhombus/.test(kind) || /rhombus/.test(style) };
            shapes.push(node);
            if (cell.id) nodes.set(cell.id, node);
          } else if (cell.getAttribute('edge') === '1'){
            const pts = [...(geo ? geo.querySelectorAll('mxPoint') : [])]
              .map(pt => ({ x: +pt.getAttribute('x') || 0, y: +pt.getAttribute('y') || 0 }));
            links.push({ from: cell.getAttribute('source'), to: cell.getAttribute('target'), pts,
              label: value, dashed: /dashed/.test(style), colour: stroke });
          }
        }
        if (!shapes.length) throw new Error('this diagram has no shapes to draw');

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        shapes.forEach(s => { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
          maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h); });
        links.forEach(l => l.pts.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }));

        const pad = 18;
        const canvas = document.createElement('canvas');
        canvas.className = 'drawio';
        const cw = 1000, ch = 760;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = cw * dpr; canvas.height = ch * dpr;
        canvas.style.width = '100%'; canvas.style.height = '100%';
        wrap.innerHTML = ''; wrap.appendChild(canvas);
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
        const scale = Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh);
        const ox = (cw - bw * scale) / 2 - minX * scale, oy = (ch - bh * scale) / 2 - minY * scale;
        const X = v => v * scale + ox, Y = v => v * scale + oy;

        const centre = s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
        // links first, so shapes sit on top of their ends
        g.lineWidth = 1.4; g.strokeStyle = '#8fa6b8'; g.fillStyle = '#8fa6b8';
        links.forEach(l => {
          const a = nodes.get(l.from), b = nodes.get(l.to);
          const start = a ? centre(a) : (l.pts[0] || null);
          const end = b ? centre(b) : (l.pts[l.pts.length - 1] || null);
          if (!start || !end) return;
          const p = [start, ...l.pts.slice(a && b ? 0 : 1), end];
          g.setLineDash(l.dashed ? [5, 4] : []);
          g.beginPath(); g.moveTo(X(p[0].x), Y(p[0].y));
          for (let i = 1; i < p.length; i++) g.lineTo(X(p[i].x), Y(p[i].y));
          g.stroke();
          const prev = p[p.length - 2], tip = p[p.length - 1];
          const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
          const head = 7;
          g.beginPath();
          g.moveTo(X(tip.x), Y(tip.y));
          g.lineTo(X(tip.x) - head * Math.cos(ang - 0.4), Y(tip.y) - head * Math.sin(ang - 0.4));
          g.lineTo(X(tip.x) - head * Math.cos(ang + 0.4), Y(tip.y) - head * Math.sin(ang + 0.4));
          g.closePath(); g.fill();
        });
        g.setLineDash([]);

        shapes.forEach(s => {
          const x = X(s.x), y = Y(s.y), w = s.w * scale, h = s.h * scale;
          const fill = s.fill && s.fill !== 'none' ? s.fill : '#1c222c';
          g.beginPath();
          if (s.ellipse) g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          else if (s.rhombus){ g.moveTo(x + w / 2, y); g.lineTo(x + w, y + h / 2);
            g.lineTo(x + w / 2, y + h); g.lineTo(x, y + h / 2); g.closePath(); }
          else g.roundRect(x, y, w, h, Math.min(6, w / 6, h / 6));
          g.fillStyle = fill; g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1;
          g.strokeStyle = s.stroke || '#4a5568'; g.lineWidth = 1.2; g.stroke();

          if (!s.value) return;
          g.fillStyle = lum(fill) > 0.55 ? '#11151b' : '#e6edf6';
          const size = Math.max(9, Math.min(14, Math.round(h / 2.6)));
          g.font = `${size}px ui-sans-serif, system-ui`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          const words = s.value.split(' ');
          const lines = []; let line = '';
          for (const word of words){
            const test = line ? line + ' ' + word : word;
            if (g.measureText(test).width > w - 10 && line){ lines.push(line); line = word; }
            else line = test;
          }
          if (line) lines.push(line);
          const lh = size * 1.2;
          const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
          lines.slice(0, 4).forEach((t, i) => g.fillText(t, x + w / 2, top + i * lh, w - 8));
        });

        stat.textContent = `${shapes.length} shape${shapes.length === 1 ? '' : 's'} · ${links.length} link${links.length === 1 ? '' : 's'}`;
      } catch (err){
        wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`;
      }
    }
  };

  /* ------------------------------------------------------------------- geo */
  function geoFromGeoJSON(o){
    const pts = [], lines = [], polys = [];
    const walk = (g, into) => {
      if (!g) return;
      if (g.type === 'FeatureCollection') return g.features.forEach(f => walk(f, into));
      if (g.type === 'Feature') return walk(g.geometry, into);
      const c = g.coordinates;
      if (g.type === 'Point'){ pts.push(c); return; }
      if (g.type === 'MultiPoint'){ c.forEach(p => pts.push(p)); return; }
      if (g.type === 'LineString'){ lines.push(c); return; }
      if (g.type === 'MultiLineString'){ c.forEach(l => lines.push(l)); return; }
      if (g.type === 'Polygon'){ polys.push(c[0]); return; }
      if (g.type === 'MultiPolygon'){ c.forEach(p => polys.push(p[0])); return; }
      if (g.type === 'GeometryCollection') g.geometries.forEach(x => walk(x, into));
    };
    walk(o, null);
    return { pts, lines, polys };
  }
  function coordsOf(text, ext){
    if (ext === 'geojson' || ext === 'json') return geoFromGeoJSON(JSON.parse(text));
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const pts = [], lines = [];
    if (ext === 'gpx'){
      const trk = [...xml.querySelectorAll('trkpt')].map(p => [+p.getAttribute('lon'), +p.getAttribute('lat')]);
      if (trk.length) lines.push(trk);
    } else {
      for (const node of xml.querySelectorAll('coordinates')){
        const line = node.textContent.trim().split(/\s+/).map(t => t.split(',').slice(0, 2).map(Number)).filter(p => p.length === 2 && isFinite(p[0]));
        if (line.length > 1) lines.push(line); else if (line.length) pts.push(line[0]);
      }
    }
    return { pts, lines, polys: [] };
  }
  V.geo = {
    size: [520, 420], badge: 'map',
    html(){ return shell('<div class="vload">projecting…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const text = doc.text != null ? doc.text : await (await api.blob(doc)).text();
        const g = coordsOf(text, (doc.ext || '').toLowerCase());
        const all = [...g.pts, ...g.lines.flat(), ...g.polys.flat()];
        if (!all.length) throw new Error('no coordinates found');
        const lons = all.map(p => p[0]), lats = all.map(p => p[1]);
        const x0 = Math.min(...lons), x1 = Math.max(...lons);
        let y0 = Math.min(...lats), y1 = Math.max(...lats);
        const midLat = (y0 + y1) / 2, k = Math.cos(midLat * Math.PI / 180) || 1;
        const W = 1000, H = Math.max(240, Math.min(1000, Math.round(W * ((y1 - y0) / Math.max((x1 - x0) * k, 1e-9)))));
        const px = x => ((x - x0) / Math.max(x1 - x0, 1e-9)) * W;
        const py = y => H - ((y - y0) / Math.max(y1 - y0, 1e-9)) * H;
        const draw = [];
        g.polys.forEach(p => draw.push(`<polygon points="${p.map(c => `${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join(' ')}"/>`));
        g.lines.forEach(l => draw.push(`<polyline points="${l.map(c => `${px(c[0]).toFixed(1)},${py(c[1]).toFixed(1)}`).join(' ')}"/>`));
        g.pts.forEach(p => draw.push(`<circle cx="${px(p[0]).toFixed(1)}" cy="${py(p[1]).toFixed(1)}" r="2.4"/>`));
        wrap.innerHTML = `<svg class="geo" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${draw.join('')}</svg>`;
        const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
        stat.textContent = `${pl(g.lines.length, 'line')} · ${pl(g.polys.length, 'area')} · ${pl(g.pts.length, 'point')}`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };

  window.NK_V = V;
})();
