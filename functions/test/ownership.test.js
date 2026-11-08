'use strict';

const test = require('node:test');
const assert = require('node:assert');

// グループの絞り込み (getGroupDevicesByUserId) と、execute/query のデバイス所有者チェックを検証する。
// models.js は getFirestore / getDatabase を require 時に分割代入で取り込むため、
// require より前に firebase-admin のエクスポートをメモリ上の偽 Firestore / RTDB に差し替える。

// --- 偽 Firestore: 'collection/docId' をキーにしたドキュメントの Map ---
const docs = new Map();
const gets = [];       // doc().get() / query.get() の呼び出し記録
const fieldName = (field) => (typeof field === 'string' ? field : field.segments.join('.'));
const matches = (data, { field, op, value }) => {
    const name = fieldName(field);
    const has = Object.prototype.hasOwnProperty.call(data, name);
    if (op === '==') return has && data[name] === value;
    // Firestore の '!=' は項目が存在しないドキュメントを含まない
    if (op === '!=') return has && data[name] !== value;
    throw new Error(`unsupported op ${op}`);
};
const docSnap = (id, data) => ({ id, exists: data !== undefined, data: () => (data === undefined ? undefined : { ...data }) });
const makeQuery = (col, filters) => ({
    doc: (id) => {
        if (typeof id !== 'string' || id === '' || id.includes('/')) throw new Error('invalid document id');
        const path = `${col}/${id}`;
        return { get: async () => { gets.push(path); return docSnap(id, docs.get(path)); } };
    },
    where: (field, op, value) => makeQuery(col, [...filters, { field, op, value }]),
    // select() は射影のみ。絞り込みはしない (実 Firestore と同じ)
    select: () => makeQuery(col, filters),
    get: async () => {
        gets.push(`${col}?query`);
        const result = [];
        for (const [path, data] of docs) {
            const [c, id] = path.split('/');
            if (c === col && filters.every((f) => matches(data, f))) result.push(docSnap(id, data));
        }
        return { docs: result, forEach: (fn) => result.forEach(fn) };
    },
});
require('firebase-admin/firestore').getFirestore = () => ({ collection: (col) => makeQuery(col, []) });

// --- 偽 RTDB: set() / once() の呼び出しを記録する ---
const rtdb = { sets: [], reads: [] };
require('firebase-admin/database').getDatabase = () => ({
    ref: (path) => ({
        set: async (value) => { rtdb.sets.push({ path, value }); },
        once: async () => { rtdb.reads.push(path); return { val: () => ({ on: true, path }) }; },
    }),
});

// app.js (params 経由) が参照する環境変数
process.env.FIREBASE_CONFIG = JSON.stringify({
    projectId: 'p',
    databaseURL: 'https://p-default-rtdb.firebaseio.com'
});
process.env.OAUTH_CLIENT_ID = 'client-id';
process.env.OAUTH_CLIENT_SECRET = 'client-secret';
process.env.HOMEGRAPH_API_KEY = 'api-key';

const Model = require('../models');
const intents = require('../intents');
const AuthStore = require('../oauth2_store');
const app = require('../app');

const savedLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = savedLog; } };

const fakeRes = () => {
    const r = { statusCode: null, body: undefined };
    r.status = (c) => { r.statusCode = c; return r; };
    r.set = () => r;
    r.json = (b) => { r.body = b; return r; };
    return r;
};

// ユーザー A, B / グループ gA (A のみ), gB (B のみ), gNone (メンバー項目なし)
const seed = () => {
    docs.clear();
    gets.length = 0;
    rtdb.sets.length = 0;
    rtdb.reads.length = 0;
    const put = (path, data) => docs.set(path, data);
    put('users/userA', {});
    put('users/userB', {});
    put('devices/dev1', { type: 'action.devices.types.LIGHT', name: 'Light' });
    put('groups/gA', { userA: { ref: 'users/userA' } });
    put('groups/gB', { userB: { ref: 'users/userB' } });
    put('groups/gNone', {});
    put('groups/gNull', { userA: null });
    put('user_devices/udA', { userId: 'userA', deviceId: 'dev1', remoteId: 'r1', name: 'A light' });
    put('user_devices/udB', { userId: 'userB', deviceId: 'dev1', remoteId: 'r1', name: 'B light' });
    put('group_devices/gdA', { groupId: 'gA', deviceId: 'dev1', remoteId: 'r1', name: 'gA light' });
    put('group_devices/gdB', { groupId: 'gB', deviceId: 'dev1', remoteId: 'r1', name: 'gB light' });
    put('group_devices/gdNone', { groupId: 'gNone', deviceId: 'dev1', remoteId: 'r1' });
    put('group_devices/gdNull', { groupId: 'gNull', deviceId: 'dev1', remoteId: 'r1' });
    put('group_devices/gdMissing', { groupId: 'gMissing', deviceId: 'dev1', remoteId: 'r1' });
};
test.beforeEach(seed);

test('getGroupDevicesByUserId: ユーザーがメンバー項目を持つグループのみ返す', async () => {
    const idsOf = (res) => res.flat().map((d) => d.id).sort();
    assert.deepStrictEqual(idsOf(await Model.getGroupDevicesByUserId('userA')), ['gdA']);
    assert.deepStrictEqual(idsOf(await Model.getGroupDevicesByUserId('userB')), ['gdB']);
    assert.deepStrictEqual(idsOf(await Model.getGroupDevicesByUserId('nobody')), []);
});

test('sync: ユーザー A の SYNC に B のデバイス・グループデバイスが含まれない', async () => {
    const res = fakeRes();
    await quiet(() => intents.sync({ body: { requestId: 'r1' } }, res, { uid: 'userA' }));
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.requestId, 'r1');
    assert.strictEqual(res.body.payload.agentUserId, 'userA');
    assert.deepStrictEqual(res.body.payload.devices.map((d) => d.id).sort(), ['gdA', 'udA']);
});

test('sync: グループと user_devices で同一 id のデバイスは 1 件だけ返る (後勝ち)', async () => {
    docs.set('group_devices/dup', { groupId: 'gA', deviceId: 'dev1', name: 'group side' });
    docs.set('user_devices/dup', { userId: 'userA', deviceId: 'dev1', name: 'user side' });
    const res = fakeRes();
    await quiet(() => intents.sync({ body: { requestId: 'r1' } }, res, { uid: 'userA' }));
    assert.strictEqual(res.statusCode, 200);
    const dups = res.body.payload.devices.filter((d) => d.id === 'dup');
    assert.strictEqual(dups.length, 1);
    assert.deepStrictEqual(dups[0].name.nicknames, ['user side']);
    assert.strictEqual(res.body.payload.devices.length, 3);
});

test('sync: 参照切れのデバイス (deviceId / deviceReference) があっても 200 で正常分だけ返す', async () => {
    docs.set('user_devices/udGoneId', { userId: 'userA', deviceId: 'devGone', name: 'gone by id' });
    docs.set('user_devices/udGoneRef', {
        userId: 'userA',
        deviceReference: { get: async () => ({ exists: false, data: () => undefined }) },
        name: 'gone by ref'
    });
    const res = fakeRes();
    const warns = [];
    const savedWarn = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
        await quiet(() => intents.sync({ body: { requestId: 'r1' } }, res, { uid: 'userA' }));
    } finally {
        console.warn = savedWarn;
    }
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.payload.devices.map((d) => d.id).sort(), ['gdA', 'udA']);
    assert.ok(warns.some((w) => w.includes('udGoneId')) && warns.some((w) => w.includes('udGoneRef')));
});

test('userOwnsDevice: 自分の user_device / 所属グループの group_device は true', async () => {
    assert.strictEqual(await Model.userOwnsDevice('userA', 'udA'), true);
    assert.strictEqual(await Model.userOwnsDevice('userA', 'gdA'), true);
    assert.strictEqual(await Model.userOwnsDevice('userB', 'gdB'), true);
});

test('userOwnsDevice: 他人の device・非所属グループ・存在しない doc は false', async () => {
    for (const id of ['udB', 'gdB', 'gdNone', 'gdNull', 'gdMissing', 'nope', 'users', 'userA']) {
        assert.strictEqual(await Model.userOwnsDevice('userA', id), false, id);
    }
});

test('userOwnsDevice: 文字列でない・空・パス区切りを含む ID は false で Firestore を読まない', async () => {
    for (const id of [undefined, null, 1, {}, ['udA'], '', 'a/b', 'udA/x', 'x/../udA', '.', '..']) {
        assert.strictEqual(await Model.userOwnsDevice('userA', id), false, String(id));
    }
    for (const uid of [undefined, null, '', 1]) {
        assert.strictEqual(await Model.userOwnsDevice(uid, 'udA'), false, String(uid));
    }
    assert.deepStrictEqual(gets, []);
});

const execReq = (ids) => ({
    body: {
        requestId: 'req-x',
        inputs: [{
            intent: 'action.devices.EXECUTE',
            payload: {
                commands: [{
                    devices: ids.map((id) => ({ id })),
                    execution: [{ command: 'action.devices.commands.OnOff', params: { on: true } }],
                }],
            },
        }],
    },
});

test('execute: 他人の ID は deviceNotFound で RTDB に書き込まず、自分の ID は SUCCESS', async () => {
    const res = fakeRes();
    await quiet(() => intents.execute(execReq(['udA', 'udB', 'gdA', 'gdB', 'x/../udA']), res, { uid: 'userA' }));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, {
        requestId: 'req-x',
        payload: {
            commands: [
                { ids: ['udA'], status: 'SUCCESS' },
                { ids: ['udB'], status: 'ERROR', errorCode: 'deviceNotFound' },
                { ids: ['gdA'], status: 'SUCCESS' },
                { ids: ['gdB'], status: 'ERROR', errorCode: 'deviceNotFound' },
                { ids: ['x/../udA'], status: 'ERROR', errorCode: 'deviceNotFound' },
            ],
        },
    });
    assert.deepStrictEqual(rtdb.sets.map((s) => s.path).sort(), ['commands/gdA', 'commands/udA']);
    assert.deepStrictEqual(rtdb.sets[0].value, [{ command: 'action.devices.commands.OnOff', params: { on: true } }]);
});

test('query: 自分の ID のみ RTDB を読み、他人の ID は deviceNotFound', async () => {
    const res = fakeRes();
    const req = { body: { requestId: 'req-q', inputs: [{ intent: 'action.devices.QUERY', payload: { devices: [{ id: 'udA' }, { id: 'udB' }, { id: 'gdA' }, { id: 'a/b' }] } }] } };
    await quiet(() => intents.query(req, res, { uid: 'userA' }));
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, {
        requestId: 'req-q',
        payload: {
            devices: {
                udA: { on: true, path: 'states/udA' },
                udB: { status: 'ERROR', errorCode: 'deviceNotFound' },
                gdA: { on: true, path: 'states/gdA' },
                'a/b': { status: 'ERROR', errorCode: 'deviceNotFound' },
            },
        },
    });
    assert.deepStrictEqual(rtdb.reads.sort(), ['states/gdA', 'states/udA']);
});

test('execute/query: 同じ ID の所有者チェックはリクエスト内で1回、グループの読み取りもグループごとに1回', async () => {
    const countOf = (path) => gets.filter((p) => p === path).length;
    await quiet(() => intents.execute(execReq(['udB', 'udB']), fakeRes(), { uid: 'userA' }));
    assert.strictEqual(countOf('user_devices/udB'), 1);
    assert.strictEqual(rtdb.sets.length, 0);

    gets.length = 0;
    docs.set('group_devices/gdB2', { groupId: 'gB', deviceId: 'dev1', remoteId: 'r1' });
    const req = { body: { inputs: [{ payload: { devices: [{ id: 'gdB' }, { id: 'gdB' }, { id: 'gdB2' }] } }] } };
    await quiet(() => intents.query(req, fakeRes(), { uid: 'userA' }));
    assert.strictEqual(countOf('group_devices/gdB'), 1);
    assert.strictEqual(countOf('groups/gB'), 1);
    assert.strictEqual(rtdb.reads.length, 0);
});

test('userOwnsDevice: Firestore 予約 ID (__x__) と 1500 バイト超の ID は false で Firestore を読まない', async () => {
    for (const id of ['__name__', '__a__', 'x'.repeat(1501), 'あ'.repeat(501)]) {
        assert.strictEqual(await Model.userOwnsDevice('userA', id), false, id.slice(0, 20));
    }
    assert.deepStrictEqual(gets, []);
    // 境界: ちょうど 1500 バイトは安全な ID として読みに行く
    assert.strictEqual(await Model.userOwnsDevice('userA', 'x'.repeat(1500)), false);
    assert.strictEqual(gets.length, 2);
});

test('execute/query: 所有 ID が "123" でも数値 123・オブジェクト ID は deviceNotFound (書込・RTDB 読取なし)', async () => {
    docs.set('user_devices/123', { userId: 'userA', deviceId: 'dev1', remoteId: 'r1' });
    for (const id of [123, { a: 1 }]) {
        rtdb.sets.length = 0;
        rtdb.reads.length = 0;
        const eres = fakeRes();
        await quiet(() => intents.execute({ body: { requestId: 'r', inputs: [{ payload: { commands: [{ devices: [{ id }], execution: [{ command: 'c', params: {} }] }] } }] } }, eres, { uid: 'userA' }));
        assert.deepStrictEqual(eres.body.payload.commands, [{ ids: [String(id)], status: 'ERROR', errorCode: 'deviceNotFound' }]);
        const qres = fakeRes();
        await quiet(() => intents.query({ body: { requestId: 'r', inputs: [{ payload: { devices: [{ id }] } }] } }, qres, { uid: 'userA' }));
        assert.deepStrictEqual(qres.body.payload.devices, { [String(id)]: { status: 'ERROR', errorCode: 'deviceNotFound' } });
        assert.deepStrictEqual(rtdb.sets, []);
        assert.deepStrictEqual(rtdb.reads, []);
    }
});

test('execute/query: inputs が [null] の不正ボディでも intents 内で TypeError を投げず制御されたエラーを返す', async () => {
    for (const fn of [intents.execute, intents.query]) {
        const res = fakeRes();
        const origErr = console.error;
        console.error = () => {};
        try {
            await quiet(() => fn({ body: { inputs: [null] } }, res, { uid: 'userA' }));
        } finally { console.error = origErr; }
        assert.ok(res.statusCode >= 400, `status ${res.statusCode}`);
    }
});

// --- reportstate: 所有していない device ID を Home Graph へ転送しない ---

const originalStore = { ...AuthStore };
const originalFetch = global.fetch;
let fetchBodies = [];
test.beforeEach(() => {
    fetchBodies = [];
    AuthStore.getAccessToken = async () => ({ access_token: 'tok', expires_at: new Date(Date.now() + 3600 * 1000).toJSON(), client_id: 'client-id', user_id: 'userA' });
    global.fetch = async (url, options) => {
        fetchBodies.push(JSON.parse(options.body));
        return { status: 200, statusText: 'OK' };
    };
});
test.afterEach(() => {
    Object.assign(AuthStore, originalStore);
    global.fetch = originalFetch;
});

const reportReq = (devices) => ({
    method: 'POST',
    headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
    query: {},
    body: { devices },
});
const runReport = async (devices) => {
    const res = fakeRes();
    const origErr = console.error;
    console.error = () => {};
    try { await quiet(() => app.reportstate(reportReq(devices), res)); } finally { console.error = origErr; }
    return res;
};

test('reportstate: 所有している ID のみなら全て転送する', async () => {
    const devices = { states: { udA: { on: true }, gdA: { on: true } }, notifications: { udA: { n: 1 } } };
    const res = await runReport(devices);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(fetchBodies.length, 1);
    assert.deepStrictEqual(fetchBodies[0].devices, devices);
    assert.strictEqual(fetchBodies[0].agentUserId, 'userA');
});

test('reportstate: states の他人の ID は除外して所有分だけ転送する', async () => {
    const res = await runReport({ states: { udA: { on: true }, udB: { on: false } } });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(fetchBodies.length, 1);
    assert.deepStrictEqual(Object.keys(fetchBodies[0].devices.states), ['udA']);
});

test('reportstate: notifications の他人の ID も除外する', async () => {
    const res = await runReport({ states: { udA: { on: true } }, notifications: { udA: { n: 1 }, gdB: { n: 2 } } });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(fetchBodies.length, 1);
    assert.deepStrictEqual(Object.keys(fetchBodies[0].devices.notifications), ['udA']);
    assert.deepStrictEqual(Object.keys(fetchBodies[0].devices.states), ['udA']);
});

test('reportstate: 全て他人の ID なら fetch せず 200 を返す', async () => {
    const res = await runReport({ states: { udB: { on: true } }, notifications: { gdB: { n: 1 } } });
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, { status: 'OK' });
    assert.strictEqual(fetchBodies.length, 0);
});

test('reportstate: devices がオブジェクトでなければ 400', async () => {
    for (const devices of [[], 'udA', 123, true]) {
        const res = await runReport(devices);
        assert.strictEqual(res.statusCode, 400, JSON.stringify(devices));
    }
    assert.strictEqual(fetchBodies.length, 0);
});
