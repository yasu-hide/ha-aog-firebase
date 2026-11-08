'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});
process.env.OAUTH_CLIENT_ID = 'client-id';
process.env.OAUTH_CLIENT_SECRET = 'client-secret';
process.env.HOMEGRAPH_API_KEY = 'api-key';

const savedConsole = { log: console.log, info: console.info, error: console.error, warn: console.warn };
const mute = () => { console.log = console.info = console.error = console.warn = () => {}; };
const unmute = () => Object.assign(console, savedConsole);

mute();
const AuthStore = require('../oauth2_store');
const { auth } = require('../oauth2');
unmute();

const originalStore = { ...AuthStore };
test.afterEach(() => Object.assign(AuthStore, originalStore));

const REGISTERED = [
    'https://oauth-redirect.googleusercontent.com/r/p',
    'https://p.firebaseapp.com/__/auth/handler'
];
const BAD_BODY = { error: 'invalid_request', description: 'invalid client_id or redirect_uri' };

const fakeRes = () => {
    const r = { statusCode: null, body: undefined, rendered: null };
    r.status = (c) => { r.statusCode = c; return r; };
    r.set = () => r;
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.render = (view, locals) => { r.rendered = { view, locals }; return r; };
    return r;
};

const callAuth = async (req) => {
    const res = fakeRes();
    mute();
    try { await auth({ headers: {}, query: {}, ...req }, res); } finally { unmute(); }
    return res;
};

const assertRejected = (res) => {
    assert.strictEqual(res.rendered, null);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, BAD_BODY);
};

test('登録済み redirect_uri はそのまま login を表示する', async () => {
    for (const uri of REGISTERED) {
        const res = await callAuth({ query: { client_id: 'client-id', redirect_uri: uri, state: 's1' } });
        assert.strictEqual(res.rendered.view, 'login');
        assert.strictEqual(res.rendered.locals.redirect_uri, uri);
        assert.strictEqual(res.rendered.locals.state, 's1');
    }
});

test('body (query が無い) の client_id / redirect_uri も検証対象になる', async () => {
    const res = await callAuth({ query: {}, body: { client_id: 'client-id', redirect_uri: REGISTERED[1] } });
    assert.strictEqual(res.rendered.locals.redirect_uri, REGISTERED[1]);
    const bad = await callAuth({ query: {}, body: { client_id: 'client-id', redirect_uri: 'https://evil.example/cb' } });
    assertRejected(bad);
});

test('未登録・不正形式の redirect_uri は 400 で画面を出さない', async () => {
    const cases = [
        'https://evil.example/cb',
        'javascript:alert(1)',
        REGISTERED[0] + '/x',
        REGISTERED[0] + '?a=b',
        'x' + REGISTERED[0],
        REGISTERED[0].toUpperCase(),
        REGISTERED[1].replace('firebaseapp', 'FirebaseApp'),
        [REGISTERED[0]],
        [REGISTERED[0], 'https://evil.example/cb'],
        { 0: REGISTERED[0] },
        { toString: 'x' },
    ];
    for (const uri of cases) {
        assertRejected(await callAuth({ query: { client_id: 'client-id', redirect_uri: uri } }));
    }
});

test('client_id の欠落・不一致・配列・空は 400', async () => {
    const ids = [undefined, '', 'wrong', ['client-id'], { a: 'client-id' }];
    for (const id of ids) {
        assertRejected(await callAuth({ query: { client_id: id, redirect_uri: REGISTERED[0] } }));
    }
});

test('redirect_uri が無い・空なら先頭の登録済み URI を使う', async () => {
    for (const q of [{ client_id: 'client-id' }, { client_id: 'client-id', redirect_uri: '' }]) {
        const res = await callAuth({ query: q });
        assert.strictEqual(res.rendered.view, 'login');
        assert.strictEqual(res.rendered.locals.redirect_uri, REGISTERED[0]);
    }
});

test('400 のレスポンスに入力値を含めない', async () => {
    const res = await callAuth({ query: { client_id: 'SENTINEL-CID', redirect_uri: 'https://evil.example/SENTINEL-URI' } });
    assertRejected(res);
    const out = JSON.stringify(res.body);
    assert.ok(!out.includes('SENTINEL'));
    assert.ok(!out.includes('evil.example'));
});

test('AuthStore.getClient が例外を投げたら 500 (internal_error) で画面を出さない', async () => {
    AuthStore.getClient = async () => { throw new Error('db down SENTINEL'); };
    const res = await callAuth({ query: { client_id: 'client-id', redirect_uri: REGISTERED[0] } });
    assert.strictEqual(res.rendered, null);
    assert.strictEqual(res.statusCode, 500);
    assert.ok(!JSON.stringify(res.body).includes('SENTINEL'));
});
