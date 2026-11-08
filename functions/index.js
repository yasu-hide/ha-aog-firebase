'use strict';

const functions = require('firebase-functions/v1');
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { OAUTH_CLIENT_SECRET } = require('./params');

if (getApps().length === 0) {
    initializeApp();
}

const server = require('./server');

exports.authAction = functions.auth.user().onCreate((userRecord, _context) => {
    const uid = userRecord.uid;
    const email = userRecord.email;
    console.log('user added:', uid);
    return getFirestore().collection('users').doc(uid).set({
        id: uid,
        name: email,
        createdAt: (new Date()).toJSON()
    });
});

exports.delAccount = functions.auth.user().onDelete((userRecord, _context) => {
    const uid = userRecord.uid;
    return getFirestore().collection('users').doc(uid).delete();
});

function wrapCloudFunctionHandler(handler) {
    return (req, res) => {
        if (!req.url || !req.path) req.url = '/' + (req.url || '');
        delete req.headers['x-forwarded-proto'];
        handler(req, res);
    };
}

exports.ha = functions.runWith({ secrets: [OAUTH_CLIENT_SECRET] }).https.onRequest(wrapCloudFunctionHandler(server));
