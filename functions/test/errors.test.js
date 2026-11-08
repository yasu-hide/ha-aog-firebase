'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

// params (defineString / defineSecret) の .value() は process.env を読むので env で与える。
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
const OAuth2Server = require('oauth2-server');
const AuthStore = require('../oauth2_store');
const { AuthModel } = require('../oauth2');
const { showError } = require('../utils');
const server = require('../server');
unmute();

// Firebase のスタブ手法: firebase-admin 自体は差し替えず、DB に触れる oauth2_store の
// エクスポート関数 (getAccessToken など) をテスト内で上書きする。oauth2.js は
// AuthStore.xxx をモジュールオブジェクト経由で呼ぶため、require キャッシュ上の同じ
// exports オブジェクトを書き換えれば差し替わる。getClient は DB を使わないので実物を使う。
const originalStore = { ...AuthStore };
test.afterEach(() => Object.assign(AuthStore, originalStore));

const futureToken = (clientId) => ({
    access_token: 'tok',
    expires_at: new Date(Date.now() + 3600 * 1000).toJSON(),
    client_id: clientId,
    user_id: 'user-1'
});

// showError 用の偽 res
const fakeRes = () => {
    const r = { statusCode: null, headers: {}, body: undefined };
    r.status = (c) => { r.statusCode = c; return r; };
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

test('store.getClient: client_id 不一致は null', async () => {
    mute();
    try {
        assert.strictEqual(await AuthStore.getClient('wrong', undefined), null);
        assert.strictEqual(await AuthStore.getClient('client-id', 'wrong-secret'), null);
    } finally { unmute(); }
});

test('store.getClient: 一致すればクライアントを返す', async () => {
    const c = await AuthStore.getClient('client-id', 'client-secret');
    assert.strictEqual(c.id, 'client-id');
    assert.ok(Array.isArray(c.grants));
    assert.ok(Array.isArray(c.redirect_uris));
    const c2 = await AuthStore.getClient('client-id');
    assert.strictEqual(c2.id, 'client-id');
});

test('AuthModel.getClient: 不一致は null', async () => {
    mute();
    try {
        assert.strictEqual(await AuthModel.getClient('client-id', 'wrong-secret'), null);
    } finally { unmute(); }
});

test('AuthModel.getAccessToken: トークンのクライアントが不一致なら null', async () => {
    AuthStore.getAccessToken = async () => futureToken('other-client');
    mute();
    try {
        assert.strictEqual(await AuthModel.getAccessToken('tok'), null);
    } finally { unmute(); }
});

test('showError: OAuthError のメッセージは error.code のステータスで返す', () => {
    for (const [err, status] of [
        [new OAuth2Server.InvalidTokenError('Invalid token: access token is invalid'), 401],
        [new OAuth2Server.InvalidRequestError('Missing parameter'), 400]
    ]) {
        const res = fakeRes();
        mute();
        try { showError(res, err); } finally { unmute(); }
        assert.strictEqual(res.statusCode, status);
        assert.deepStrictEqual(res.body, { error: err.message });
        assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
    }
});

test('showError: 想定外エラーは 500 で internal_error のみ返す', () => {
    for (const err of [new Error('mismatch secret db path'), new OAuth2Server.ServerError(new Error('mismatch secret db path'))]) {
        const res = fakeRes();
        mute();
        try { showError(res, err); } finally { unmute(); }
        assert.strictEqual(res.statusCode, 500);
        assert.deepStrictEqual(res.body, { error: 'internal_error' });
        assert.ok(!JSON.stringify(res.body).includes('mismatch'));
    }
});

test('showError: 文字列と SyntaxError は 400 でそのまま返す', () => {
    for (const [arg, msg] of [['missing inputs', 'missing inputs'], [new SyntaxError('devices required'), 'devices required']]) {
        const res = fakeRes();
        mute();
        try { showError(res, arg); } finally { unmute(); }
        assert.strictEqual(res.statusCode, 400);
        assert.deepStrictEqual(res.body, { error: msg });
    }
});

// --- HTTP 経由のテスト ---
let httpServer;
let port;

test.before(async () => {
    httpServer = http.createServer(server);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    port = httpServer.address().port;
});

test.after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
});

// タイムアウト付きリクエスト。ハングしたら status: 'timeout' を返す。
function request(method, path, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        mute();
        const origWrite = process.stdout.write;
        process.stdout.write = function (chunk, ...rest) {
            if (/(GET|POST) \//.test(String(chunk))) return true;
            return origWrite.call(this, chunk, ...rest);
        };
        const restore = () => { unmute(); process.stdout.write = origWrite; };
        const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => { clearTimeout(timer); restore(); resolve({ status: res.statusCode, body: data }); });
        });
        const timer = setTimeout(() => { req.destroy(); restore(); resolve({ status: 'timeout' }); }, 2000);
        req.on('error', (e) => { clearTimeout(timer); restore(); if (e.code === 'ECONNRESET') return; reject(e); });
        req.end(body);
    });
}

test("POST '/' に inputs: [] を送るとハングせず 400 missing intent", async () => {
    AuthStore.getAccessToken = async () => futureToken('client-id');
    const r = await request('POST', '/', {
        headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
        body: JSON.stringify({ inputs: [] })
    });
    assert.strictEqual(r.status, 400);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'missing intent' });
});

test("GET '/auth' (body も query も無し) は TypeError にならず 400 を返す", async () => {
    // client_id が無いので画面は出さない (auth-redirect.test.js)。ここでは 500/TypeError にならないことを確認する。
    const r = await request('GET', '/auth');
    assert.strictEqual(r.status, 400);
    assert.ok(!r.body.includes('TypeError'));
});

// --- 無効トークンは 401 (フルフィルメント) ---
for (const path of ['/', '/request-sync', '/report-state']) {
    test(`POST '${path}' はトークン無しなら 401`, async () => {
        const r = await request('POST', path, {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(r.status, 401);
    });

    test(`POST '${path}' は期限切れトークンなら 401`, async () => {
        AuthStore.getAccessToken = async () => ({ ...futureToken('client-id'), expires_at: new Date(Date.now() - 1000).toJSON() });
        const r = await request('POST', path, {
            headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
            body: JSON.stringify({})
        });
        assert.strictEqual(r.status, 401);
    });
}

// --- /token のエラー ---
const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
const tokenRequest = (params, authorization = basic('client-id', 'client-secret')) => request('POST', '/token', {
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
    body: new URLSearchParams(params).toString()
});

test("POST '/token' は存在しない認可コードなら 400 invalid_grant", async () => {
    AuthStore.getAuthorizationCode = async () => null;
    const r = await tokenRequest({ grant_type: 'authorization_code', code: 'nope', redirect_uri: 'https://example.com/cb' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_grant');
});

test("POST '/token' は存在しないリフレッシュトークンなら 400 invalid_grant", async () => {
    AuthStore.getRefreshToken = async () => null;
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'nope' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_grant');
});

test("POST '/token' は Basic 認証の client が誤りなら 401 invalid_client", async () => {
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x' }, basic('wrong', 'wrong'));
    assert.strictEqual(r.status, 401);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_client');
});

test("POST '/token' は AuthStore の例外なら 500 server_error で内部メッセージを返さない", async () => {
    AuthStore.getRefreshToken = async () => { throw new Error('mismatch secret db path'); };
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x' });
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(JSON.parse(r.body), { error: 'server_error', description: 'internal_error' });
    assert.ok(!r.body.includes('mismatch'));
});
