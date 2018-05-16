'use strict';

const functions = require('firebase-functions');
const admin = require("firebase-admin");
admin.initializeApp();

const app = require('./app');
const oauth = require('./oauth2');

const express = require('express')();
const bodyParser = require('body-parser');
express.use(require("morgan")('dev'));
express.use(bodyParser.json());
express.use(bodyParser.urlencoded({extended: true}));
express.set('trust proxy', 1);
express.use(require('cookie-parser')());
express.set("view engine", "ejs");
express.engine("ejs", require("ejs").__express);

express.all('/', app.root);
express.all('/request-sync', app.requestsync);
express.all('/report-state', app.reportstate);
express.all('/token', oauth.token);
express.all('/auth', oauth.auth);

exports.authAction = functions.auth.user().onCreate((userRecord, context) => {
    const uid = userRecord.uid;
    const email = userRecord.email
    console.log('user added:', uid);
    return admin.firestore().collection('users').doc(uid).set({
        id: uid,
        name: email,
        createdAt: (new Date()).toJSON()
    });
});
exports.delAccount = functions.auth.user().onDelete((userRecord, context) => {
    const uid = userRecord.uid;
    return admin.firestore().collection('users').doc(uid).delete();
});

function wrapCloudFunctionHandler(handler) {
    return (req, res) => {
        if(!req.url || !req.path) req.url = '/' + (req.url || '');
        delete req.headers['x-forwarded-proto'];
        handler(req, res);
    };
}

exports.ha = functions.https.onRequest(wrapCloudFunctionHandler(express));
