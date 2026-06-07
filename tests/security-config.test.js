const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('database seeding skips default demo users in production', () => {
    const database = read('config/database.js');
    assert.match(database, /NODE_ENV\s*===\s*['"]production['"]/);
    assert.match(database, /Lewati seeding user default di production|Skipping default user seeding in production/);
});

test('environment example documents configurable proxy timeout', () => {
    const envExample = read('.env.example');
    assert.match(envExample, /PROXY_TIMEOUT_MS=\d+/);
});
