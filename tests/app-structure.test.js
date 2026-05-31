const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('database schema contains gateway core and advanced operational tables', () => {
    const sql = read('config/init.sql');
    [
        'CREATE TABLE IF NOT EXISTS users',
        'CREATE TABLE IF NOT EXISTS api_services',
        'CREATE TABLE IF NOT EXISTS request_logs',
        'CREATE TABLE IF NOT EXISTS revenue_logs',
        'CREATE TABLE IF NOT EXISTS api_keys',
        'CREATE TABLE IF NOT EXISTS api_key_usage',
        'CREATE TABLE IF NOT EXISTS audit_logs',
        'CREATE TABLE IF NOT EXISTS service_health_logs',
        'CREATE TABLE IF NOT EXISTS system_alerts'
    ].forEach(fragment => assert.match(sql, new RegExp(fragment.replace(/[()]/g, '\\$&'))));
});

test('gateway routes use dynamic services and separated revenue logs', () => {
    const gateway = read('routes/gateway.js');
    assert.match(gateway, /FROM api_services/);
    assert.match(gateway, /INSERT INTO revenue_logs/);
    assert.doesNotMatch(gateway, /process\.env\.(SMARTBANK|MARKETPLACE|POS)_URL/);
});

test('dashboard exposes monitoring, export, docs, alerts, and API key quota features', () => {
    const server = read('server.js');
    [
        '/dashboard/analytics/export',
        '/dashboard/audit/export',
        '/dashboard/docs',
        '/dashboard/architecture',
        '/dashboard/alerts',
        '/api/demo/seed-data',
        '/api/alerts/:id/resolve',
        'daily_limit',
        'health_path'
    ].forEach(fragment => assert.ok(server.includes(fragment), `${fragment} is missing`));
});

test('csrf protection is wired for dashboard mutations', () => {
    const server = read('server.js');
    const dashboard = read('views/dashboard.ejs');
    const portal = read('views/client_portal.ejs');
    assert.match(server, /verifyCsrfToken/);
    assert.match(dashboard, /csrfFetch/);
    assert.match(portal, /csrfFetch/);
    assert.match(dashboard, /name="_csrf"/);
});
