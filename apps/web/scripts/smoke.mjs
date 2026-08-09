/**
 * End-to-end check of the BFF routes against a real Next server and a real API.
 * The credential handoff spans two routes and a browser-owned cookie, so
 * mocking it would only prove the mock works.
 *
 *   pnpm --filter api dev
 *   pnpm --filter web dev
 *   MERIDIAN_PASSWORD=... pnpm --filter web smoke
 */

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const PASSWORD = process.env.MERIDIAN_PASSWORD;

if (!PASSWORD) {
  console.error('Set MERIDIAN_PASSWORD to the password you hashed into MERIDIAN_PASSWORD_HASH.');
  process.exit(2);
}

let cookie = '';
let failures = 0;

/** `redirect: manual` so a middleware 307 is an observable result, not a follow. */
async function call(path, options = {}) {
  const response = await fetch(`${WEB}${path}`, {
    ...options,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...options.headers },
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const [pair] = setCookie.split(';');
    // maxAge=0 is how a delete arrives; drop the jar rather than store an
    // empty value that would look like a session.
    cookie = /=;|Max-Age=0/.test(setCookie) ? '' : pair;
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text.slice(0, 120);
  }
  return { status: response.status, body, location: response.headers.get('location') };
}

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

console.log(`\n${WEB}\n`);

console.log('signed out');
{
  const health = await call('/api/health');
  check('health reaches the backend', health.status === 200 && health.body?.status, health.body);

  const list = await call('/api/analyses');
  check('analyses list is 401', list.status === 401, list);

  const page = await call('/dashboard');
  check(
    'middleware redirects to sign-in',
    page.status === 307 && page.location?.includes('/sign-in'),
    { status: page.status, location: page.location },
  );

  const wrong = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'definitely-not-the-password' }),
  });
  check('wrong password is 401', wrong.status === 401, wrong);
  check('wrong password sets no cookie', cookie === '', cookie);

  const empty = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({}) });
  check('missing password is 400', empty.status === 400, empty);
}

console.log('\nsigning in');
{
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD }),
  });
  check('login succeeds', login.status === 200 && login.body?.ok === true, login);
  check('session cookie is set', cookie.startsWith('meridian_session='), cookie);
  check('token is not in the response body', !JSON.stringify(login.body ?? {}).includes('.'), login.body);
}

console.log('\nsigned in');
let firstId;
{
  const me = await call('/api/auth/me');
  check('me is authenticated', me.status === 200 && me.body?.authenticated === true, me);

  const list = await call('/api/analyses?limit=5');
  check('list returns rows', list.status === 200 && Array.isArray(list.body?.analyses), list.body);
  check('limit is honoured', (list.body?.analyses?.length ?? 0) <= 5, list.body?.count);
  firstId = list.body?.analyses?.[0]?.id;

  const filtered = await call('/api/analyses?symbol=btc');
  check(
    'symbol filter is case-insensitive',
    filtered.status === 200 &&
      (filtered.body?.analyses ?? []).every((a) => a.symbol === 'BTC'),
    filtered.body?.count,
  );

  const bad = await call('/api/analyses?symbol=not!a!symbol', { method: 'POST' });
  check('invalid symbol is rejected before the backend', bad.status === 400, bad);

  const missing = await call('/api/analyses/does-not-exist');
  check('unknown id is 404', missing.status === 404, missing);
}

if (firstId) {
  console.log('\ndetail');
  const detail = await call(`/api/analyses/${firstId}`);
  if (detail.status === 422) {
    console.log('  skip  newest row predates the level map — run POST /api/analyses?symbol=BTC first');
  } else {
    const { body } = detail;
    check('detail returns 200', detail.status === 200, detail.status);
    check('has a level map with zones', Array.isArray(body?.analysis?.map?.zones), typeof body?.analysis?.map);
    check('has plans', Array.isArray(body?.analysis?.plans), typeof body?.analysis?.plans);
    check('has a live price', typeof body?.currentPrice === 'number' && body.currentPrice > 0, body?.currentPrice);
    check(
      'freshness is one of the three',
      ['LIVE', 'INVALIDATED', 'SUPERSEDED'].includes(body?.freshness),
      body?.freshness,
    );
    check(
      'one outcome per plan',
      body?.outcomes?.length === body?.analysis?.plans?.length,
      { outcomes: body?.outcomes?.length, plans: body?.analysis?.plans?.length },
    );
  }
} else {
  console.log('\n  skip  no saved analyses — run POST /api/analyses?symbol=BTC first');
}

console.log('\nsigning out');
{
  const logout = await call('/api/auth/logout', { method: 'POST' });
  check('logout succeeds', logout.status === 200, logout);
  check('cookie is cleared', cookie === '', cookie);

  const after = await call('/api/analyses');
  check('list is 401 again', after.status === 401, after);
}

console.log(failures === 0 ? '\nall checks passed\n' : `\n${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
