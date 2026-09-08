'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrigin, runSmoke } = require('../../scripts/cloudbase-staging-smoke');

function response(body, { status = 200, headers = {} } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => normalized.get(String(name).toLowerCase()) || null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

test('staging smoke origin accepts only a clean HTTPS service root', () => {
  assert.equal(normalizeOrigin('https://test-api.pennysclub.com/'), 'https://test-api.pennysclub.com');
  assert.throws(() => normalizeOrigin('http://test-api.pennysclub.com'), /HTTPS/);
  assert.throws(() => normalizeOrigin('https://test-api.pennysclub.com/member/'), /根地址/);
  assert.throws(() => normalizeOrigin('https://user:pass@test-api.pennysclub.com'), /不能包含凭据/);
});

test('online staging smoke verifies DNS, exact safe profile and both pages', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.endsWith('/healthz')) return response({
      ok: true,
      deploymentProfile: 'cloudbase_staging_demo',
      anonymousDemoOnly: true,
      persistence: { kind: 'memory_demo', persistent: false, anonymousDemoOnly: true }
    });
    if (url.endsWith('/member/')) return response('<title>Penny’s Club</title>会员端移动预览 · 全部为虚构演示数据');
    return response('<title>Penny’s Club 运营后台</title>');
  };
  const result = await runSmoke({
    origin: 'https://test-api.pennysclub.com',
    lookup: async () => [{ address: '192.0.2.1', family: 4 }],
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.deploymentProfile, 'cloudbase_staging_demo');
  assert.deepEqual(calls, [
    'https://test-api.pennysclub.com/healthz',
    'https://test-api.pennysclub.com/member/',
    'https://test-api.pennysclub.com/admin/'
  ]);
});

test('online staging smoke stops when production bootstrap is exposed', async () => {
  await assert.rejects(() => runSmoke({
    origin: 'https://test-api.pennysclub.com',
    lookup: async () => [{ address: '192.0.2.1', family: 4 }],
    fetchImpl: async () => response({
      ok: true,
      deploymentProfile: 'cloudbase_production_bootstrap',
      anonymousDemoOnly: false,
      businessApisEnabled: false,
      persistence: { kind: 'production_bootstrap_disabled', persistent: false }
    })
  }), error => error.code === 'WRONG_DEPLOYMENT_PROFILE');
});

test('online staging smoke reports an unresolved custom domain without making requests', async () => {
  let requested = false;
  await assert.rejects(() => runSmoke({
    origin: 'https://test-api.pennysclub.com',
    lookup: async () => { throw new Error('not found'); },
    fetchImpl: async () => { requested = true; return response({}); }
  }), error => error.code === 'DNS_UNRESOLVED');
  assert.equal(requested, false);
});
