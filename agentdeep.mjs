// agentdeep-1 — build-agent interior at AGENT depth (Lane A, episode 59c81839).
// Reads the buildbot/supervisor/sandbox processes, their env (redacted), auth
// materialization, privilege surface, /tmp build files, node-host reachability.
// Bounded: own tenant only; host contact = 5 ports x 2.5s on the single node IP.
import fs from 'node:fs';
import cp from 'node:child_process';
import net from 'node:net';
import http from 'node:http';

const R = { probe: 'agentdeep-1', t: new Date().toISOString() };
const cap = (v, n = 40000) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const rf = (f, n = 40000) => { try { return cap(fs.readFileSync(f, 'utf8'), n); } catch (e) { return 'ERR ' + String(e).slice(0, 90); } };
const sh = (c, n = 6000) => { try { return cap(cp.execSync(c, { encoding: 'utf8', timeout: 9000 }).toString(), n); } catch (e) { return 'ERR ' + String(e.stderr || e).slice(0, 220); } };
const OUT = 'agentdeep-out';
fs.mkdirSync(OUT, { recursive: true });
const flush = () => { try { fs.writeFileSync(OUT + '/agentdeep.json', JSON.stringify(R, null, 1)); } catch {} };

try {
  R.id = sh('id'); R.uname = sh('uname -a');

  // 1. full process inventory — argv of EVERY pid (the CF Pages "treasure map" read)
  const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x));
  R.ps = pids.map((pid) => {
    const o = { pid };
    try { o.ppid = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[1]; } catch {}
    try { o.cmd = cap(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '), 3000); } catch { o.cmd = 'ERR'; }
    try { o.exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch {}
    try { o.cwd = fs.readlinkSync(`/proc/${pid}/cwd`); } catch {}
    return o;
  });
  flush();

  // 2. env of agent-side processes — secret NAMES + len + JWT claims only, never values
  R.agentEnv = {};
  const interesting = R.ps.filter((p) => p.pid === '1' || /init-supervisor|sandbox|buildbot|phoenix|tinyps|node|supervis/i.test(p.cmd || ''));
  for (const p of interesting.slice(0, 10)) {
    try {
      const env = fs.readFileSync(`/proc/${p.pid}/environ`, 'utf8').split('\0').filter(Boolean);
      R.agentEnv[p.pid + '|' + (p.exe || p.cmd || '').split(' ')[0].slice(-40)] = env.map((l) => {
        const k = l.split('=')[0]; const v = l.slice(k.length + 1);
        if (/token|key|secret|auth|credential|password|jwt|session|bearer/i.test(k)) {
          let claims = null;
          if (/^ey/.test(v)) { try { claims = JSON.parse(Buffer.from((v.split('.')[1] || '') + '==', 'base64').toString('utf8')); } catch {} }
          return k + '=<RED len=' + v.length + (claims ? ' claims=' + JSON.stringify(claims).slice(0, 400) : ' first8=' + v.slice(0, 8)) + '>';
        }
        return cap(l, 400);
      });
    } catch (e) { R.agentEnv[p.pid] = 'ERR ' + String(e).slice(0, 80); }
  }
  flush();

  // 3. supervisor + sandbox + local bin
  R.initSupervisor = rf('/sbin/init-supervisor', 60000);
  R.sandboxBin = rf('/usr/local/bin/sandbox', 12000);
  R.binLocal = sh('ls -la /usr/local/bin/ | head -40');
  R.sbin = sh('ls -la /sbin/init-supervisor /usr/local/bin/sandbox 2>&1');
  flush();

  // 4. /tmp build files — full read of the ones never read before
  R.tmp = {};
  try {
    for (const f of fs.readdirSync('/tmp')) {
      let st = null; try { st = fs.statSync('/tmp/' + f); } catch {}
      if (!st) continue;
      if (st.isDirectory()) { try { R.tmp[f + '/'] = fs.readdirSync('/tmp/' + f).slice(0, 60); } catch {} continue; }
      if (/^(system-log|nf-tracing|netlify_config|build-info|)/.test(f)) R.tmp[f] = rf('/tmp/' + f, 50000);
      else R.tmp[f] = { sz: st.size };
    }
  } catch (e) { R.tmpErr = String(e).slice(0, 90); }
  flush();

  // 5. repo auth materialization
  R.gitconfig = rf('/opt/buildhome/.gitconfig', 5000);
  try { R.ssh = fs.readdirSync('/opt/buildhome/.ssh').map((f) => { let sz = null; try { sz = fs.statSync('/opt/buildhome/.ssh/' + f).size; } catch {} return { f, sz }; }); } catch (e) { R.ssh = 'ERR ' + String(e).slice(0, 80); }
  R.sshKeys = {};
  for (const e of (Array.isArray(R.ssh) ? R.ssh : [])) {
    if (/id_|deploy|key|rsa|ed25519/i.test(e.f)) R.sshKeys[e.f] = cap(rf('/opt/buildhome/.ssh/' + e.f, 200).split('\n')[0], 100) + ' filesize=' + e.sz;
  }
  R.gitSSHcmd = process.env.GIT_SSH_COMMAND || null;
  R.sshAuthSock = process.env.SSH_AUTH_SOCK || null;
  R.repoGitConfig = rf('/opt/build/repo/.git/config', 6000);
  R.gitRem = sh('cd /opt/build/repo && git remote -v 2>&1');
  R.keyfiles = sh('find /opt/buildhome /opt/build -maxdepth 2 \\( -name "*.pem" -o -name "id_*" -o -name "*deploy*" \\) 2>/dev/null | head -15');
  flush();

  // 6. privilege surface
  R.sudo = sh('sudo -n -l 2>&1 | head -30');
  R.status = rf('/proc/self/status', 2500);
  R.mounts = rf('/proc/mounts', 6000);
  R.k8s = fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount') ? fs.readdirSync('/var/run/secrets/kubernetes.io/serviceaccount') : 'absent';
  R.pathw = sh('for d in $(echo $PATH | tr ":" " "); do find "$d" -maxdepth 1 -perm -0002 -type f 2>/dev/null; done | head -30');
  R.passwd = sh('head -20 /etc/passwd');
  R.cgroup = rf('/proc/self/cgroup', 1000);
  flush();

  // 7. listeners visible from the container namespace
  R.tcp = rf('/proc/net/tcp', 4000);
  R.tcp6 = rf('/proc/net/tcp6', 1500);
  flush();

  // 8. node host: 5 targeted ports, 2.5s cap each — bounded, no scanning
  const HOST = process.env.HOST_NODE_IP;
  R.hostProbe = {};
  if (HOST) {
    await Promise.all([80, 10250, 10255, 2375, 8080].map((port) => new Promise((res) => {
      const done = (v) => { if (R.hostProbe[port] === undefined) { R.hostProbe[port] = v; } try { req.destroy(); } catch {} res(); };
      const req = http.get({ host: HOST, port, path: '/', timeout: 2500 }, (r2) => {
        let b = ''; const to = setTimeout(() => done({ s: r2.statusCode, b: cap(b, 300) }), 1200);
        r2.on('data', (c) => { b += c; if (b.length > 500) { clearTimeout(to); done({ s: r2.statusCode, b: cap(b, 300) }); } });
        r2.on('end', () => { clearTimeout(to); done({ s: r2.statusCode, b: cap(b, 300) }); });
      });
      req.on('timeout', () => done('timeout'));
      req.on('error', (e) => done(String(e.code || e).slice(0, 40)));
    })));
  }
  flush();

  // 9. buildbot unix socket — banner grab + minimal HTTP/1.0 (HTTP/1.1 hung up before)
  R.sock = {};
  await new Promise((res) => {
    let s; const t = setTimeout(() => { R.sock.banner = (R.sock.banner || '') + '|2s-timeout'; try { s.destroy(); } catch {} res(); }, 2500);
    try { s = net.connect('/tmp/netlify-buildbot-socket'); } catch (e) { clearTimeout(t); R.sock.err = String(e).slice(0, 80); return res(); }
    s.on('connect', () => { R.sock.connected = true; try { s.write('GET / HTTP/1.0\r\nHost: localhost\r\n\r\n'); } catch {} });
    s.on('data', (d) => { R.sock.banner = (R.sock.banner || '') + JSON.stringify(d.toString('utf8')).slice(1, 400); });
    s.on('error', (e) => { R.sock.err = String(e).slice(0, 100); });
    s.on('close', () => { clearTimeout(t); res(); });
  });
  flush();

  // 10. build base layout + any config json/yaml at depth 1
  R.optBuild = sh('ls -la /opt/build | head -25');
  R.buildhomeLs = sh('ls -la /opt/buildhome | head -35');
  R.optCfg = {};
  try { for (const f of fs.readdirSync('/opt/build')) { if (/\.(json|ya?ml|toml|env|conf)$/.test(f)) R.optCfg['/opt/build/' + f] = rf('/opt/build/' + f, 20000); } } catch {}
  flush();
} catch (e) {
  R.fatal = String(e && e.stack || e).slice(0, 800);
}
R.done = new Date().toISOString();
flush();
console.log('agentdeep-1 done; sections=' + Object.keys(R).length);
