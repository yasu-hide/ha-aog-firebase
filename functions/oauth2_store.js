'use strict';
const crypto = require('node:crypto');
const { getDatabase } = require('firebase-admin/database');
const { OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET } = require('./params');

const app_clientId = () => OAUTH_CLIENT_ID.value();
const app_clientSecret = () => OAUTH_CLIENT_SECRET.value();
const app_projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
const app_redirectUris = [
    'https://oauth-redirect.googleusercontent.com/r/' + app_projectId,
    'https://' + app_projectId + '.firebaseapp.com/__/auth/handler'
];
const app_grants = ['authorization_code', 'refresh_token'];

// トークン・認可コードは @node-oauth/oauth2-server が生成する hex 文字列 (現行 64 文字、3.1.1 時代の保存分は 40 文字)。
// . # $ [ ] / などで RTDB のパスを壊したり、パス入りのエラー文言が出たりしないよう、RTDB に渡す前に検証する。
const KEY_RE = /^[0-9a-f]{1,128}$/i;

// RTDB のエラーはメッセージにパス (= key) を含み得るため、code / name のみ出力する。
const logDbError = (error) => {
    console.error('database error:', error?.code ?? error?.name);
};

const setToDatabase = async (keytype, key, value = {}) => {
    // key はトークン・認可コードそのもの、value もそれらを含むため、keytype のみ出力する。
    console.log('%s set to database', keytype);
    if (!keytype) {
        throw new Error('KeyType required');
    }
    if (!key) {
        throw new Error('Key required');
    }
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
        throw new Error('Invalid key');
    }
    try {
        await getDatabase().ref(`${keytype}/${key}`).set(value);
        return value;
    } catch (error) {
        logDbError(error);
        throw error;
    }
};

const getFromDatabase = async (keytype, key) => {
    console.log('%s get from database', keytype);
    if (!keytype) {
        throw new Error('KeyType required');
    }
    if (!key) {
        throw new Error('Key required');
    }
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
        return null;
    }
    try {
        const snapshot = await getDatabase().ref(`${keytype}/${key}`).once('value');
        return snapshot.val();
    } catch (error) {
        logDbError(error);
        throw error;
    }
};

exports.getAccessToken = (key) => {
    return getFromDatabase('accesstoken', key);
};

// 長さの違いも含めて比較時間から推測されないよう、SHA-256 ダイジェスト同士を定数時間で比較する。
const safeEqual = (a, b) => {
    const da = crypto.createHash('sha256').update(String(a)).digest();
    const db = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(da, db);
};

exports.getClient = async (client_id, client_secret) => {
    const clientId = app_clientId();
    if (client_id !== clientId) {
        console.error('mismatch client id');
        return null;
    }
    const clientSecret = app_clientSecret();
    // client_secret なしで client を返すのは authorize (/auth) 用。/token は secret 必須だが、
    // ライブラリ側の判定に依存しないよう oauth2.js の token で code_verifier を拒否している。
    // 配列・オブジェクト (extended urlencoded) を String() で一致させないよう、文字列のみ比較する。
    if (client_secret && (typeof client_secret !== 'string' || !safeEqual(client_secret, clientSecret))) {
        console.error('mismatch client secret');
        return null;
    }
    return {
        id: clientId,
        redirect_uris: app_redirectUris,
        grants: app_grants
    };
};

exports.getRefreshToken = (key) => {
    return getFromDatabase('refreshtoken', key);
};

exports.getAuthorizationCode = (key) => {
    return getFromDatabase('authcode', key);
};

exports.setAccessTokens = (key, value = {}) => {
    return setToDatabase('accesstoken', key, value);
};

exports.setRefreshToken = (key, value = {}) => {
    return setToDatabase('refreshtoken', key, value);
};

exports.setAuthCode = (key, value = {}) => {
    return setToDatabase('authcode', key, value);
};

exports.unsetRefreshToken = (key) => {
    return setToDatabase('refreshtoken', key, null);
};

exports.unsetAuthCode = (key) => {
    return setToDatabase('authcode', key, null);
};
