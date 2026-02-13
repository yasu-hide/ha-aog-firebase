'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const ejs = require('ejs');

const app = require('./app');
const oauth = require('./oauth2');

const server = express();

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
server.all('/token', oauth.token);
server.all('/auth', oauth.auth);

module.exports = server;
