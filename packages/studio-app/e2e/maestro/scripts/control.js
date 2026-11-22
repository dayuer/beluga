// Maestro runScript helper for communicating with e2e/run.mjs control server.
const base = (typeof E2E_CONTROL !== 'undefined' && E2E_CONTROL) ? E2E_CONTROL : 'http://127.0.0.1:8791';

function mustOk(res, label) {
  if (!res.ok) {
    throw new Error(label + ' failed: ' + res.status + ' ' + res.body);
  }
  return json(res.body);
}

function post(pathname, payload) {
  const res = http.post(base + pathname, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return mustOk(res, 'POST ' + pathname);
}

if (ACTION === 'loginLink') {
  const data = mustOk(http.get(base + '/login-link'), 'GET /login-link');
  output.loginLink = data.link;
} else if (ACTION === 'invite') {
  // 设备登记邀请：daemon 发一次性码，App 用 synon://join/<id>#k=…&n=… 登记设备密钥。
  const data = mustOk(
    http.post(base + '/invite', { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    'POST /invite',
  );
  output.deviceLink =
    'synon://join/' +
    encodeURIComponent(String(data.inviteId)) +
    '#k=' +
    encodeURIComponent(String(data.k)) +
    '&n=' +
    encodeURIComponent(String(data.fingerprint));
} else if (ACTION === 'hubOffline') {
  post('/hub/offline');
} else if (ACTION === 'hubOnline') {
  post('/hub/online');
} else if (ACTION === 'daemonStop') {
  post('/daemon/stop');
} else if (ACTION === 'daemonStart') {
  post('/daemon/start');
} else if (ACTION === 'daemonReset') {
  post('/daemon/reset');
} else if (ACTION === 'daemonRevoke') {
  // SS-234：把登记过的设备移出假节点的信任名单，下一次签名动作会被拒。
  post('/daemon/revoke-device', typeof REVOKE_PUBKEY !== 'undefined' && REVOKE_PUBKEY ? { pubkey: REVOKE_PUBKEY } : {});
} else if (ACTION === 'daemonApprove') {
  post('/daemon/approve');
} else if (ACTION === 'daemonView') {
  const payload = { name: VIEW };
  if (typeof PATCH_JSON !== 'undefined' && PATCH_JSON) {
    payload.patch = JSON.parse(PATCH_JSON);
  }
  post('/daemon/view', payload);
} else if (ACTION === 'getDelivered') {
  const kind = (typeof KIND !== 'undefined' && KIND) ? KIND : 'plan.create';
  const data = mustOk(http.get(base + '/delivered?kind=' + kind), 'GET /delivered');
  output.deliveredCount = String(data.count);
} else if (ACTION === 'assertDelivered') {
  const kind = (typeof KIND !== 'undefined' && KIND) ? KIND : 'plan.create';
  const body = { kind: kind };
  if (typeof BASELINE !== 'undefined' && BASELINE !== '') {
    body.baseline = Number(BASELINE);
    body.delta = Number(DELTA);
  } else {
    body.expected = Number(EXPECTED);
  }
  post('/assert-delivered', body);
} else {
  throw new Error('Unknown ACTION: ' + ACTION);
}
