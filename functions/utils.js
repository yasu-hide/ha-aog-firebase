'use strict';

const OAuth2Server = require('oauth2-server');

const valuniq = (obj) => {
    const arrobj = {};
    for (let i = 0; i < obj.length; i++) {
        arrobj[obj[i]['id']] = obj[i];
    }
    const newret = [];
    for (let key in arrobj) {
        newret.push(arrobj[key]);
    }
    return newret;
};

const flatten = (arr) => Array.isArray(arr) ? [].concat.apply([], arr.map(flatten)) : arr;

// クライアントに message を見せてよい OAuth エラーか。
// ServerError (5xx) は内部エラーの message をそのまま持つため除外する。
const isClientOAuthError = (error) => error instanceof OAuth2Server.OAuthError && error.code < 500;

// error は文字列 (固定メッセージ) または Error。詳細はサーバーログにのみ出す。
// 文字列・SyntaxError (入力不正) は 400、OAuthError は error.code (400/401/403) でメッセージを返し、
// それ以外の想定外エラーは 500 で固定文字列 'internal_error' を返す。
const showError = (res, error) => {
    console.error(error);
    let status = 400;
    let message;
    if (typeof error === 'string') {
        message = error;
    } else if (isClientOAuthError(error)) {
        status = error.code;
        message = error.message;
    } else if (error instanceof SyntaxError) {
        message = error.message;
    } else {
        status = 500;
        message = 'internal_error';
    }
    res.status(status).set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }).json({ error: message });
    return;
};

// ログ出力用に、シークレット・トークン類のキーの値を '[REDACTED]' に置き換えたコピーを返す。
// キー名は大文字小文字を区別せず、ネストしたオブジェクト・配列も再帰的に処理する。入力は変更しない。
const SENSITIVE_KEYS = new Set([
    'client_secret', 'code', 'refresh_token', 'access_token', 'token', 'password', 'authorization', 'id_token'
]);
const redactForLog = (value) => {
    if (Array.isArray(value)) {
        return value.map(redactForLog);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const out = {};
    for (const [key, v] of Object.entries(value)) {
        out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : redactForLog(v);
    }
    return out;
};

module.exports = {
    valuniq,
    flatten,
    isClientOAuthError,
    showError,
    redactForLog
};
