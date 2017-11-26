'use strict';

const functions = require('firebase-functions');
const admin = require("firebase-admin");
const OAuth2Server = require("oauth2-server");
const AuthStore = require("./oauth2_store");
const AuthModel = {
    getAccessToken : (accessToken) => {
        return AuthStore.getAccessToken(accessToken).then((token) => {
            return AuthStore.getClient(token.client_id).then((client) => {
                return {
                    accessToken: token.access_token,
                    accessTokenExpiresAt: new Date(token.expires_at),
                    client: client,
                    user: { id: token.user_id }
                };
            }).catch(console.error);
        }).catch(console.error);
    },
    getRefreshToken : (refreshToken) => {
        console.log('getRefreshToken:', refreshToken);
        return AuthStore.getRefreshToken(refreshToken).then((token) => {
            return AuthStore.getClient(token.client_id).then((client) => {
                return {
                    refreshToken: token.refresh_token,
                    refreshTokenExpiresAt: new Date(token.expires_at),
                    client: client,
                    user: { id: token.user_id }
                };
            }).catch(console.error);
        }).catch(console.error);
    },
    getAuthorizationCode : (authCode) => {
        console.log('getAuthorizationCode:', authCode);
        return AuthStore.getAuthorizationCode(authCode).then((code) => {
            return AuthStore.getClient(code.client_id).then((client) => {
                return {
                    code: code.authorization_code,
                    expiresAt: new Date(code.expires_at),
                    redirectUri: code.redirect_uri,
                    client: client,
                    user: { id: code.user_id }
                };
            }).catch(console.error);
        }).catch(console.error);
    },
    getClient : (clientId, clientSecret) => {
        console.log('getClient:', clientId, clientSecret);
        return AuthStore.getClient(clientId, clientSecret).then((client) => {
            return {
                id: client.id,
                redirectUris: client.redirect_uris,
                grants: client.grants
            };
        }).catch(console.error);
    },
    saveToken : (token, client, user) => {
        console.log('saveToken:', token, client, user);
        const access_token = AuthStore.setAccessTokens(token.accessToken, {
            access_token: token.accessToken,
            expires_at: new Date(token.accessTokenExpiresAt).toJSON(),
            client_id: client.id,
            user_id: user.id,
        });
        const refresh_token = AuthStore.setRefreshToken(token.refreshToken, {
            refresh_token: token.refreshToken,
            expires_at: new Date(token.refreshTokenExpiresAt).toJSON(),
            client_id: client.id,
            user_id: user.id
        });
        return access_token.then((accessToken) => {
            return refresh_token.then((refreshToken) => {
                return {
                    accessToken: accessToken.access_token,
                    accessTokenExpiresAt: new Date(accessToken.expires_at),
                    refreshToken: refreshToken.refresh_token,
                    refreshTokenExpiresAt: new Date(refreshToken.expires_at),
                    client: { id: accessToken.client_id },
                    user: { id: accessToken.user_id }
                };
            }).catch(console.error);
        }).catch(console.error);
    },
    saveAuthorizationCode : (code, client, user) => {
        console.log('saveAuthorizationCode:', code, client, user);
        return AuthStore.setAuthCode(code.authorizationCode, {
            authorization_code: code.authorizationCode,
            expires_at: new Date(code.expiresAt).toJSON(),
            redirect_uri: code.redirectUri,
            client_id: client.id,
            user_id: user.id
        }).then((authorizationCode) => {
            return {
                authorizationCode: authorizationCode.authorization_code,
                expiresAt: new Date(authorizationCode.expires_at),
                redirectUri: authorizationCode.redirect_uri,
                client: { id: authorizationCode.client_id },
                user: { id: authorizationCode.user_id }
            };
        }).catch(console.error);
    },
    revokeToken : (token) => {
        console.log('revokeToken:', token);
        return AuthStore.unsetRefreshToken(token.refreshToken).then((refreshToken) => {
            return true;
        }).catch(console.error);
    },
    revokeAuthorizationCode : (code) => {
        console.log('revokeAuthorizationCode:', code);
        return AuthStore.unsetAuthCode(code.code).then((authorizationCode) => {
            return true;
        }).catch(console.error);
    }
};
const oauth = new OAuth2Server({ model: AuthModel });

exports.auth = (req, res, next) => {
    console.info('/auth query', req.query);
    console.info('/auth body', req.body);
    const client_id = (req.query.client_id || req.body.client_id);
    const redirect_uri = (req.query.redirect_uri || req.body.redirect_uri);
    const state = (req.query.state || req.body.state);
    const bearer = req.headers.authorization;
    if(bearer && bearer.startsWith('Bearer ')) {
        const idToken = bearer.split('Bearer ')[1];
        delete req.headers.authorization;
        return admin.auth().verifyIdToken(idToken).then((decodedIdToken) => {
            const options = { authenticateHandler: { handle: (data) => { return { id: decodedIdToken.sub } } } };
            const request = new OAuth2Server.Request(req);
            const response = new OAuth2Server.Response(res);
            oauth.authorize(request, response, options).then((authcode) => {
                res.status(200).send(authcode.authorizationCode);
                return;
            }).catch((error) => {
                console.error(error);
                res.status(401).json({ error: "invalid_request", description: error });
                return;
            });
            return;
        }).catch((error) => {
            console.error('Error while verifying Firebase ID token:', error);
            res.status(401).json({ error: "invalid_request", description: 'Unauthorized' });
            return;
        });
    }
    return res.render('login', {
        config: functions.config().firebase,
        redirect_uri: redirect_uri,
        state: state
    });
};
exports.token = (req, res, next) => {
    console.info('/token query', req.query);
    console.info('/token body', req.body);
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    // refresh token will expire in 10 years.
    const options = { refreshTokenLifetime: 86400 * 3650 };
    oauth.token(request, response, options).then((token) => {
        res.set(response.headers);
        res.status(response.status).send(response.body);
        return;
    }).catch((error) =>{
        console.error(error);
        if(response) {
            res.set(response.headers);
        }
        res.status(400).send({ error: "invalid_request", description: error });
        return;
    });
};
exports.AuthModel = AuthModel;
