/* Data-shaped viewers: spreadsheets, notebooks, structured data, fonts.
   Each viewer is { size:[w,h], badge, html(doc, api), wire(el, doc, api) }. */
(function(){
  const V = window.NK_VIEWERS = window.NK_VIEWERS || {};
  const LIMIT = {
    rows: 200,          // rows painted first
    rowStep: 400,       // added by the "more" button
    cells: 60000,       // hard ceiling on cells held in the DOM
    treeNodes: 4000,
    textBytes: 4 << 20  // refuse to parse anything larger than 4 MB inline
  };

  const fmtBytes = n => n == null ? '' : n >= 1 << 20 ? (n / (1 << 20)).toFixed(1) + ' MB'
    : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';

  /* ------------------------------------------------------------ csv / tsv */
  function sniffDelim(text, name){
    if (/\.tsv$/i.test(name || '')) return '\t';
    const line = text.slice(0, 4000).split(/\r?\n/)[0] || '';
    const count = c => (line.match(new RegExp('\\' + c, 'g')) || []).length;
    const best = [',', '\t', ';', '|'].sort((a, b) => count(b) - count(a))[0];
    return count(best) ? best : ',';
  }
  function parseCSV(text, delim){
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (q){
        if (c === '"'){ if (text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim){ row.push(cell); cell = ''; }
      else if (c === '\n'){ row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r'){ /* handled by \n */ }
      else cell += c;
      if (rows.length > 200000) break;
    }
    if (cell.length || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }

  /* --------------------------------------------------------------- tables */
  const isNum = s => s !== '' && s != null && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(String(s).trim());

  function tableHTML(rows, start, maxCells){
    const head = rows[0] || [];
    let cells = 0, out = '<table class="sheet"><thead><tr><th class="rn"></th>';
    for (const h of head){ out += `<th>${esc0(h)}</th>`; cells++; }
    out += '</tr></thead><tbody>';
    for (let r = start; r < rows.length; r++){
      if (cells > maxCells) break;
      const row = rows[r];
      out += `<tr><td class="rn">${r}</td>`;
      const n = Math.max(head.length, row.length);
      for (let c = 0; c < n; c++){
        const v = row[c] == null ? '' : row[c];
        out += `<td${isNum(v) ? ' class="num"' : ''}>${esc0(v)}</td>`;
        cells++;
      }
      out += '</tr>';
    }
    return out + '</tbody></table>';
  }
  function esc0(s){
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function shell(html, tools){
    return `<div class="body vbody"><div class="vtools">${tools || ''}<span class="vstat"></span>
      <button class="vbtn vexpand" title="Fill the window">⤢</button></div>
      <div class="vwrap">${html}</div></div>`;
  }

  V.sheet = {
    size: [600, 440], badge: 'sheet',
    html(doc){
      return shell('<div class="vload">reading rows…</div>',
        '<div class="vtabs"></div>');
    },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat'),
            tabs = el.querySelector('.vtabs');
      try {
        const blob = await api.blob(doc);
        if (!blob) throw new Error('no file');
        if (blob.size > LIMIT.textBytes) throw new Error('file is ' + fmtBytes(blob.size) + ' — too large to open here');
        let book = null, rows = null;

        if (/\.(csv|tsv)$/i.test(doc.title)){
          const text = await blob.text();
          rows = parseCSV(text, sniffDelim(text, doc.title));
          book = { names: ['sheet'], get: () => rows };
        } else {
          const XLSX = await window.NK.load('xlsx');
          book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
          book.get = (n) => XLSX.utils.sheet_to_json(book.Sheets[n], { header: 1, defval: '', raw: false, blankrows: false });
        }

        const names = book.SheetNames || book.names;
        let cur = 0;
        const paint = () => {
          const all = book.get(names[cur]) || [];
          const shown = all.slice(0, LIMIT.rows + (paint.extra || 0));
          wrap.innerHTML = all.length
            ? tableHTML(shown, 1, LIMIT.cells) +
              (shown.length < all.length - 1
                ? `<button class="vmore">show ${Math.min(LIMIT.rowStep, all.length - 1 - shown.length)} more rows</button>` : '')
            : '<div class="vload">empty sheet</div>';
          const more = wrap.querySelector('.vmore');
          if (more) more.addEventListener('click', () => { paint.extra = (paint.extra || 0) + LIMIT.rowStep; paint(); });
          stat.textContent = `${(all.length - 1).toLocaleString()} rows · ${names.length} sheet${names.length > 1 ? 's' : ''}`;
        };
        if (names.length > 1){
          tabs.innerHTML = names.map((n, i) =>
            `<button class="vtab${i === 0 ? ' on' : ''}" data-i="${i}">${esc0(n)}</button>`).join('');
          tabs.addEventListener('click', e => {
            const b = e.target.closest('.vtab'); if (!b) return;
            cur = +b.dataset.i; paint.extra = 0;
            tabs.querySelectorAll('.vtab').forEach((x, i) => x.classList.toggle('on', i === cur));
            paint();
          });
        }
        paint();
      } catch (err){
        wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`;
        stat.textContent = '';
      }
    }
  };

  /* ------------------------------------------------------------- notebook */
  function mdLite(s){
    let h = esc0(s || '');
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => `<pre class="nbcode">${code}</pre>`);
    h = h.replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
         .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
         .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
    h = h.replace(/^[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return h.replace(/\n{2,}/g, '</p><p>').replace(/^/, '<p>').replace(/$/, '</p>');
  }

  V.notebook = {
    size: [520, 480], badge: 'notebook',
    html(){ return shell('<div class="vload">reading cells…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const book = JSON.parse(doc.text || await (await api.blob(doc)).text());
        const cells = book.cells || [];
        let out = '';
        let images = 0;
        cells.forEach(c => {
          const src = Array.isArray(c.source) ? c.source.join('') : (c.source || '');
          if (c.cell_type === 'markdown'){
            out += `<div class="nbm">${mdLite(src)}</div>`;
          } else if (c.cell_type === 'code'){
            out += `<pre class="nbcode in">${esc0(src)}</pre>`;
            for (const o of (c.outputs || [])){
              if (o.output_type === 'stream'){
                out += `<pre class="nbout">${esc0(Array.isArray(o.text) ? o.text.join('') : o.text)}</pre>`;
              } else if (o.output_type === 'error'){
                out += `<pre class="nbout bad">${esc0((o.ename || '') + ': ' + (o.evalue || ''))}</pre>`;
              } else {
                const d = o.data || {};
                if (d['image/png']){
                  if (images++ < 12) out += `<img class="nbimg" src="data:image/png;base64,${(d['image/png'] || '').replace(/\s/g, '')}">`;
                } else if (d['text/html']){
                  out += `<div class="nbhtml">${window.DOMPurify ? DOMPurify.sanitize(String(d['text/html'])) : esc0(String(d['text/html']))}</div>`;
                } else if (d['text/plain']){
                  out += `<pre class="nbout">${esc0(Array.isArray(d['text/plain']) ? d['text/plain'].join('') : d['text/plain'])}</pre>`;
                }
              }
            }
          } else if (c.cell_type === 'raw'){
            out += `<pre class="nbout">${esc0(src)}</pre>`;
          }
        });
        wrap.innerHTML = out || '<div class="vload">no cells</div>';
        stat.textContent = `${cells.length} cells · ${book.nbformat ? 'nbformat ' + book.nbformat : 'notebook'}`;
        if (images && !window.DOMPurify) window.NK.load('purify').catch(() => {});
      } catch (err){
        wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`;
      }
    }
  };

  /* ---------------------------------------------------------------- trees */
  function tomlParse(src){
    const root = {}; let cur = root;
    src.split(/\r?\n/).forEach(raw => {
      const line = raw.replace(/\s+#.*$/, '').trim();
      if (!line || line.startsWith('#')) return;
      let m;
      if ((m = line.match(/^\[\[?([^\]]+)\]\]?$/))){
        const path = m[1].split('.').map(s => s.trim());
        const isArr = line.startsWith('[[');
        let node = root;
        path.forEach((k, i) => {
          const last = i === path.length - 1;
          if (last && isArr){ (node[k] = node[k] || []).push({}); node = node[k][node[k].length - 1]; }
          else { node[k] = node[k] || {}; node = node[k]; }
        });
        cur = node; return;
      }
      if ((m = line.match(/^([\w.-]+)\s*=\s*(.+)$/))){
        let v = m[2].trim();
        if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
        else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
        else if (v === 'true' || v === 'false') v = v === 'true';
        else if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
          .map(s => /^".*"$/.test(s) ? s.slice(1, -1) : isNum(s) ? +s : s);
        else if (isNum(v)) v = +v;
        cur[m[1]] = v;
      }
    });
    return root;
  }
  function xmlTree(el){
    const kids = [...el.children];
    const o = {};
    for (const a of el.attributes) o['@' + a.name] = a.value;
    if (kids.length) kids.forEach(k => {
      const v = xmlTree(k);
      if (o[k.tagName] === undefined) o[k.tagName] = v;
      else if (Array.isArray(o[k.tagName])) o[k.tagName].push(v);
      else o[k.tagName] = [o[k.tagName], v];
    });
    else if (!Object.keys(o).length) return el.textContent.trim();
    else o['#text'] = el.textContent.trim();
    return o;
  }

  let budget = LIMIT.treeNodes;
  function treeHTML(v, key, depth){
    if (budget-- <= 0) return '<div class="vload">… truncated, the file is large</div>';
    if (v === null || typeof v !== 'object')
      return `<span class="tv ${typeof v}">${esc0(v === null ? 'null' : String(v))}</span>`;
    const isArr = Array.isArray(v);
    const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
    const label = `${isArr ? 'array' : 'object'} · ${entries.length}`;
    const open = (depth || 0) < 2 && entries.length <= 60 ? ' open' : '';
    return `<details${open}><summary><span class="tk">${esc0(key)}</span>
      <span class="tt">${label}</span></summary><ul>` +
      entries.slice(0, 400).map(([k, x]) => `<li>${treeHTML(x, k, (depth || 0) + 1)}</li>`).join('') +
      (entries.length > 400 ? '<li class="vload">… ' + (entries.length - 400) + ' more</li>' : '') +
      '</ul></details>';
  }

  V.data = {
    size: [440, 440], badge: 'data',
    html(doc){
      return shell('<div class="vload">parsing…</div>',
        `<button class="vbtn vsrc" title="Show and edit the source">source</button>`);
    },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat'),
            srcBtn = el.querySelector('.vsrc');
      let view = 'tree';
      const source = async () => doc.text != null ? doc.text : await (await api.blob(doc)).text();

      const asText = async () => {
        wrap.innerHTML = `<textarea class="vtextarea" spellcheck="false">${esc0(await source())}</textarea>`;
        const ta = wrap.querySelector('textarea');
        ta.addEventListener('input', () => { doc.text = ta.value; api.save(); });
        stat.textContent = 'editable source';
        srcBtn.textContent = 'tree';
      };

      const asTree = async () => {
        srcBtn.textContent = 'source';
        wrap.innerHTML = '<div class="vload">parsing…</div>';
        try {
          const text = await source();
          const ext = (doc.ext || '').toLowerCase();
          let obj;
          if (ext === 'yaml' || ext === 'yml'){ await window.NK.load('yaml'); obj = window.jsyaml.load(text); }
          else if (ext === 'toml') obj = tomlParse(text);
          else if (ext === 'xml' || (ext !== 'json' && ext !== 'jsonc' && /^\s*</.test(text))){
            const dom = new DOMParser().parseFromString(text, 'application/xml');
            const bad = dom.querySelector('parsererror');
            if (bad) throw new Error('not valid XML');
            obj = { [dom.documentElement.tagName]: xmlTree(dom.documentElement) };
          }          else if (ext === 'json' || ext === 'jsonc' || /^\s*[[{]/.test(text)) obj = JSON.parse(text);
          else throw new Error('not sure how to read a .' + ext + ' file');
          budget = LIMIT.treeNodes;
          wrap.innerHTML = `<div class="tree">${treeHTML(obj, (doc.ext || 'root'), 0)}</div>`;
          const n = wrap.querySelectorAll('li').length;
          stat.textContent = `${n.toLocaleString()} branches${budget <= 0 ? ' (truncated)' : ''}`;
        } catch (err){
          wrap.innerHTML = `<div class="vload bad">${esc0(err.message || err)}</div>`;
          stat.textContent = '';
        }
      };

      srcBtn.addEventListener('click', () => { view = view === 'tree' ? 'src' : 'tree'; view === 'tree' ? asTree() : asText(); });
      asTree();
    }
  };

  /* ---------------------------------------------------------------- fonts */
  V.font = {
    size: [420, 360], badge: 'font',
    html(){ return shell('<div class="vload">loading face…</div>'); },
    async wire(el, doc, api){
      const wrap = el.querySelector('.vwrap'), stat = el.querySelector('.vstat');
      try {
        const blob = await api.blob(doc);
        const name = 'nkf_' + doc.id;
        const buf = await blob.arrayBuffer();
        const face = new FontFace(name, buf);
        await face.load();
        document.fonts.add(face);
        const fam = `"${name}", system-ui`;
        const glyphs = [];
        for (let c = 32; c < 127; c++) glyphs.push(String.fromCharCode(c));
        wrap.innerHTML = `
          <div class="spec" style="font-family:${fam}">
            <div class="specbig">Aa</div>
            <div class="specrow"><span class="specsz">48</span><span style="font-size:34px">Hamburgefonstiv</span></div>
            <div class="specrow"><span class="specsz">24</span><span style="font-size:20px">The quick brown fox jumps over 13 lazy dogs.</span></div>
            <div class="specrow"><span class="specsz">14</span><span style="font-size:13px">${esc0(doc.title)} — 0123456789 $€£¥ &amp; @#%</span></div>
            <div class="specgrid">${glyphs.map(g => `<span>${esc0(g)}</span>`).join('')}</div>
          </div>`;
        stat.textContent = `${face.status} · ${fmtBytes(blob.size)}`;
        window.__nkFonts = window.__nkFonts || [];
        window.__nkFonts.push({ name, doc: doc.id });
      } catch (err){
        wrap.innerHTML = `<div class="vload bad">${esc0(err.message || 'not a readable font')}</div>`;
      }
    }
  };

  window.NK_V = V;   // handy in the console
})();
