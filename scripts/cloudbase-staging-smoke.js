'use strict';

const dns = require('node:dns').promises;
const { profiles } = require('../miniprogram/config/runtime-profiles');

const MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 12000;

class StagingSmokeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'StagingSmokeError';
    this.code = code;
  }
}

function normalizeOrigin(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new StagingSmokeError('测试地址不是有效 URL', 'INVALID_URL');
  }
  if (parsed.protocol !== 'https:') throw new StagingSmokeError('CloudBase 测试地址必须使用 HTTPS', 'HTTPS_REQUIRED');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new StagingSmokeError('测试地址不能包含凭据、查询参数或片段', 'UNSAFE_URL');
  if (parsed.pathname !== '/' && parsed.pathname !== '') throw new StagingSmokeError('请填写服务根地址，不要附加页面路径', 'ORIGIN_REQUIRED');
  return parsed.origin;
}

async function boundedText(response) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new StagingSmokeError('远端响应过大，已停止读取', 'RESPONSE_TOO_LARGE');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new StagingSmokeError('远端响应过大，已停止读取', 'RESPONSE_TOO_LARGE');
  return text;
}

async function request(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json,text/html;q=0.9' },
      signal: controller.signal
    });
    const text = await boundedText(response);
    if (!response.ok) throw new StagingSmokeError(`远端返回 HTTP ${response.status}`, 'HTTP_ERROR');
    return { response, text };
  } catch (error) {
    if (error instanceof StagingSmokeError) throw error;
    if (error?.name === 'AbortError') throw new StagingSmokeError('连接测试服务超时；请检查服务是否暂停、版本流量和健康探针', 'TIMEOUT');
    throw new StagingSmokeError('无法连接测试服务；请检查 DNS、证书、服务状态和路由', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

async function runSmoke({ origin, lookup = dns.lookup, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const safeOrigin = normalizeOrigin(origin || profiles['cloudbase-staging'].apiBase);
  if (typeof fetchImpl !== 'function') throw new StagingSmokeError('当前 Node 运行时不支持 fetch', 'FETCH_UNAVAILABLE');

  const hostname = new URL(safeOrigin).hostname;
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new StagingSmokeError(`域名 ${hostname} 尚未解析`, 'DNS_UNRESOLVED');
  }
  if (!Array.isArray(addresses) || addresses.length === 0) throw new StagingSmokeError(`域名 ${hostname} 没有可用解析结果`, 'DNS_UNRESOLVED');

  const healthResult = await request(fetchImpl, `${safeOrigin}/healthz`, timeoutMs);
  let health;
  try {
    health = JSON.parse(healthResult.text);
  } catch {
    throw new StagingSmokeError('健康检查没有返回 JSON', 'INVALID_HEALTH_RESPONSE');
  }
  const expected = health?.ok === true
    && health?.deploymentProfile === 'cloudbase_staging_demo'
    && health?.anonymousDemoOnly === true
    && health?.persistence?.kind === 'memory_demo'
    && health?.persistence?.persistent === false;
  if (!expected) throw new StagingSmokeError('健康检查不是匿名 staging 档；已停止后续验收', 'WRONG_DEPLOYMENT_PROFILE');

  const member = await request(fetchImpl, `${safeOrigin}/member/`, timeoutMs);
  if (!member.text.includes('Penny’s Club') || !member.text.includes('虚构演示数据')) {
    throw new StagingSmokeError('会员端不是预期的匿名演示页面', 'MEMBER_PAGE_MISMATCH');
  }

  const admin = await request(fetchImpl, `${safeOrigin}/admin/`, timeoutMs);
  if (!/运营后台|Penny’s Club/.test(admin.text)) throw new StagingSmokeError('运营后台页面内容不符合预期', 'ADMIN_PAGE_MISMATCH');

  return Object.freeze({
    ok: true,
    origin: safeOrigin,
    hostname,
    resolvedAddressCount: addresses.length,
    deploymentProfile: health.deploymentProfile,
    anonymousDemoOnly: true,
    persistence: 'memory_demo',
    memberPage: 'ok',
    adminPage: 'ok'
  });
}

async function main() {
  try {
    const cliArgs = process.argv.slice(2).filter(value => value !== '--');
    if (cliArgs.length > 1) throw new StagingSmokeError('只允许传入一个测试服务根地址', 'TOO_MANY_ARGUMENTS');
    const result = await runSmoke({ origin: cliArgs[0] });
    console.log(JSON.stringify(result));
  } catch (error) {
    const code = error instanceof StagingSmokeError ? error.code : 'UNKNOWN_ERROR';
    console.error(`CloudBase staging 在线验收未通过 [${code}]：${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { DEFAULT_TIMEOUT_MS, StagingSmokeError, normalizeOrigin, runSmoke };
