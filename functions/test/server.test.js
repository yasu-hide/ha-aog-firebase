'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { stripVTControlCharacters } = require('node:util');

const savedConfig = process.env.FIREBASE_CONFIG;
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});
const savedConsole = { log: console.log, info: console.info, error: console.error, warn: console.warn };
console.log = console.info = console.error = console.warn = () => {};
const server = require('../server.js');
Object.assign(console, savedConsole);
if (savedConfig === undefined) delete process.env.FIREBASE_CONFIG;
else process.env.FIREBASE_CONFIG = savedConfig;

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

// 実リクエストを送りステータスのみ返す(morgan 等のログは握りつぶす)
async function request(method, path, ip, token) {
    const saved = { log: console.log, info: console.info, error: console.error, warn: console.warn };
    console.log = console.info = console.error = console.warn = () => {};
    // morgan は process.stdout へ直接書くので、アクセスログ行 (色コードを除いた 'POST /path 200 1.2 ms - 25') だけ捨てる
    const origWrite = process.stdout.write;
    process.stdout.write = function (chunk, ...rest) {
        const line = stripVTControlCharacters(String(chunk));
        if (/^(GET|POST) \S+ \d{3} [\d.]+ ms - (\d+|-)\s*$/.test(line)) return true;
        return origWrite.call(this, chunk, ...rest);
    };
    const headers = method === 'GET' ? { 'x-forwarded-for': ip } : { 'x-forwarded-for': ip, 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
        return await new Promise((resolve, reject) => {
            const req = http.request(
                { host: '127.0.0.1', port, method, path, headers },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode));
                }
            );
            req.on('error', reject);
            req.end(method === 'GET' ? undefined : '{}');
        });
    } finally {
        Object.assign(console, saved);
        process.stdout.write = origWrite;
    }
}

async function hit(method, path, ip, n, token) {
    const codes = [];
    for (let i = 0; i < n; i++) codes.push(await request(method, path, ip, token));
    return codes;
}

// '/', '/request-sync', '/report-state' は Bearer トークン単位で制限する
// (Google の共有IPから来るため IP 単位では制限しない)
test("'/' は同一トークンで1200回目まで許可し、1201回目で 429。別トークンは影響を受けない", async () => {
    const codes = await hit('POST', '/', '66.249.84.1', 1201, 'tokA');
    assert.ok(!codes.slice(0, 1200).includes(429));
    assert.strictEqual(codes[1200], 429);
    assert.notStrictEqual(await request('POST', '/', '66.249.84.1', 'tokB'), 429);
});

test("共有IPから異なるトークンで700回ずつ送っても 429 にならない", async () => {
    const ip = '66.249.84.2';
    const a = await hit('POST', '/', ip, 700, 'tokA2');
    const b = await hit('POST', '/', ip, 700, 'tokB2');
    assert.ok(!a.includes(429));
    assert.ok(!b.includes(429));
});

test("トークンなしは100回目まで許可し、101回目で 429。別IPは影響を受けない", async () => {
    const codes = await hit('POST', '/', '203.0.113.20', 101);
    assert.ok(!codes.slice(0, 100).includes(429));
    assert.strictEqual(codes[100], 429);
    assert.notStrictEqual(await request('POST', '/', '203.0.113.21'), 429);
});

test("'/', '/request-sync', '/report-state' は同一トークンでバケットを共有する", async () => {
    const paths = ['/', '/request-sync', '/report-state'];
    // 無効なトークンはハンドラ手前の認証で 401 になる (制限に達するまでは 429 ではない)
    for (let i = 0; i < 1200; i++) {
        assert.strictEqual(await request('POST', paths[i % 3], '66.249.84.3', 'tokShared'), 401);
    }
    for (const p of paths) {
        assert.strictEqual(await request('POST', p, '66.249.84.3', 'tokShared'), 429, p);
    }
});

test("'/auth' は100回目まで許可し、101回目で 429", async () => {
    const codes = await hit('GET', '/auth', '203.0.113.10', 101);
    assert.ok(!codes.slice(0, 100).includes(429));
    assert.strictEqual(codes[100], 429);
});

test("'/token' は105回目でも 429 にならない", async () => {
    const codes = await hit('POST', '/token', '66.249.84.3', 105);
    assert.ok(!codes.includes(429));
});

// morgan のアクセスログにクエリ文字列 (access_token など) を出さない
test('morgan: アクセスログのパスにクエリ文字列を含めない', async () => {
    const lines = [];
    const origWrite = process.stdout.write;
    const saved = { log: console.log, info: console.info, error: console.error, warn: console.warn };
    console.log = console.info = console.error = console.warn = () => {};
    process.stdout.write = function (chunk, ...rest) {
        if (/(GET|POST) \//.test(String(chunk))) { lines.push(String(chunk)); return true; }
        return origWrite.call(this, chunk, ...rest);
    };
    try {
        await new Promise((resolve, reject) => {
            http.get({ host: '127.0.0.1', port, path: '/auth?access_token=SECRET-QS&x=1', headers: { 'x-forwarded-for': '198.51.100.7' } },
                (res) => { res.resume(); res.on('end', resolve); }).on('error', reject);
        });
        await new Promise((r) => setTimeout(r, 50));
    } finally {
        process.stdout.write = origWrite;
        Object.assign(console, saved);
    }
    const out = lines.join('');
    assert.ok(out.includes('GET /auth'), out);
    assert.ok(!out.includes('SECRET-QS') && !out.includes('?'), out);
});
