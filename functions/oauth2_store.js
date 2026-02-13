'use strict';
const functions = require('firebase-functions/v1');
const admin = require("firebase-admin");

const app_clientId = functions.config().app.id;
const app_clientSecret = functions.config().app.key;
const app_projectId = JSON.parse(process.env.FIREBASE_CONFIG).projectId;
const app_redirectUris = [
    'https://oauth-redirect.googleusercontent.com/r/' + app_projectId,
    'https://' + app_projectId + '.firebaseapp.com/__/auth/handler'
];
const app_grants = ['authorization_code', 'refresh_token'];

const setToDatabase = async (keytype, key, value = {}) => {
    console.log('%s/%s set to database', keytype, key, JSON.stringify(value));
    if (!keytype) {
        throw new Error('KeyType required');
    }
    if (!key) {
        throw new Error('Key required');
    }
    try {
        await admin.database().ref(`${keytype}/${key}`).set(value);
        return value;
    } catch (error) {
        console.error(error);
        throw error;
    }
};

const getFromDatabase = async (keytype, key) => {
    console.log('%s/%s get from database', keytype, key);
    if (!keytype) {
        throw new Error('KeyType required');
    }
    if (!key) {
        throw new Error('Key required');
    }
    try {
        const snapshot = await admin.database().ref(`${keytype}/${key}`).once('value');
        return snapshot.val();
    } catch (error) {
        console.error(error);
        throw error;
    }
};

exports.getAccessToken = (key) => {
    return getFromDatabase('accesstoken', key);
};

exports.getClient = async (client_id, client_secret) => {
    if (client_id !== app_clientId) {
        console.error('mismatch client id', client_id, app_clientId);
        throw new Error('mismatch client id');
    }
    if (client_secret && client_secret !== app_clientSecret) {
        console.error('mismatch client secret', client_secret, app_clientSecret);
        throw new Error('mismatch client secret');
    }
    return {
        id: app_clientId,
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
