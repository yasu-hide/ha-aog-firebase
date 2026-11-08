'use strict';

// oauth2-server 3.1.1 の OAuth フロー (/auth, /token, authenticate) を、実 oauth2.js・実 Express の
// HTTP 経由で固定する特性テスト。ライブラリ差し替え (@node-oauth/oauth2-server) 後の差異検出用。
// 「3.1.1 behavior; fork may differ (plan 差異N)」は、フォークでは結果が変わりうることを示す。
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

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

// oauth2_store は getDatabase、oauth2.js は getAuth を require 時に分割代入で取り込むため、
// require より前に firebase-admin のエクスポートを差し替える。
const fakeDb = {};
require('firebase-admin/database').getDatabase = () => ({
    ref: (path) => ({
        set: async (value) => { fakeDb[path] = value; },
        once: async () => ({ val: () => fakeDb[path] ?? null }),
    }),
});
const ID_TOKEN = 'valid-id-token';
require('firebase-admin/auth').getAuth = () => ({
    verifyIdToken: async (token) => {
        if (token !== ID_TOKEN) throw new Error('invalid id token');
        return { sub: 'user-1' };
    },
});

mute();
const server = require('../server');
unmute();

const REDIRECT = 'https://oauth-redirect.googleusercontent.com/r/p';
const dbKeys = (prefix) => Object.keys(fakeDb).filter((k) => k.startsWith(prefix) && fakeDb[k] != null);

test.beforeEach(() => { for (const k of Object.keys(fakeDb)) delete fakeDb[k]; });

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
            res.on('end', () => { clearTimeout(timer); restore(); resolve({ status: res.statusCode, body: data, headers: res.headers }); });
        });
        const timer = setTimeout(() => { req.destroy(); restore(); resolve({ status: 'timeout' }); }, 3000);
        req.on('error', (e) => { clearTimeout(timer); restore(); if (e.code === 'ECONNRESET') return; reject(e); });
        req.end(body);
    });
}

const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
const FORM = 'application/x-www-form-urlencoded';
const tokenRequest = (params, { authorization = basic('client-id', 'client-secret'), contentType = FORM, raw } = {}) => {
    const headers = {};
    if (authorization) headers.authorization = authorization;
    if (contentType) headers['content-type'] = contentType;
    return request('POST', '/token', { headers, body: raw ?? new URLSearchParams(params).toString() });
};

// /auth の Bearer 分岐で認可コードを発行する (response は平文の認可コード)。
const authRequest = ({ query = {}, authorization = 'Bearer ' + ID_TOKEN } = {}) => {
    const q = new URLSearchParams({ client_id: 'client-id', redirect_uri: REDIRECT, state: 's1', ...query });
    return request('POST', '/auth?' + q, {
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ response_type: 'code' })
    });
};
const issueCode = async (query) => {
    const r = await authRequest({ query });
    assert.strictEqual(r.status, 200, r.body);
    return r.body;
};
const exchange = (code, extra = {}) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, ...extra });
const issueTokens = async () => JSON.parse((await exchange(await issueCode())).body);

const near = (iso, ms, tolerance = 60 * 1000) => Math.abs(new Date(iso).getTime() - (Date.now() + ms)) < tolerance;

// --- 1. authorization_code -> token ---

test('authorization_code 交換は 200 で、有効期限が access 約1時間・refresh 約10年のトークンを返す', async () => {
    const code = await issueCode();
    const r = await exchange(code);
    assert.strictEqual(r.status, 200);
    const body = JSON.parse(r.body);
    assert.deepStrictEqual(Object.keys(body).sort(), ['access_token', 'expires_in', 'refresh_token', 'token_type']);
    assert.strictEqual(body.token_type, 'Bearer');
    assert.ok(body.expires_in > 3500 && body.expires_in <= 3600, `expires_in=${body.expires_in}`);
    const access = fakeDb[`accesstoken/${body.access_token}`];
    const refresh = fakeDb[`refreshtoken/${body.refresh_token}`];
    assert.strictEqual(access.client_id, 'client-id');
    assert.strictEqual(access.user_id, 'user-1');
    assert.ok(near(access.expires_at, 3600 * 1000), access.expires_at);
    assert.strictEqual(refresh.user_id, 'user-1');
    assert.ok(near(refresh.expires_at, 86400 * 3650 * 1000, 3600 * 1000), refresh.expires_at);
});

test('認可コードは交換後に DB から消える', async () => {
    const code = await issueCode();
    assert.ok(fakeDb[`authcode/${code}`]);
    assert.strictEqual((await exchange(code)).status, 200);
    assert.strictEqual(fakeDb[`authcode/${code}`], null);
});

// --- 2. refresh_token grant ---

test('refresh_token grant は新しい refresh token を発行し、旧 refresh token は DB から消える (ローテーション)', async () => {
    const first = await issueTokens();
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    assert.strictEqual(r.status, 200);
    const second = JSON.parse(r.body);
    assert.notStrictEqual(second.refresh_token, first.refresh_token);
    assert.notStrictEqual(second.access_token, first.access_token);
    assert.strictEqual(fakeDb[`refreshtoken/${first.refresh_token}`], null);
    assert.ok(fakeDb[`refreshtoken/${second.refresh_token}`]);
    assert.ok(near(fakeDb[`refreshtoken/${second.refresh_token}`].expires_at, 86400 * 3650 * 1000, 3600 * 1000));
    // 旧 refresh token での再試行は拒否される
    const again = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token });
    assert.strictEqual(again.status, 400);
    assert.strictEqual(JSON.parse(again.body).error, 'invalid_grant');
});

// --- 3. /auth Bearer 分岐 ---

test("POST '/auth' (Bearer) は有効な ID トークンなら 200 で認可コードを平文で返す", async () => {
    const r = await authRequest();
    assert.strictEqual(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/html/);
    // fork 5.3.1 behavior (was 3.1.1: 40 桁 hex); 計画の差異一覧に無い差異 (認可コードが 64 桁 hex に)
    assert.match(r.body, /^[0-9a-f]{64}$/);
    assert.strictEqual(fakeDb[`authcode/${r.body}`].user_id, 'user-1');
    assert.strictEqual(fakeDb[`authcode/${r.body}`].redirect_uri, REDIRECT);
});

test("POST '/auth' (Bearer) は state が無いと 401 invalid_request になり、コードを保存しない", async () => {
    const q = new URLSearchParams({ client_id: 'client-id', redirect_uri: REDIRECT });
    const r = await request('POST', '/auth?' + q, {
        headers: { authorization: 'Bearer ' + ID_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ response_type: 'code' })
    });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_request');
    assert.deepStrictEqual(dbKeys('authcode/'), []);
});

test("POST '/auth' (Bearer) は無効な ID トークンなら 401 でコードを保存しない", async () => {
    const r = await authRequest({ authorization: 'Bearer bad' });
    assert.strictEqual(r.status, 401);
    assert.deepStrictEqual(dbKeys('authcode/'), []);
});

// --- 4. 認可コードの単回使用 ---

test('同じ認可コードの2回目の交換は 400 invalid_grant', async () => {
    const code = await issueCode();
    assert.strictEqual((await exchange(code)).status, 200);
    const r = await exchange(code);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_grant');
});

// --- 5. redirect_uri 不一致 ---

test('token リクエストの redirect_uri 不一致は 400 invalid_request で、認可コードは DB から消える', async () => {
    // fork 5.3.1 behavior (was 3.1.1: 検証後に失効するためコードは残る); plan 差異2: 検証前にコードを失効させるため残らない。
    const code = await issueCode();
    const r = await exchange(code, { redirect_uri: 'https://evil.example/cb' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_request');
    assert.strictEqual(fakeDb[`authcode/${code}`], null, 'コードが失効している');
    assert.deepStrictEqual(dbKeys('accesstoken/'), []);
    // コードは失効済みなので、正しい redirect_uri でも交換できない
    const retry = await exchange(code);
    assert.strictEqual(retry.status, 400);
    assert.strictEqual(JSON.parse(retry.body).error, 'invalid_grant');
});

test('token リクエストの redirect_uri 欠落は 400 invalid_request で、認可コードは DB から消える', async () => {
    // fork 5.3.1 behavior (was 3.1.1: コードは残る); plan 差異2
    const code = await issueCode();
    const r = await tokenRequest({ grant_type: 'authorization_code', code });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_request');
    assert.strictEqual(fakeDb[`authcode/${code}`], null, 'コードが失効している');
});

// --- 6. code_verifier のみ (client secret なし) ---

test('code_verifier を含む token リクエストは 400 invalid_request (code_verifier is not supported) で、コードは残る', async () => {
    // fork 5.3.1 behavior (was 3.1.1: 400 invalid_client 'cannot retrieve client credentials'); plan 差異1:
    // フォークは PKCE のとき secret 必須チェックを飛ばすため、oauth2.js の token ガードがライブラリ呼び出し前に拒否する。
    const code = await issueCode({ code_challenge: 'abc', code_challenge_method: 'plain' });
    const r = await tokenRequest(
        { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'client-id', code_verifier: 'abc' },
        { authorization: null }
    );
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_request');
    assert.strictEqual(JSON.parse(r.body).description, 'code_verifier is not supported');
    assert.ok(fakeDb[`authcode/${code}`], 'コードが残っている');
    assert.deepStrictEqual(dbKeys('accesstoken/'), []);
});

// --- 7. /auth の code_challenge ---

test("POST '/auth' は code_challenge / code_challenge_method を受理するが、認可コードと一緒に保存しない", async () => {
    // 3.1.1 behavior; fork may differ (plan 差異1): oauth2.js の saveAuthorizationCode は固定フィールドのみ保存する。
    const code = await issueCode({ code_challenge: 'challenge-xyz', code_challenge_method: 'S256' });
    assert.deepStrictEqual(Object.keys(fakeDb[`authcode/${code}`]).sort(),
        ['authorization_code', 'client_id', 'expires_at', 'redirect_uri', 'user_id']);
    assert.ok(!JSON.stringify(fakeDb[`authcode/${code}`]).includes('challenge-xyz'));
});

// --- 8. パラメータ・ヘッダの変種 ---

test("refresh_token grant の 'scope=' (空) は無視されて 200", async () => {
    // plan 差異5: フォークは素のままだと 400 invalid_scope。oauth2.js の token で scope を取り除き 3.1.1 と同じ挙動にしている。
    const { refresh_token } = await issueTokens();
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token, scope: '' });
    assert.strictEqual(r.status, 200);
});

test('refresh_token grant の非空 scope は無視されて 200', async () => {
    // plan 差異5: 同上 (フォークは素のままだと「元トークンに scope が無い」ため 400 invalid_scope)
    const { refresh_token } = await issueTokens();
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token, scope: 'read' });
    assert.strictEqual(r.status, 200);
});

const authenticated = (authorization) => request('POST', '/', {
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: JSON.stringify({})
});

test('authenticate の Bearer ヘッダ: 小文字・二重空白・末尾空白の変種も 3.1.1 は受理する', async () => {
    // 3.1.1 behavior; fork may differ (plan 差異3): フォークは小文字 bearer・二重空白・末尾空白を拒否する。
    const { access_token } = await issueTokens();
    const results = {};
    for (const [name, header] of Object.entries({
        valid: `Bearer ${access_token}`,
        lowercase: `bearer ${access_token}`,
        doubleSpace: `Bearer  ${access_token}`,
        trailingSpace: `Bearer ${access_token} `,
    })) {
        // 認証を通れば inputs 無しで 400 (missing inputs)、通らなければ 401
        results[name] = (await authenticated(header)).status;
    }
    assert.deepStrictEqual(results, { valid: 400, lowercase: 400, doubleSpace: 400, trailingSpace: 400 });
});

test('非文字列パラメータ (refresh_token[]=x) は 400 invalid_grant で 500 にならない', async () => {
    // 3.1.1 behavior; fork may differ (plan 差異4): フォークは TypeError -> 500 server_error になりうる。
    const r = await tokenRequest(null, { raw: 'grant_type=refresh_token&refresh_token[]=x' });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_grant');
});

test("'/token' の Content-Type が charset 付きでも form として処理される", async () => {
    // 3.1.1 behavior; fork may differ (plan 差異6): フォークは type-is の TypeError で 500 になりうる。
    const { refresh_token } = await issueTokens();
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token }, { contentType: FORM + ';charset=utf-8' });
    assert.strictEqual(r.status, 200);
});

test("'/token' の Content-Type が無いと 400 invalid_request", async () => {
    // 3.1.1 behavior; fork may differ (plan 差異6)
    const { refresh_token } = await issueTokens();
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token }, { contentType: null });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(JSON.parse(r.body).error, 'invalid_request');
});

// --- 9. 3.1.1 時代に保存された既存データ ---
// 保存形式 (refresh_token / access_token / expires_at (ISO 文字列) / client_id / user_id) は移行前後で同じ。
// 3.1.1 が発行した 40 桁 hex のトークンを直接 seed し、フォークで受理・ローテーションされることを確認する。

const LEGACY_REFRESH = 'a'.repeat(40);
const LEGACY_ACCESS = 'b'.repeat(40);
const isoIn = (ms) => new Date(Date.now() + ms).toJSON();

test('3.1.1 時代に保存された refresh token (40桁) で交換でき、新しいトークンにローテーションされる', async () => {
    fakeDb[`refreshtoken/${LEGACY_REFRESH}`] = {
        refresh_token: LEGACY_REFRESH,
        expires_at: isoIn(86400 * 3650 * 1000 - 86400 * 1000),
        client_id: 'client-id',
        user_id: 'user-legacy',
    };
    const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: LEGACY_REFRESH });
    assert.strictEqual(r.status, 200, r.body);
    const body = JSON.parse(r.body);
    assert.notStrictEqual(body.refresh_token, LEGACY_REFRESH);
    assert.strictEqual(fakeDb[`refreshtoken/${LEGACY_REFRESH}`], null);
    assert.strictEqual(fakeDb[`refreshtoken/${body.refresh_token}`].user_id, 'user-legacy');
    assert.strictEqual(fakeDb[`accesstoken/${body.access_token}`].user_id, 'user-legacy');
});

test('3.1.1 時代に保存された access token (40桁) で authenticate を通る', async () => {
    fakeDb[`accesstoken/${LEGACY_ACCESS}`] = {
        access_token: LEGACY_ACCESS,
        expires_at: isoIn(30 * 60 * 1000),
        client_id: 'client-id',
        user_id: 'user-legacy',
    };
    // 認証を通れば inputs 無しで 400 (missing inputs)、通らなければ 401
    assert.strictEqual((await authenticated(`Bearer ${LEGACY_ACCESS}`)).status, 400);
});

test('3.1.1 時代に保存された期限切れ access token は 401', async () => {
    fakeDb[`accesstoken/${LEGACY_ACCESS}`] = {
        access_token: LEGACY_ACCESS,
        expires_at: isoIn(-60 * 1000),
        client_id: 'client-id',
        user_id: 'user-legacy',
    };
    assert.strictEqual((await authenticated(`Bearer ${LEGACY_ACCESS}`)).status, 401);
});
