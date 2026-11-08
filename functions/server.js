'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');
const rateLimit = require('express-rate-limit');

const app = require('./app');
const oauth = require('./oauth2');

const server = express();

// レート制限のカウンタは Cloud Functions のインスタンスごとのメモリ上にあり、
// インスタンス間で共有されない (ベストエフォートであり、厳密なセキュリティ制御ではない)。
// '/', '/request-sync', '/report-state' は Bearer トークン必須で Google の共有IPから
// 来るため制限しない。
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

server.use(morgan('dev'));
server.use(bodyParser.json());
server.use(bodyParser.urlencoded({ extended: true }));
server.set('trust proxy', 1);
server.use(cookieParser());
server.set("view engine", "ejs");
server.engine("ejs", ejs.__express);

server.all('/', app.root);
server.all('/request-sync', app.requestsync);
server.all('/report-state', app.reportstate);
server.all('/token', tokenLimiter, oauth.token);
server.all('/auth', authLimiter, oauth.auth);

module.exports = server;
