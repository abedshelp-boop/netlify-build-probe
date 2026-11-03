// BUILD-fleet probe v4 — /tmp artifacts + buildbot unix socket interrogation (own container, bounded)
const fs = require('fs');
const http = require('http');
const out = { probe: 'buildpos-4', t: new Date().toISOString() };
out.tmp_files = {};
for (const f of ['build-info.json', 'netlify_config.json', 'netlify-buildbot-socket', 'system-log3406125589', 'nf-tracing-292323624']) {
  try {
    const st = fs.statSync('/tmp/' + f);
    if (st.isSocket()) { out.tmp_files[f] = { type: 'socket' }; continue; }
    const c = fs.readFileSync('/tmp/' + f, 'utf8');
    out.tmp_files[f] = { type: st.isDirectory() ? 'dir' : 'file', size: st.size, head: c.slice(0, 1200) };
  } catch (e) { out.tmp_files[f] = { err: String(e.code || e.message).slice(0, 40) }; }
}
// full /tmp listing
try { out.tmp_all = fs.readdirSync('/tmp'); } catch (e) { out.tmp_all = 'ERR'; }

// socket probe: naive HTTP GET over the unix socket
const sockProbe = (path) => new Promise((resolve) => {
  let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
  try {
    const req = http.request({ socketPath: '/tmp/netlify-buildbot-socket', path, method: 'GET', timeout: 3000 }, (res) => {
      let n = 0; const ch = [];
      res.on('data', (c) => { n += c.length; if (n <= 2000) ch.push(c); if (n > 65536) req.destroy(); });
      res.on('end', () => fin({ s: res.statusCode, hdr: { ct: res.headers['content-type'], loc: res.headers.location }, len: n, b: Buffer.concat(ch).toString('utf8').slice(0, 800) }));
      res.on('error', () => fin({ s: res.statusCode, len: n }));
    });
    req.on('timeout', () => { req.destroy(); fin({ err: 'timeout' }); });
    req.on('error', (e) => fin({ err: String(e.message).slice(0, 60) }));
    req.end();
  } catch (e) { fin({ err: String(e.message).slice(0, 60) }); }
  setTimeout(() => fin({ err: 'hard-timeout' }), 3600);
});
(async () => {
  out.sock = {};
  for (const p of ['/', '/status', '/health', '/api', '/v1/status', '/build', '/logs']) out.sock[p] = await sockProbe(p);
  // who listens? try POST status shape too
  try { fs.writeFileSync('probe-out.json', JSON.stringify(out, null, 1)); out.written = true; } catch (e) { out.written = 'ERR'; }
  console.log('PROBE4 done');
})();
