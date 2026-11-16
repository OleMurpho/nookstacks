/* Container and list viewers: archives, subtitles, calendars, contacts. */
(function(){
  const V = window.NK_VIEWERS = window.NK_VIEWERS || {};
  const fmtBytes = n => n == null ? '' : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  const esc0 = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const shell = (html, tools) => `<div class="body vbody"><div class="vtools">${tools || ''}<span class="vstat"></span>
      <button class="vbtn vexpand" title="Fill the window">⤢</button></div>
      <div class="vwrap">${html}</div></div>`;

  /* ------------------------------------------------------------- archives */
  async function inflateRaw(bytes){
    const ds = new DecompressionStream('deflate-raw');
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(out);
  }
  async function gunzip(bytes){
    const ds = new DecompressionStream('gzip');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function readZip(u8){
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--){
      if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = [];
    for (let n = 0; n < count && p + 46 <= u8.length; n++){
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      files.push({ name, method, csize, usize, off, dir: name.endsWith('/') });
      p += 46 + nlen + elen + clen;
    }
    files.get = async (f) => {
      const lnlen = dv.getUint16(f.off + 26, true), lelen = dv.getUint16(f.off + 28, true);
      const start = f.off + 30 + lnlen + lelen;
      const slice = u8.subarray(start, start + f.csize);
      return f.method === 0 ? slice : await inflateRaw(slice);
    };
    files.kind = 'zip';
    return files;
  }
  function readTar(u8){
    const dec = new TextDecoder();
    const files = [];
    let p = 0;
    while (p + 512 <= u8.length){
      const name = dec.decode(u8.subarray(p, p + 100)).replace(/\0.*$/, '');
      if (!name){ p += 512; if (p + 1024 > u8.length) break; continue; }
      const prefix = dec.decode(u8.subarray(p + 345, p + 500)).replace(/\0.*$/, '');
      const size = parseInt(dec.decode(u8.subarray(p + 124, p + 136)).replace(/[^0-7]/g, '') || '0', 8) || 0;
      const type = String.fromCharCode(u8[p + 156] || 48);
      const full = prefix ? prefix + '/' + name : name;
      const start = p + 512;
      if (type === '0' || type === '' || type === '\0') files.push({ name: full, usize: size, off: start, dir: false });
      else if (type === '5') files.push({ name: full, usize: 0, off: start, dir: true });
      p = start + Math.ceil(size / 512) * 512;
    }
    files.get = async (f) => u8.subarray(f.off, f.off + f.usize);
    files.kind = 'tar';
    return files;
  }
  window.NK_ZIP = { readZip, readTar, gunzip, inflateRaw };

  const TEXTISH = /\.(txt|md|markdown|json|ya?ml|toml|csv|tsv|xml|html?|css|js|mjs|ts|py|rb|go|rs|c|h|cpp|hpp|cs|java|lua|sh|sql|ini|cfg|conf|log|glsl|mml|svg|gitignore|env)$/i;
  const IMGISH = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;

  V.archive = {
    size: [480, 420], badge: 'zip',
    html(){ return shell('<div class="vload">opening container…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const blob = await api.blob(doc);
        if (!blob) throw new Error('no file');
        if (blob.size > 512 << 20) throw new Error('archive is ' + fmtBytes(blob.size) + ' — too large to open here');
        let u8 = new Uint8Array(await blob.arrayBuffer());
        const lower = doc.title.toLowerCase();
        if (/\.(gz|tgz)$/.test(lower) && !/\.tar\.gz$/.test(lower)){
          u8 = await gunzip(u8);
          if (u8[257] === 0x75 && u8[258] === 0x73) return listing(readTar(u8)); // gunzipped a tar
          wrap.innerHTML = `<div class="vload">gunzipped: ${fmtBytes(u8.length)}<br><br>` +
            `<button class="vbtn vext">add the unpacked file to this board</button></div>`;
          wrap.querySelector('.vext').addEventListener('click', () => api.addFile(doc.title.replace(/\.(gz|tgz)$/i, ''), new Blob([u8])));
          stat.textContent = fmtBytes(u8.length);
          return;
        }
        if (/\.tar\.gz$/.test(lower)) u8 = await gunzip(u8);
        const files = /\.tar(\.gz)?$/i.test(lower) || u8[257] === 0x75 ? readTar(u8) : await readZip(u8);
        listing(files);
      } catch (err){
        wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`;
      }

      function listing(files){
        const real = files.filter(f => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name));
        const total = real.reduce((a, f) => a + (f.usize || 0), 0);
        stat.textContent = `${real.length} files · ${fmtBytes(total)}`;
        wrap.innerHTML = `<div class="alist">` + real.slice(0, 500).map((f, i) =>
          `<button class="arow" data-i="${i}"><span class="an">${esc0(f.name)}</span>
            <span class="as">${fmtBytes(f.usize)}</span></button>`).join('') +
          (real.length > 500 ? `<div class="vload">… ${real.length - 500} more</div>` : '') + `</div>
          <div class="aprev"><div class="vload">pick a file to look inside</div></div>`;
        wrap.querySelector('.alist').addEventListener('click', async e => {
          const b = e.target.closest('.arow'); if (!b) return;
          const f = real[+b.dataset.i];
          const prev = wrap.querySelector('.aprev');
          wrap.querySelectorAll('.arow').forEach(x => x.classList.toggle('on', x === b));
          prev.innerHTML = '<div class="vload">reading…</div>';
          try {
            const bytes = await files.get(f);
            if (bytes.length > 8 << 20){ prev.innerHTML = `<div class="vload">${fmtBytes(bytes.length)} — too big to preview</div>`; return; }
            const name = f.name.split('/').pop();
            if (TEXTISH.test(f.name)){
              const text = new TextDecoder().decode(bytes).slice(0, 200000);
              prev.innerHTML = `<div class="aprevbar"><span>${esc0(name)}</span>
                <button class="vbtn vext" data-n="${esc0(name)}">add to board</button></div>
                <pre class="apre">${esc0(text)}</pre>`;
            } else if (IMGISH.test(f.name)){
              const url = URL.createObjectURL(new Blob([bytes]));
              prev.innerHTML = `<div class="aprevbar"><span>${esc0(name)}</span>
                <button class="vbtn vext" data-n="${esc0(name)}">add to board</button></div>
                <img class="apimg" src="${url}">`;
            } else {
              const url = URL.createObjectURL(new Blob([bytes]));
              prev.innerHTML = `<div class="vload">binary · ${fmtBytes(bytes.length)}<br><br>
                <a class="vbtn" href="${url}" download="${esc0(name)}">download</a></div>`;
            }
            const ext = prev.querySelector('.vext');
            if (ext) ext.addEventListener('click', () => api.addFile(ext.dataset.n, new Blob([bytes])));
          } catch (err){ prev.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
        });
      }
    }
  };

  /* ------------------------------------------------------------ subtitles */
  const ts = s => {
    const m = String(s).trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[.,:](\d{1,3})/);
    if (!m) return null;
    return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+(m[4].padEnd(3, '0')) / 1000);
  };
  const clock = t => {
    if (t == null) return '';
    const m = Math.floor(t / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000);
    return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  function parseSubs(text, ext){
    const cues = [];
    if (ext === 'ass' || ext === 'ssa'){
      let fields = null;
      for (const raw of text.split(/\r?\n/)){
        if (/^Format:/i.test(raw)) fields = raw.slice(7).split(',').map(s => s.trim().toLowerCase());
        else if (/^Dialogue:/i.test(raw) && fields){
          const parts = raw.slice(9).split(',');
          const g = f => parts[fields.indexOf(f)];
          cues.push({ start: ts(g('start')), end: ts(g('end')), text: (parts.slice(fields.indexOf('text')).join(',') || '').replace(/\{[^}]*\}/g, '') });
        }
      }
    } else {
      const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
      for (const b of blocks){
        const lines = b.split('\n').filter(Boolean);
        const i = lines.findIndex(l => l.includes('-->'));
        if (i < 0) continue;
        const [a, z] = lines[i].split('-->');
        cues.push({ start: ts(a), end: ts(z), text: lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '') });
      }
    }
    return cues.filter(c => c.start != null).sort((a, b) => a.start - b.start);
  }
  V.subtitle = {
    size: [420, 380], badge: 'srt',
    html(){ return shell('<div class="vload">reading cues…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const text = doc.text != null ? doc.text : await (await api.blob(doc)).text();
        const cues = parseSubs(text, (doc.ext || '').toLowerCase());
        const last = cues.length ? cues[cues.length - 1].end : 0;
        stat.textContent = `${cues.length} cues · ${clock(last).split('.')[0]}`;
        wrap.innerHTML = `<div class="cues">` + cues.map(c =>
          `<div class="cue"><span class="ct">${clock(c.start)}</span><span class="cx">${esc0(c.text).replace(/\n/g, '<br>')}</span></div>`
        ).join('') + `</div>`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };

  /* ------------------------------------------------- calendar and contacts */
  function icsDate(v){
    const m = String(v).match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
    if (!m) return '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: m[4] ? 'short' : undefined });
  }
  V.calendar = {
    size: [400, 400], badge: 'ics',
    html(){ return shell('<div class="vload">reading events…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const text = (doc.text != null ? doc.text : await (await api.blob(doc)).text()).replace(/\r?\n[ \t]/g, '');
        const events = [];
        for (const raw of text.split(/BEGIN:VEVENT/).slice(1)){
          const body = raw.split('END:VEVENT')[0];
          const get = k => { const m = body.match(new RegExp('^' + k + '[^:]*:(.*)$', 'm')); return m ? m[1].trim() : ''; };
          events.push({ start: get('DTSTART'), allDay: !/T/.test(get('DTSTART')), name: get('SUMMARY') || '(untitled)',
            where: get('LOCATION'), note: get('DESCRIPTION') });
        }
        events.sort((a, b) => String(a.start).localeCompare(String(b.start)));
        stat.textContent = `${events.length} events`;
        wrap.innerHTML = `<div class="clist">` + events.map(e =>
          `<div class="crow"><div class="cwhen">${esc0(icsDate(e.start))}</div>
            <div class="cbody"><b>${esc0(e.name)}</b>${e.where ? `<span class="cwhere">${esc0(e.where)}</span>` : ''}</div></div>`).join('') +
          (events.length ? '' : '<div class="vload">no events</div>') + `</div>`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };
  V.contact = {
    size: [360, 320], badge: 'vcf',
    html(){ return shell('<div class="vload">reading cards…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const text = (doc.text != null ? doc.text : await (await api.blob(doc)).text()).replace(/\r?\n[ \t]/g, '');
        const cards = text.split(/BEGIN:VCARD/i).slice(1).map(raw => {
          const f = k => { const m = raw.match(new RegExp('^' + k + '[^:\\n]*:(.*)$', 'mi')); return m ? m[1].trim() : ''; };
          return { name: f('FN') || f('N') || 'unnamed', org: f('ORG'), title: f('TITLE'),
            tel: [...raw.matchAll(/^TEL[^:\n]*:(.*)$/gmi)].map(m => m[1].trim()),
            mail: [...raw.matchAll(/^EMAIL[^:\n]*:(.*)$/gmi)].map(m => m[1].trim()),
            url: [...raw.matchAll(/^URL[^:\n]*:(.*)$/gmi)].map(m => m[1].trim()) };
        });
        stat.textContent = `${cards.length} card${cards.length === 1 ? '' : 's'}`;
        wrap.innerHTML = `<div class="vlist">` + cards.map(c =>
          `<div class="vrow"><div class="vname">${esc0(c.name)}</div>
            ${c.title || c.org ? `<div class="vsub">${esc0([c.title, c.org].filter(Boolean).join(' · '))}</div>` : ''}
            ${c.tel.map(t => `<div class="vmeta">☎ ${esc0(t)}</div>`).join('')}
            ${c.mail.map(t => `<div class="vmeta">✉ ${esc0(t)}</div>`).join('')}
            ${c.url.map(t => `<div class="vmeta">↗ ${esc0(t)}</div>`).join('')}</div>`).join('') + `</div>`;
      } catch (err){ wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`; }
    }
  };
})();
