'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

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
function request(method, path, ip) {
    return new Promise((resolve, reject) => {
        const saved = { log: console.log, info: console.info, error: console.error, warn: console.warn };
        console.log = console.info = console.error = console.warn = () => {};
        // morgan は process.stdout へ直接書くので、アクセスログ行だけ捨てる
        const origWrite = process.stdout.write;
        process.stdout.write = function (chunk, ...rest) {
            if (String(chunk).includes('[0m') && /(GET|POST) /.test(String(chunk))) return true;
            return origWrite.call(this, chunk, ...rest);
        };
        const restore = () => { Object.assign(console, saved); process.stdout.write = origWrite; };
        const req = http.request(
            { host: '127.0.0.1', port, method, path, headers: method === 'GET' ? { 'x-forwarded-for': ip } : { 'x-forwarded-for': ip, 'content-type': 'application/json' } },
            (res) => {
                res.resume();
                res.on('end', () => { restore(); resolve(res.statusCode); });
            }
        );
        req.on('error', (e) => { restore(); reject(e); });
        req.end(method === 'GET' ? undefined : '{}');
    });
}

async function hit(method, path, ip, n) {
    const codes = [];
    for (let i = 0; i < n; i++) codes.push(await request(method, path, ip));
    return codes;
}

test("POST '/' は共有IPから105回送っても 429 にならない", async () => {
    const codes = await hit('POST', '/', '66.249.84.1', 105);
    assert.ok(!codes.includes(429));
});

test("'/request-sync' と '/report-state' は 429 にならない", async () => {
    for (const p of ['/request-sync', '/report-state']) {
        const codes = await hit('POST', p, '66.249.84.2', 105);
        assert.ok(!codes.includes(429), p);
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
