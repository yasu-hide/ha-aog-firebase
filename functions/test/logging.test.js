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
const dbCalls = [];
let dbFailure = null; // 設定すると ref().set/once がこのエラーで失敗する
require('firebase-admin/database').getDatabase = () => ({
    ref: (path) => {
        dbCalls.push(path);
        return {
            set: async (value) => { if (dbFailure) throw dbFailure; fakeDb[path] = value; },
            once: async () => { if (dbFailure) throw dbFailure; return { val: () => fakeDb[path] ?? null }; },
        };
    },
});

capture();
const AuthStore = require('../oauth2_store');
const { AuthModel } = require('../oauth2');
const app = require('../app');
const { redactForLog } = require('../utils');
restore();

const originalStore = { ...AuthStore };
test.afterEach(() => {
    Object.assign(AuthStore, originalStore);
    dbCalls.length = 0;
    dbFailure = null;
});

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

// トークン・認可コードは 32 byte の hex (現行 64 文字、旧 40 文字)
const HEX_ACCESS = 'a1'.repeat(32);
const HEX_REFRESH = 'b2'.repeat(32);
const HEX_CODE = 'c3'.repeat(32);

test('store set/get: トークン・コードの値もキーもログに出さない', async () => {
    await noLeak(async () => {
        await AuthStore.setAccessTokens(HEX_ACCESS, { access_token: HEX_ACCESS, user_id: 'u1' });
        await AuthStore.setRefreshToken(HEX_REFRESH, { refresh_token: HEX_REFRESH });
        await AuthStore.setAuthCode(HEX_CODE, { authorization_code: HEX_CODE });
        const t = await AuthStore.getAccessToken(HEX_ACCESS);
        assert.strictEqual(t.access_token, HEX_ACCESS);
        await AuthStore.getRefreshToken(HEX_REFRESH);
        await AuthStore.getAuthorizationCode(HEX_CODE);
        await AuthStore.unsetRefreshToken(HEX_REFRESH);
        await AuthStore.unsetAuthCode(HEX_CODE);
    });
    const out = captured.join('\n');
    for (const k of [HEX_ACCESS, HEX_REFRESH, HEX_CODE]) assert.ok(!out.includes(k));
    assert.ok(captured.some((l) => l.includes('accesstoken')), 'keytype は出力される');
    assert.strictEqual(fakeDb[`refreshtoken/${HEX_REFRESH}`], null);
});

// RTDB のパスを壊す文字 (. # $ [ ] /) や hex 以外を含む key は RTDB に渡さない
const BAD_KEYS = ['a.b', 'a#b', 'a$b', 'a[b', 'a]b', 'a/b', '../x', 'zz'.repeat(32), 'a1'.repeat(65)];

test('store.get*: 不正な key は RTDB を呼ばず null を返し、key をログに出さない', async () => {
    for (const key of BAD_KEYS) {
        for (const fn of [AuthStore.getAccessToken, AuthStore.getRefreshToken, AuthStore.getAuthorizationCode]) {
            capture();
            let result;
            try { result = await fn(key); } finally { restore(); }
            assert.strictEqual(result, null, key);
            assert.ok(!captured.join('\n').includes(key), key);
        }
    }
    assert.deepStrictEqual(dbCalls, []);
});

test('store.set*: 不正な key は RTDB を呼ばず、key を含まない Error を投げる', async () => {
    for (const key of BAD_KEYS) {
        for (const fn of [AuthStore.setAccessTokens, AuthStore.setRefreshToken, AuthStore.setAuthCode, AuthStore.unsetRefreshToken, AuthStore.unsetAuthCode]) {
            capture();
            let err;
            try { await fn(key, { a: 1 }); } catch (e) { err = e; } finally { restore(); }
            assert.ok(err instanceof Error, key);
            assert.ok(!err.message.includes(key), err.message);
            assert.ok(!captured.join('\n').includes(key), key);
        }
    }
    assert.deepStrictEqual(dbCalls, []);
});

test('store: RTDB のエラーは code / name のみログに出し、message (パス入り) は出さない', async () => {
    dbFailure = Object.assign(new Error(`Reference.child failed: path ${HEX_ACCESS} SENTINEL-DB-PATH`), { code: 'PERMISSION_DENIED' });
    for (const fn of [() => AuthStore.getAccessToken(HEX_ACCESS), () => AuthStore.setAccessTokens(HEX_ACCESS, { a: 1 })]) {
        capture();
        try { await assert.rejects(fn); } finally { restore(); }
        const out = captured.join('\n');
        assert.ok(!out.includes('SENTINEL-DB-PATH') && !out.includes(HEX_ACCESS), out);
        assert.ok(out.includes('PERMISSION_DENIED'), out);
    }
});

test('AuthModel: store のエラーは code / name のみログに出し、message は出さない', async () => {
    dbFailure = Object.assign(new Error('SENTINEL-DB-PATH message'), { code: 'PERMISSION_DENIED' });
    const client = { id: 'client-id' };
    const user = { id: 'u1' };
    const token = { accessToken: HEX_ACCESS, accessTokenExpiresAt: future(), refreshToken: HEX_REFRESH, refreshTokenExpiresAt: future() };
    const calls = [
        () => AuthModel.getAccessToken(HEX_ACCESS),
        () => AuthModel.getRefreshToken(HEX_REFRESH),
        () => AuthModel.getAuthorizationCode(HEX_CODE),
        () => AuthModel.saveToken(token, client, user),
        () => AuthModel.saveAuthorizationCode({ authorizationCode: HEX_CODE, expiresAt: future(), redirectUri: 'https://x' }, client, user),
        () => AuthModel.revokeToken({ ...token, client, user }),
        () => AuthModel.revokeAuthorizationCode({ code: HEX_CODE, client, user }),
    ];
    for (const call of calls) {
        capture();
        try { await assert.rejects(call); } finally { restore(); }
        const out = captured.join('\n');
        assert.ok(!out.includes('SENTINEL-DB-PATH'), out);
        assert.ok(out.includes('PERMISSION_DENIED'), out);
    }
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

const toPlain = (v) => JSON.parse(JSON.stringify(v));

test('redactForLog: 機微なキーを大文字小文字を問わず再帰的に伏せ、入力を変更しない', () => {
    const input = {
        Client_Secret: 's', code: 'c', refresh_token: 'r', ACCESS_TOKEN: 'a', token: 't',
        password: 'p', Authorization: 'Bearer x', id_token: 'i',
        grant_type: 'authorization_code', client_id: 'client-id',
        nested: { refresh_token: 'r2', keep: 1, list: [{ code: 'c2', ok: true }, 'str', 3] },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = redactForLog(input);
    // redactForLog の戻り値は null プロトタイプなので、deepStrictEqual 用に通常のオブジェクトへ変換する。
    assert.deepStrictEqual(toPlain(out), {
        Client_Secret: '[REDACTED]', code: '[REDACTED]', refresh_token: '[REDACTED]', ACCESS_TOKEN: '[REDACTED]',
        token: '[REDACTED]', password: '[REDACTED]', Authorization: '[REDACTED]', id_token: '[REDACTED]',
        grant_type: 'authorization_code', client_id: 'client-id',
        nested: { refresh_token: '[REDACTED]', keep: 1, list: [{ code: '[REDACTED]', ok: true }, 'str', 3] },
    });
    assert.deepStrictEqual(input, snapshot);
});

test('redactForLog: camelCase / kebab-case のキーも伏せる', () => {
    const out = redactForLog({
        clientSecret: 's', refreshToken: 'r', idToken: 'i', accessToken: 'a', 'client-secret': 'c', Access_Token: 'x', keep: 1,
    });
    assert.deepStrictEqual({ ...out }, {
        clientSecret: '[REDACTED]', refreshToken: '[REDACTED]', idToken: '[REDACTED]', accessToken: '[REDACTED]',
        'client-secret': '[REDACTED]', Access_Token: '[REDACTED]', keep: 1,
    });
});

test('redactForLog: JSON 由来の own __proto__ キーも保持する', () => {
    const input = JSON.parse('{"__proto__": {"code": "c", "keep": 1}, "a": 1}');
    const out = redactForLog(input);
    assert.ok(Object.hasOwn(out, '__proto__'));
    assert.deepStrictEqual({ ...out['__proto__'] }, { code: '[REDACTED]', keep: 1 });
    assert.ok(JSON.stringify(out).includes('__proto__'));
});

test('redactForLog: オブジェクト以外はそのまま返す', () => {
    for (const v of [undefined, null, 'str', 42, true]) {
        assert.strictEqual(redactForLog(v), v);
    }
    assert.deepStrictEqual(toPlain(redactForLog([{ token: 'x' }])), [{ token: '[REDACTED]' }]);
});

test('store.getClient: 配列・オブジェクトの secret (extended urlencoded) は一致しても null', async () => {
    for (const s of [[CONF_SECRET], { a: CONF_SECRET }, 123, true]) {
        assert.strictEqual(await AuthStore.getClient('client-id', s), null, JSON.stringify(s));
    }
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
        body: { inputs: [], refresh_token: 'SENTINEL-REFRESH-TOKEN' },
    };
    const res = fakeRes();
    await noLeak(() => app.root(req, res));
    assert.strictEqual(res.statusCode, 400);
    assert.ok(captured.some((l) => l.includes('Auth OK') && l.includes('user-42')), captured.join('\n'));
    assert.ok(captured.some((l) => l.includes('[REDACTED]')), captured.join('\n'));
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
        assert.ok(captured.some((l) => l.includes('[REDACTED]')), captured.join('\n'));
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
    assert.ok(captured.some((l) => l.includes('[REDACTED]')), captured.join('\n'));
    await noLeak(() => auth({ method: 'GET', headers: {}, query: { ...body }, body: { ...body } }, fakeRes()));
    assert.ok(captured.some((l) => l.includes('[REDACTED]')), captured.join('\n'));
});
