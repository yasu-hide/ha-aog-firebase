'use strict';

const test = require('node:test');
const assert = require('node:assert');

const savedConfig = process.env.FIREBASE_CONFIG;
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});

const m = require('../index.js');
if (savedConfig === undefined) delete process.env.FIREBASE_CONFIG;
else process.env.FIREBASE_CONFIG = savedConfig;

test('index.js がロードでき、関数をエクスポートする', () => {
    for (const name of ['ha', 'authAction', 'delAccount']) {
        assert.ok(m[name], `${name} is exported`);
    }
});
