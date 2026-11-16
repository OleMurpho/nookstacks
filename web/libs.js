/* Vendor parsers are fetched the first time a card needs one, never at boot.
   app.js and the viewer modules call NK.load('xlsx') and wait.

   A failed load is not remembered: the next card that needs the parser tries
   again, with a cache-busting query the second time. One aborted request should
   not poison a whole session. */
(function(){
  const SRC = {
    xlsx:    'vendor/xlsx.full.min.js',
    mermaid: 'vendor/mermaid.min.js',
    yaml:    'vendor/js-yaml.min.js',
    purify:  'vendor/purify.min.js'
  };
  const HAVE = {
    xlsx:    () => window.XLSX,
    mermaid: () => window.mermaid,
    yaml:    () => window.jsyaml,
    purify:  () => window.DOMPurify
  };
  const pending = {};
  window.NK = window.NK || {};
  window.NK.libsLoaded = [];

  function inject(name, attempt){
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SRC[name] + (attempt ? '?retry=' + Date.now() : '');
      s.async = true;
      const t0 = performance.now();
      s.onload = () => {
        if (!HAVE[name]()) return rej(new Error(name + ' loaded but missing'));
        window.NK.libsLoaded.push({ name, ms: Math.round(performance.now() - t0), attempt });
        res(HAVE[name]());
      };
      s.onerror = () => { s.remove(); rej(new Error('could not load ' + name)); };
      document.head.appendChild(s);
    });
  }

  window.NK.load = function(name){
    if (HAVE[name] && HAVE[name]()) return Promise.resolve(HAVE[name]());
    if (pending[name]) return pending[name];
    pending[name] = inject(name, 0)
      .catch(() => inject(name, 1))
      .catch(err => { delete pending[name]; throw err; });
    return pending[name];
  };
  window.NK_VIEWERS = window.NK_VIEWERS || {};
})();
