'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});

test('index.js がロードでき、関数をエクスポートする', () => {
    const m = require('../index.js');
    for (const name of ['ha', 'authAction', 'delAccount']) {
        assert.ok(m[name], `${name} is exported`);
    }
});
