// agentdeep-3 — enumerate the buildbot gRPC socket surface (client code in node-deps),
// full gRPC method-path strings from the buildbot binary, host-node telemetry ports
// (8125/4317/4318), and cache keying. Own tenant, single build, bounded, no sweeping.
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';
import cp from 'node:child_process';

const R = { probe: 'agentdeep-3', t: new Date().toISOString() };
const cap = (v, n = 60000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC(' + v.length + ')' : v);
const rf = (f, n = 60000) => { try { return cap(fs.readFileSync(f, 'utf8'), n); } catch (e) { return 'ERR ' + String(e).slice(0, 90); } };
const sh = (c, n = 12000, t = 15000) => { try { return cap(cp.execSync(c, { encoding: 'utf8', timeout: t, maxBuffer: 8 * 1024 * 1024 }).toString(), n); } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 300); } };
fs.mkdirSync('agentdeep-out', { recursive: true });
const flush = () => { try { fs.writeFileSync('agentdeep-out/agentdeep3.json', JSON.stringify(R, null, 1)); } catch {} };

// ---- 0. socket presence, perms, reachability from build uid ------------------
R.socket = {};
try {
  const st = fs.statSync('/tmp/netlify-buildbot-socket');
  R.socket.stat = { mode: '0' + (st.mode & 0o777).toString(8), uid: st.uid, gid: st.gid, socket: st.isSocket() };
} catch (e) { R.socket.stat = 'ERR ' + String(e).slice(0, 90); }
R.socket.tmpLs = sh('ls -la /tmp/ 2>&1 | head -40');
await new Promise((res) => {
  let settled = false;
  const done = () => { if (!settled) { settled = true; res(); } };
  const s = net.connect({ path: '/tmp/netlify-buildbot-socket' });
  const t = setTimeout(() => { R.socket.connect = 'TIMEOUT'; s.destroy(); done(); }, 4000);
  s.on('connect', () => {
    clearTimeout(t);
    R.socket.connect = 'OK — build uid CAN connect';
    let got = false;
    s.on('data', (d) => {
      if (got) return; got = true;
      R.socket.firstBytes = d.slice(0, 96).toString('hex') + ' | latin1=' + JSON.stringify(d.slice(0, 96).toString('latin1'));
    });
    // minimal h2 client preface + empty SETTINGS — protocol handshake only
    s.write('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x00\x04\x00\x00\x00\x00\x00');
    setTimeout(() => { s.destroy(); done(); }, 2000);
  });
  s.on('error', (e) => { clearTimeout(t); R.socket.connect = 'ERR ' + String(e.code || e); done(); });
});
flush();

// ---- 1. locate + read the socket CLIENT in node-deps -------------------------
R.clientGrep = sh("grep -rl 'netlify-buildbot-socket\\|buildbot-server-socket' /opt/buildhome/node-deps/node_modules 2>/dev/null | head -20", 4000, 25000);
R.socketeerGrep = sh("grep -rl 'socketeer' /opt/buildhome/node-deps/node_modules/@netlify 2>/dev/null | head -10", 2000, 15000);
R.deployKeyGrep = sh("grep -rn 'GetDeployKey\\|ListDeployKeys\\|CreateDeployKey\\|uploadCache\\|cacheKey\\|buildbot' /opt/buildhome/node-deps/node_modules/@netlify/build/lib 2>/dev/null | head -50", 8000, 20000);
const files = String(R.clientGrep || '').split('\n').filter((x) => x && !x.startsWith('ERR'));
R.clientFiles = {};
let budget = 0;
for (const f of files.slice(0, 4)) {
  try {
    const st = fs.statSync(f);
    if (st.size > 250000) { R.clientFiles[f] = { sz: st.size, skip: 'too big' }; continue; }
    if (budget + st.size > 170000) { R.clientFiles[f] = { sz: st.size, skip: 'budget' }; continue; }
    R.clientFiles[f] = rf(f, 55000); budget += st.size;
  } catch (e) { R.clientFiles[f] = 'ERR ' + String(e).slice(0, 80); }
}
flush();

// ---- 2. buildbot binary: full gRPC method-path enumeration -------------------
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
  // gRPC method paths: /pkg.Svc/Method
  R.grpcMethods = [...new Set(all.filter((s) => /^\/[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*\/[A-Za-z0-9_]+$/.test(s) && s.length < 90))].slice(0, 250);
  // proto message/service-ish identifiers around DeployKey/cache
  R.deployKeyCtx = [...new Set(all.filter((s) => /DeployKey|cacheKey|CacheKey|uploadCache|UploadCache|GetCache|SaveCache|cache_key/i.test(s) && s.length < 120))].slice(0, 150);
  // service names containing buildbot
  R.buildbotSvcNames = [...new Set(all.filter((s) => /buildbot/i.test(s) && s.length < 90))].slice(0, 120);
} else { R.grpcMethods = 'no buildbot binary'; }
flush();

// ---- 3. host-node telemetry ports (explicitly egress-allowed) ----------------
const host = process.env.HOST_NODE_IP;
R.hostNode = { ip: host };
const tcpProbe = (port) => new Promise((res) => {
  const s = net.connect({ host, port });
  const t = setTimeout(() => { s.destroy(); res('TIMEOUT'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('OPEN'); });
  s.on('error', (e) => { clearTimeout(t); res(String(e.code || e)); });
});
try { R.hostNode.tcp4317 = await tcpProbe(4317); } catch (e) { R.hostNode.tcp4317 = 'ERR ' + String(e).slice(0, 60); }
try { R.hostNode.tcp4318 = await tcpProbe(4318); } catch (e) { R.hostNode.tcp4318 = 'ERR ' + String(e).slice(0, 60); }
await new Promise((res) => {
  const s = net.connect({ host, port: 4318 });
  const t = setTimeout(() => { s.destroy(); R.hostNode.otlpGet = 'TIMEOUT'; res(); }, 3000);
  let buf = '';
  s.on('connect', () => s.write('GET /v1/traces HTTP/1.1\r\nHost: otel\r\nConnection: close\r\n\r\n'));
  s.on('data', (d) => { buf += d.toString('latin1'); if (buf.length > 6000) { s.destroy(); } });
  s.on('close', () => { clearTimeout(t); R.hostNode.otlpGet = cap(buf.slice(0, 1800)); res(); });
  s.on('error', (e) => { clearTimeout(t); R.hostNode.otlpGet = 'ERR ' + String(e.code || e); res(); });
});
try {
  const u = dgram.createSocket('udp4');
  const t = setTimeout(() => { try { u.close(); } catch {} }, 3000);
  u.send('agentdeep3.probe:1|c', 8125, host, (e) => {
    clearTimeout(t);
    R.hostNode.statsd = e ? 'ERR ' + String(e.code || e) : 'SENT(ok)';
    try { u.close(); } catch {}
  });
} catch (e) { R.hostNode.statsd = 'ERR ' + String(e).slice(0, 80); }
flush();

// ---- 4. cache keying + git config --------------------------------------------
R.gitConfig = rf('/opt/build/repo/.git/config', 4000);
R.gitNetlify = sh('ls -la /opt/build/repo/.git/ 2>&1 | head -20');
R.cacheNetlify = sh('ls -la /opt/build/cache/.netlify 2>&1 | head -20');
R.cacheFind = sh('find /opt/build/cache -maxdepth 3 \\( -name "*.boot" -o -name "*manifest*" -o -name "*.json" -o -name "*.idx" \\) 2>/dev/null | head -20', 6000);
const mfiles = String(R.cacheFind || '').split('\n').filter((x) => x && !x.startsWith('ERR')).slice(0, 8);
R.cacheManifests = {};
for (const m of mfiles) {
  try { const st = fs.statSync(m); if (st.isFile() && st.size < 40000) R.cacheManifests[m] = rf(m, 20000); } catch {}
}
// netlify_config.json structure: key names + redacted token values
R.configShape = {};
try {
  const cfg = JSON.parse(fs.readFileSync('/tmp/netlify_config.json', 'utf8'));
  const walk = (o, p) => {
    for (const k of Object.keys(o || {})) {
      const v = o[k]; const path = p ? p + '.' + k : k;
      if (typeof v === 'string' && /^(nfp_|nfb_)/i.test(v)) R.configShape[path] = '<token ' + v.length + 'ch head=' + v.slice(0, 6) + '>';
      else if (v && typeof v === 'object') walk(v, path);
      else R.configShape[path] = typeof v === 'string' ? (v.length > 120 ? v.slice(0, 120) + '..' : v) : v;
    }
  };
  walk(cfg, '');
} catch (e) { R.configShape = 'ERR ' + String(e).slice(0, 80); }
flush();

R.done = new Date().toISOString();
flush();
console.log('agentdeep-3 done; sections=' + Object.keys(R).length);
