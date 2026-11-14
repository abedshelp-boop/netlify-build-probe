// agentdeep-10 — Lane A sub-lane (b): build cache transport keying.
// Q1 (restore): does /opt/build/cache at build START contain artifacts saved by a
//   PREVIOUS build of this site (iter58 ran 3 draft builds here)? Any ids/S3 keys in
//   cache metadata?
// Q2 (save): can build-uid plant markers into cache-managed paths that the daemon
//   will persist (observable by the NEXT build)?
// No socket calls; flush after every step.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const R = { probe: 'agentdeep-10', t: new Date().toISOString() };
const cap = (v, n = 1200) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const flush = () => { try { fs.writeFileSync('pubdir/agentdeep10.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('pubdir', { recursive: true });

const walk = (dir, depth = 3, base = dir) => {
  const out = [];
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(base, p);
      try {
        const st = fs.statSync(p);
        out.push({ p: rel, t: e.isDirectory() ? 'd' : 'f', sz: st.size, mtime: st.mtime.toISOString() });
        if (e.isDirectory() && depth > 0) out.push(...walk(p, depth - 1, base));
      } catch (err) { out.push({ p: rel, t: e.isDirectory() ? 'd' : 'f', err: String(err.code || err).slice(0, 20) }); }
    }
  } catch (err) { return [{ p: path.basename(dir), err: String(err.code || err).slice(0, 20) }]; }
  return out;
};

// 1) RESTORE observable: cache state at build start
R.cacheStart = walk('/opt/build/cache', 4).slice(0, 120);
R.cacheStartCount = R.cacheStart.length;
flush();

// 2) dump every small file under /opt/build/cache (metadata hunt: ids, s3 keys)
R.cacheFiles = {};
const dumpSmall = (dir, depth = 4) => {
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth > 0) dumpSmall(p, depth - 1); continue; }
      try {
        const st = fs.statSync(p);
        if (st.size < 4096) R.cacheFiles[path.relative('/opt/build/cache', p)] = cap(fs.readFileSync(p, 'utf8'), 1500);
        else R.cacheFiles[path.relative('/opt/build/cache', p)] = { size: st.size, skipped: true };
      } catch (err) { R.cacheFiles[path.relative('/opt/build/cache', p)] = { err: String(err.code || err).slice(0, 20) }; }
    }
  } catch {}
};
dumpSmall('/opt/build/cache');
flush();

// 3) cache-related env + netlify_config cache keys
try { R.envCache = Object.fromEntries(Object.entries(process.env).filter(([k]) => /CACHE|CACHED/i.test(k))); } catch {}
try {
  const cfg = JSON.parse(fs.readFileSync('/tmp/netlify_config.json', 'utf8'));
  R.cfgCacheKeys = Object.keys(cfg).filter((k) => /cache/i.test(k));
  R.buildInfo = (() => { try { return JSON.parse(fs.readFileSync('/tmp/build-info.json', 'utf8')); } catch { return null; } })();
} catch (e) { R.cfgErr = String(e).slice(0, 80); }
flush();

// 4) SAVE-side: plant markers in cache-managed paths (dirs from the daemon taxonomy)
const MARK = 'tawhid-cache-marker-' + Date.now();
R.mark = MARK;
R.plant = {};
for (const [tag, dir] of [
  ['netlifyPlugins', '/opt/build/repo/.netlify/plugins/tawhid-marker'],
  ['nodeModules', '/opt/build/repo/node_modules/.tawhid-marker'],
  ['cacheBoot', '/opt/build/cache/.boot/tawhid-marker'],
  ['cacheRoot', '/opt/build/cache/tawhid-marker-dir'],
  ['homeCache', '/opt/buildhome/.cache/tawhid-marker'],
]) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'marker.txt'), MARK + '\n'); R.plant[tag] = { ok: true, dir }; }
  catch (e) { R.plant[tag] = { err: String(e).slice(0, 80) }; }
}
flush();

// 5) what cache paths exist in repo/home (restore side for repo-cached dirs)
R.repoCached = {
  netlifyPlugins: walk('/opt/build/repo/.netlify/plugins', 2).slice(0, 30),
  nodeModules: fs.existsSync('/opt/build/repo/node_modules') ? walk('/opt/build/repo/node_modules', 1).slice(0, 30) : 'ABSENT',
  homeCache: fs.existsSync('/opt/buildhome/.cache') ? walk('/opt/buildhome/.cache', 2).slice(0, 30) : 'ABSENT',
};
flush();

R.done = new Date().toISOString();
flush();
console.log('agentdeep-10 done', R.cacheStartCount, 'cache entries at start');
