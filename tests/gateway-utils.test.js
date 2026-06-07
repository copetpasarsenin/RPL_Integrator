const assert = require('node:assert/strict');
const test = require('node:test');

const { joinUrl, getProxyTimeoutMs, appendQueryString } = require('../utils/gatewayUtils');

test('joinUrl normalizes duplicate slashes between base URL and path', () => {
    assert.equal(joinUrl('http://service/', '/api/data'), 'http://service/api/data');
    assert.equal(joinUrl('http://service', 'api/data'), 'http://service/api/data');
});

test('joinUrl preserves a trailing slash when path is empty', () => {
    assert.equal(joinUrl('http://service/', ''), 'http://service/');
    assert.equal(joinUrl('http://service', ''), 'http://service');
});

test('appendQueryString copies the incoming request query to upstream URL', () => {
    const req = { originalUrl: '/integrator/marketplace/orders?status=paid&page=2' };
    assert.equal(
        appendQueryString('http://marketplace/orders', req),
        'http://marketplace/orders?status=paid&page=2'
    );
});

test('appendQueryString leaves URL unchanged when request has no query', () => {
    const req = { originalUrl: '/integrator/marketplace/orders' };
    assert.equal(appendQueryString('http://marketplace/orders', req), 'http://marketplace/orders');
});

test('getProxyTimeoutMs uses a valid PROXY_TIMEOUT_MS env value', () => {
    const original = process.env.PROXY_TIMEOUT_MS;
    process.env.PROXY_TIMEOUT_MS = '5000';
    assert.equal(getProxyTimeoutMs(), 5000);
    if (original === undefined) delete process.env.PROXY_TIMEOUT_MS;
    else process.env.PROXY_TIMEOUT_MS = original;
});

test('getProxyTimeoutMs falls back to 10000 for invalid env values', () => {
    const original = process.env.PROXY_TIMEOUT_MS;
    process.env.PROXY_TIMEOUT_MS = 'not-a-number';
    assert.equal(getProxyTimeoutMs(), 10000);
    process.env.PROXY_TIMEOUT_MS = '-1';
    assert.equal(getProxyTimeoutMs(), 10000);
    if (original === undefined) delete process.env.PROXY_TIMEOUT_MS;
    else process.env.PROXY_TIMEOUT_MS = original;
});
