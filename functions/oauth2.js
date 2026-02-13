'use strict';

const admin = require("firebase-admin");
const OAuth2Server = require("oauth2-server");
const AuthStore = require("./oauth2_store");
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

const AuthModel = {
    getAccessToken: async (accessToken) => {
        try {
            const token = await AuthStore.getAccessToken(accessToken);
            if (!token) return null;
            const client = await AuthStore.getClient(token.client_id);
            return {
                accessToken: token.access_token,
                accessTokenExpiresAt: new Date(token.expires_at),
                client: client,
                user: { id: token.user_id }
            };
        } catch (error) {
            console.error('getAccessToken error:', error);
            throw error;
        }
    },
    getRefreshToken: async (refreshToken) => {
        console.log('getRefreshToken:', refreshToken);
        try {
            const token = await AuthStore.getRefreshToken(refreshToken);
            if (!token) return null;
            const client = await AuthStore.getClient(token.client_id);
            return {
                refreshToken: token.refresh_token,
                refreshTokenExpiresAt: new Date(token.expires_at),
                client: client,
                user: { id: token.user_id }
            };
        } catch (error) {
            console.error('getRefreshToken error:', error);
            throw error;
        }
    },
    getAuthorizationCode: async (authCode) => {
        console.log('getAuthorizationCode:', authCode);
        try {
            const code = await AuthStore.getAuthorizationCode(authCode);
            if (!code) return null;
            const client = await AuthStore.getClient(code.client_id);
            return {
                code: code.authorization_code,
                expiresAt: new Date(code.expires_at),
                redirectUri: code.redirect_uri,
                client: client,
                user: { id: code.user_id }
            };
        } catch (error) {
            console.error('getAuthorizationCode error:', error);
            throw error;
        }
    },
    getClient: async (clientId, clientSecret) => {
        console.log('getClient:', clientId, clientSecret);
        try {
            const client = await AuthStore.getClient(clientId, clientSecret);
            return {
                id: client.id,
                redirectUris: client.redirect_uris,
                grants: client.grants
            };
        } catch (error) {
            console.error('getClient error:', error);
            throw error;
        }
    },
    saveToken: async (token, client, user) => {
        console.log('saveToken:', token, client, user);
        try {
            const accessTokenPromise = AuthStore.setAccessTokens(token.accessToken, {
                access_token: token.accessToken,
                expires_at: new Date(token.accessTokenExpiresAt).toJSON(),
                client_id: client.id,
                user_id: user.id,
            });
            const refreshTokenPromise = AuthStore.setRefreshToken(token.refreshToken, {
                refresh_token: token.refreshToken,
                expires_at: new Date(token.refreshTokenExpiresAt).toJSON(),
                client_id: client.id,
                user_id: user.id
            });

            const [accessToken, refreshToken] = await Promise.all([accessTokenPromise, refreshTokenPromise]);

            return {
                accessToken: accessToken.access_token,
                accessTokenExpiresAt: new Date(accessToken.expires_at),
                refreshToken: refreshToken.refresh_token,
                refreshTokenExpiresAt: new Date(refreshToken.expires_at),
                client: { id: accessToken.client_id },
                user: { id: accessToken.user_id }
            };
        } catch (error) {
            console.error('saveToken error:', error);
            throw error;
        }
    },
    saveAuthorizationCode: async (code, client, user) => {
        console.log('saveAuthorizationCode:', code, client, user);
        try {
            const authorizationCode = await AuthStore.setAuthCode(code.authorizationCode, {
                authorization_code: code.authorizationCode,
                expires_at: new Date(code.expiresAt).toJSON(),
                redirect_uri: code.redirectUri,
                client_id: client.id,
                user_id: user.id
            });
            return {
                authorizationCode: authorizationCode.authorization_code,
                expiresAt: new Date(authorizationCode.expires_at),
                redirectUri: authorizationCode.redirect_uri,
                client: { id: authorizationCode.client_id },
                user: { id: authorizationCode.user_id }
            };
        } catch (error) {
            console.error('saveAuthorizationCode error:', error);
            throw error;
        }
    },
    revokeToken: async (token) => {
        console.log('revokeToken:', token);
        try {
            await AuthStore.unsetRefreshToken(token.refreshToken);
            return true;
        } catch (error) {
            console.error('revokeToken error:', error);
            throw error;
        }
    },
    revokeAuthorizationCode: async (code) => {
        console.log('revokeAuthorizationCode:', code);
        try {
            await AuthStore.unsetAuthCode(code.code);
            return true;
        } catch (error) {
            console.error('revokeAuthorizationCode error:', error);
            throw error;
        }
    }
};

const oauth = new OAuth2Server({ model: AuthModel });

exports.auth = async (req, res, _next) => {
    console.info('/auth query', req.query);
    console.info('/auth body', req.body);
    const redirect_uri = (req.query.redirect_uri || req.body.redirect_uri);
    const state = (req.query.state || req.body.state);
    const bearer = req.headers.authorization;

    if (bearer && bearer.startsWith('Bearer ')) {
        const idToken = bearer.split('Bearer ')[1];
        delete req.headers.authorization;
        try {
            const decodedIdToken = await admin.auth().verifyIdToken(idToken);
            const options = { authenticateHandler: { handle: () => ({ id: decodedIdToken.sub }) } };
            const request = new OAuth2Server.Request(req);
            const response = new OAuth2Server.Response(res);
            const authcode = await oauth.authorize(request, response, options);
            res.status(200).send(authcode.authorizationCode);
            return;
        } catch (error) {
            console.error('Auth verify error:', error);
            res.status(401).json({ error: "invalid_request", description: error.message || error });
            return;
        }
    }
    return res.render('login', {
        config: firebaseConfig,
        redirect_uri: redirect_uri,
        state: state
    });
};

exports.token = async (req, res, _next) => {
    console.info('/token query', req.query);
    console.info('/token body', req.body);
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    // refresh token will expire in 10 years.
    const options = { refreshTokenLifetime: 86400 * 3650 };
    try {
        await oauth.token(request, response, options);
        res.set(response.headers);
        res.status(response.status).send(response.body);
    } catch (error) {
        console.error('Token error:', error);
        if (response) {
            res.set(response.headers);
        }
        res.status(400).send({ error: "invalid_request", description: error.message || error });
    }
};

exports.AuthModel = AuthModel;
