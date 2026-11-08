'use strict';

const test = require('node:test');
const assert = require('node:assert');
const util = require('node:util');

// シークレット・トークン・認可コードがログに出ないことを検証する。
// 番兵 (SENTINEL) 文字列を入力に混ぜ、console 出力に含まれないことを確認する。
const CONF_SECRET = 'SENTINEL-CONF-SECRET-0001';
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});
process.env.OAUTH_CLIENT_ID = 'client-id';
process.env.OAUTH_CLIENT_SECRET = CONF_SECRET;
process.env.HOMEGRAPH_API_KEY = 'api-key';

const SENTINELS = [
    CONF_SECRET,
    'SENTINEL-WRONG-SECRET',
    'SENTINEL-WRONG-CLIENT-ID',
    'SENTINEL-ACCESS-TOKEN',
    'SENTINEL-REFRESH-TOKEN',
    'SENTINEL-AUTH-CODE',
    'SENTINEL-ID-TOKEN',
];

const savedConsole = { log: console.log, info: console.info, error: console.error, warn: console.warn };
let captured = [];
const capture = () => {
    captured = [];
    for (const k of ['log', 'info', 'error', 'warn']) {
        console[k] = (...args) => { captured.push(util.format(...args)); };
    }
};
const restore = () => Object.assign(console, savedConsole);
const assertNoSentinel = () => {
    const out = captured.join('\n');
    for (const s of SENTINELS) {
        assert.ok(!out.includes(s), `log output contains ${s}:\n${out}`);
    }
};
// fn を console キャプチャ下で実行し、番兵が出力されていないことを確認する
const noLeak = async (fn) => {
    capture();
    let result;
    try { result = await fn(); } finally { restore(); }
    assertNoSentinel();
    return result;
};

// oauth2_store は getDatabase を require 時に分割代入で取り込むため、
// require より前に firebase-admin/database のエクスポートを偽 DB に差し替える。
const fakeDb = {};
require('firebase-admin/database').getDatabase = () => ({
    ref: (path) => ({
        set: async (value) => { fakeDb[path] = value; },
        once: async () => ({ val: () => fakeDb[path] ?? null }),
    }),
});

capture();
const AuthStore = require('../oauth2_store');
const { AuthModel } = require('../oauth2');
const app = require('../app');
const { redactForLog } = require('../utils');
restore();

const originalStore = { ...AuthStore };
test.afterEach(() => Object.assign(AuthStore, originalStore));

const future = () => new Date(Date.now() + 3600 * 1000).toJSON();

// --- store.getClient ---

test('store.getClient: secret 不一致のログに入力値・正解値を出さない', async () => {
    assert.strictEqual(await noLeak(() => AuthStore.getClient('client-id', 'SENTINEL-WRONG-SECRET')), null);
    assert.ok(captured.some((l) => l.includes('mismatch client secret')));
});

test('store.getClient: id 不一致のログに入力値を出さない', async () => {
    assert.strictEqual(await noLeak(() => AuthStore.getClient('SENTINEL-WRONG-CLIENT-ID', CONF_SECRET)), null);
    assert.ok(captured.some((l) => l.includes('mismatch client id')));
});

test('store.getClient: 正しい secret ならクライアントを返す', async () => {
    const c = await AuthStore.getClient('client-id', CONF_SECRET);
    assert.strictEqual(c.id, 'client-id');
});

test('store.getClient: secret が空/未指定なら検証せずクライアントを返す', async () => {
    for (const s of [undefined, null, '']) {
        const c = await AuthStore.getClient('client-id', s);
        assert.strictEqual(c.id, 'client-id', `secret=${s}`);
    }
});

test('store.getClient: 長さの異なる/同じ長さの誤った secret は null', async () => {
    const sameLen = CONF_SECRET.slice(0, -1) + 'X';
    assert.strictEqual(sameLen.length, CONF_SECRET.length);
    capture();
    try {
        assert.strictEqual(await AuthStore.getClient('client-id', 'short'), null);
        assert.strictEqual(await AuthStore.getClient('client-id', sameLen), null);
        assert.strictEqual(await AuthStore.getClient('client-id', CONF_SECRET + 'extra'), null);
    } finally { restore(); }
});

// --- store の DB 読み書き ---

test('store set/get: トークン・コードの値もキーもログに出さない', async () => {
    await noLeak(async () => {
        await AuthStore.setAccessTokens('SENTINEL-ACCESS-TOKEN', { access_token: 'SENTINEL-ACCESS-TOKEN', user_id: 'u1' });
        await AuthStore.setRefreshToken('SENTINEL-REFRESH-TOKEN', { refresh_token: 'SENTINEL-REFRESH-TOKEN' });
        await AuthStore.setAuthCode('SENTINEL-AUTH-CODE', { authorization_code: 'SENTINEL-AUTH-CODE' });
        const t = await AuthStore.getAccessToken('SENTINEL-ACCESS-TOKEN');
        assert.strictEqual(t.access_token, 'SENTINEL-ACCESS-TOKEN');
        await AuthStore.getRefreshToken('SENTINEL-REFRESH-TOKEN');
        await AuthStore.getAuthorizationCode('SENTINEL-AUTH-CODE');
        await AuthStore.unsetRefreshToken('SENTINEL-REFRESH-TOKEN');
        await AuthStore.unsetAuthCode('SENTINEL-AUTH-CODE');
    });
    assert.ok(captured.some((l) => l.includes('accesstoken')), 'keytype は出力される');
    assert.strictEqual(fakeDb['refreshtoken/SENTINEL-REFRESH-TOKEN'], null);
});

// --- AuthModel ---

test('AuthModel: 各メソッドがトークン・コード・secret をログに出さない', async () => {
    AuthStore.getRefreshToken = async () => ({ refresh_token: 'SENTINEL-REFRESH-TOKEN', expires_at: future(), client_id: 'client-id', user_id: 'u1' });
    AuthStore.getAuthorizationCode = async () => ({ authorization_code: 'SENTINEL-AUTH-CODE', expires_at: future(), redirect_uri: 'https://x', client_id: 'client-id', user_id: 'u1' });
    AuthStore.setAccessTokens = async (k, v) => v;
    AuthStore.setRefreshToken = async (k, v) => v;
    AuthStore.setAuthCode = async (k, v) => v;
    AuthStore.unsetRefreshToken = async () => null;
    AuthStore.unsetAuthCode = async () => null;
    const client = { id: 'client-id', redirectUris: ['https://x'], grants: ['authorization_code'], secret: 'SENTINEL-WRONG-SECRET' };
    const user = { id: 'u1', idToken: 'SENTINEL-ID-TOKEN' };
    const token = {
        accessToken: 'SENTINEL-ACCESS-TOKEN', accessTokenExpiresAt: future(),
        refreshToken: 'SENTINEL-REFRESH-TOKEN', refreshTokenExpiresAt: future(),
    };
    await noLeak(async () => {
        assert.strictEqual((await AuthModel.getRefreshToken('SENTINEL-REFRESH-TOKEN')).user.id, 'u1');
        assert.strictEqual((await AuthModel.getAuthorizationCode('SENTINEL-AUTH-CODE')).user.id, 'u1');
        assert.strictEqual(await AuthModel.getClient('client-id', 'SENTINEL-WRONG-SECRET'), null);
        assert.strictEqual((await AuthModel.getClient('client-id', CONF_SECRET)).id, 'client-id');
        assert.strictEqual((await AuthModel.saveToken(token, client, user)).accessToken, 'SENTINEL-ACCESS-TOKEN');
        await AuthModel.saveAuthorizationCode({ authorizationCode: 'SENTINEL-AUTH-CODE', expiresAt: future(), redirectUri: 'https://x' }, client, user);
        assert.strictEqual(await AuthModel.revokeToken({ ...token, client, user }), true);
        assert.strictEqual(await AuthModel.revokeAuthorizationCode({ code: 'SENTINEL-AUTH-CODE', client, user }), true);
    });
    assert.ok(captured.some((l) => l.includes('u1')), 'ユーザーIDは出力される');
});

// --- redactForLog ---

test('redactForLog: 機微なキーを大文字小文字を問わず再帰的に伏せ、入力を変更しない', () => {
    const input = {
        Client_Secret: 's', code: 'c', refresh_token: 'r', ACCESS_TOKEN: 'a', token: 't',
        password: 'p', Authorization: 'Bearer x', id_token: 'i',
        grant_type: 'authorization_code', client_id: 'client-id',
        nested: { refresh_token: 'r2', keep: 1, list: [{ code: 'c2', ok: true }, 'str', 3] },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = redactForLog(input);
    assert.deepStrictEqual(out, {
        Client_Secret: '[REDACTED]', code: '[REDACTED]', refresh_token: '[REDACTED]', ACCESS_TOKEN: '[REDACTED]',
        token: '[REDACTED]', password: '[REDACTED]', Authorization: '[REDACTED]', id_token: '[REDACTED]',
        grant_type: 'authorization_code', client_id: 'client-id',
        nested: { refresh_token: '[REDACTED]', keep: 1, list: [{ code: '[REDACTED]', ok: true }, 'str', 3] },
    });
    assert.deepStrictEqual(input, snapshot);
});

test('redactForLog: オブジェクト以外はそのまま返す', () => {
    for (const v of [undefined, null, 'str', 42, true]) {
        assert.strictEqual(redactForLog(v), v);
    }
    assert.deepStrictEqual(redactForLog([{ token: 'x' }]), [{ token: '[REDACTED]' }]);
});

// --- app.js / oauth2.js のリクエストログ ---

const fakeRes = () => {
    const r = { statusCode: null, headers: {}, body: undefined };
    r.status = (c) => { r.statusCode = c; return r; };
    r.set = (h) => { Object.assign(r.headers, h); return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.render = (v, o) => { r.body = { view: v, o }; return r; };
    return r;
};

test("app.root: 'Auth OK' はユーザーIDのみでアクセストークンを出さない", async () => {
    AuthStore.getAccessToken = async () => ({ access_token: 'SENTINEL-ACCESS-TOKEN', expires_at: future(), client_id: 'client-id', user_id: 'user-42' });
    const req = {
        method: 'POST',
        headers: { authorization: 'Bearer SENTINEL-ACCESS-TOKEN', 'content-type': 'application/json' },
        query: {},
        body: { inputs: [] },
    };
    const res = fakeRes();
    await noLeak(() => app.root(req, res));
    assert.strictEqual(res.statusCode, 400);
    assert.ok(captured.some((l) => l.includes('Auth OK') && l.includes('user-42')), captured.join('\n'));
});

test('app.requestsync / reportstate: query/body のアクセストークンを伏せる', async () => {
    for (const handler of [app.requestsync, app.reportstate]) {
        const req = {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            query: { access_token: 'SENTINEL-ACCESS-TOKEN' },
            body: { access_token: 'SENTINEL-ACCESS-TOKEN' },
        };
        // 認証は失敗させる (トークン未登録) — ログ出力のみ確認
        AuthStore.getAccessToken = async () => null;
        await noLeak(() => handler(req, fakeRes()));
    }
});

test('oauth2.token / auth: query/body の secret・コード・トークンを伏せる', async () => {
    const { token, auth } = require('../oauth2');
    const body = {
        grant_type: 'refresh_token', client_id: 'client-id', client_secret: 'SENTINEL-WRONG-SECRET',
        code: 'SENTINEL-AUTH-CODE', refresh_token: 'SENTINEL-REFRESH-TOKEN',
    };
    AuthStore.getRefreshToken = async () => null;
    await noLeak(() => token({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, query: { ...body }, body: { ...body } }, fakeRes()));
    await noLeak(() => auth({ method: 'GET', headers: {}, query: { ...body }, body: { ...body } }, fakeRes()));
});
