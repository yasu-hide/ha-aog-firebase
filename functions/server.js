'use strict';

const express = require('express');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const crypto = require('node:crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const app = require('./app');
const oauth = require('./oauth2');

const server = express();

// レート制限のカウンタは Cloud Functions のインスタンスごとのメモリ上にあり、
// インスタンス間で共有されない (ベストエフォートであり、厳密なセキュリティ制御ではない)。
// '/', '/request-sync', '/report-state' は Google の共有IP (全ユーザー分が少数のIPから届く)
// から呼ばれるため IP 単位では制限せず、Bearer トークン単位で制限する (トークンはハッシュ化して使う)。
// 3ルートで1つのバケットを共有する。カウンタはインスタンスごとのメモリ上 (ベストエフォート)。
// 1200回/15分 (トークンあたり約80回/分) は調整可能な既定値 (Google の report-state/QUERY の
// ユーザーあたりの頻度はこれよりはるかに低い)。トークンなしは OAuth で拒否されるため、
// 探索の抑止だけを目的に100回とする。
const API_LIMIT_WITH_TOKEN = 1200;
const API_LIMIT_WITHOUT_TOKEN = 100;
const BEARER_RE = /^Bearer\s+(\S+)$/i;
const bearerToken = (req) => {
    const m = BEARER_RE.exec(req.headers.authorization || '');
    return m ? m[1] : null;
};
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: (req) => (bearerToken(req) ? API_LIMIT_WITH_TOKEN : API_LIMIT_WITHOUT_TOKEN),
    keyGenerator: (req) => {
        const token = bearerToken(req);
        return token
            ? 'token:' + crypto.createHash('sha256').update(token).digest('hex')
            : 'ip:' + ipKeyGenerator(req.ip);
    },
    standardHeaders: 'draft-8', // combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
// '/auth' はブラウザのログイン画面なのでブルートフォース対策として厳しめに制限する。
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: 'draft-8', // combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});
// '/token' は Google のサーバー (多数のユーザーで共有されるIP) から呼ばれるため緩めにする。
// 数値は調整可能な既定値。
const tokenLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 600, // Limit each IP to 600 requests per `window`
    standardHeaders: 'draft-8', // combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// morgan('dev') は req.originalUrl をそのまま出し、クエリ文字列 (access_token 等) が残るため、
// :url を query なしの path に差し替えた dev 形式で出力する。
const logPath = (req) => (req.originalUrl || req.url || '').split('?')[0];
server.use(morgan((tokens, req, res) => morgan.dev({ ...tokens, url: logPath }, req, res)));
server.use(express.json());
server.use(express.urlencoded({ extended: true }));
server.set('trust proxy', 1);
server.use(cookieParser());
server.set("view engine", "ejs");
server.engine("ejs", ejs.__express);

server.all('/', apiLimiter, app.root);
server.all('/request-sync', apiLimiter, app.requestsync);
server.all('/report-state', apiLimiter, app.reportstate);
server.all('/token', tokenLimiter, oauth.token);
server.all('/auth', authLimiter, oauth.auth);

module.exports = server;
