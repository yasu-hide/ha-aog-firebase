'use strict';
const functions = require('firebase-functions');
const admin = require("firebase-admin");
const app_clientId = functions.config().app.id;
const app_clientSecret = functions.config().app.key;
const app_projectId = functions.config().firebase.projectId;
const app_redirectUris = [
    'https://oauth-redirect.googleusercontent.com/r/' + app_projectId,
    'https://' + app_projectId + '.firebaseapp.com/__/auth/handler'
];
const app_grants = [ 'authorization_code', 'refresh_token' ];

const setToDatabase = (keytype, key, value={}) => {
    console.log('%s/%s set to database', keytype, key, JSON.stringify(value));
    return new Promise((resolve, reject) => {
        if(!keytype) {
            console.error('KeyType required');
            reject('KeyType required');
            return;
        }
        if(!key) {
            console.error('Key required');
            reject('Key required');
            return;
        }
        admin.database().ref(keytype + '/' + key).set(value).catch((error) => {
            console.error(error);
            reject(error);
            return;
        });
        resolve(value);
    }).catch(console.error);
};
const getFromDatabase = (keytype, key) => {
    console.log('%s/%s get from database', keytype, key);
    return new Promise((resolve, reject) => {
        if(!keytype) {
            console.error('KeyType required');
            reject('KeyType required');
            return;
        }
        if(!key) {
            console.error('Key required');
            reject('Key required');
            return;
        }
        resolve(admin.database().ref(keytype + '/' + key).once('value').then((snapshot) => {
            return snapshot.val();
        }).catch(console.error));
    }).catch(console.error);
};

exports.getAccessToken = (key) => {
    return getFromDatabase('accesstoken', key);
};
exports.getClient = (client_id, client_secret) => {
    return new Promise((resolve, reject) => {
        if(client_id !== app_clientId) {
            console.error('mismatch client id', client_id, app_clientId);
            reject('mismatch client id');
            return;
        }
        if(client_secret && client_secret !== app_clientSecret) {
            console.error('mismatch client secret', client_secret, app_clientSecret);
            reject('mismatch client secret');
            return;
        }
        resolve({
            id: app_clientId,
            redirect_uris: app_redirectUris,
            grants: app_grants
        });
    }).catch(console.error);
};
exports.getRefreshToken = (key) => {
    return getFromDatabase('refreshtoken', key);
};
exports.getAuthorizationCode = (key) => {
    return getFromDatabase('authcode', key);
};
exports.setAccessTokens = (key, value={}) => {
    return setToDatabase('accesstoken', key, value);
};
exports.setRefreshToken = (key, value={}) => {
    return setToDatabase('refreshtoken', key, value);
};
exports.setAuthCode = (key, value={}) => {
    return setToDatabase('authcode', key, value);
};
exports.unsetRefreshToken = (key) => {
    return setToDatabase('refreshtoken', key, null);
};
exports.unsetAuthCode = (key) => {
    return setToDatabase('authcode', key, null);
};
