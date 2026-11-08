'use strict';

const { getAuth } = require('firebase-admin/auth');
const OAuth2Server = require("@node-oauth/oauth2-server");
const AuthStore = require("./oauth2_store");
const { isClientOAuthError, redactForLog, showError } = require('./utils');
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);

const AuthModel = {
    getAccessToken: async (accessToken) => {
        try {
            const token = await AuthStore.getAccessToken(accessToken);
            if (!token) return null;
            const client = await AuthStore.getClient(token.client_id);
            if (!client) return null;
            return {
                accessToken: token.access_token,
                accessTokenExpiresAt: new Date(token.expires_at),
                client: client,
                user: { id: token.user_id }
            };
        } catch (error) {
            console.error('getAccessToken error:', error?.code ?? error?.name);
            throw error;
        }
    },
    getRefreshToken: async (refreshToken) => {
        console.log('getRefreshToken');
        try {
            const token = await AuthStore.getRefreshToken(refreshToken);
            if (!token) return null;
            const client = await AuthStore.getClient(token.client_id);
            if (!client) return null;
            return {
                refreshToken: token.refresh_token,
                refreshTokenExpiresAt: new Date(token.expires_at),
                client: client,
                user: { id: token.user_id }
            };
        } catch (error) {
            console.error('getRefreshToken error:', error?.code ?? error?.name);
            throw error;
        }
    },
    getAuthorizationCode: async (authCode) => {
        console.log('getAuthorizationCode');
        try {
            const code = await AuthStore.getAuthorizationCode(authCode);
            if (!code) return null;
            const client = await AuthStore.getClient(code.client_id);
            if (!client) return null;
            return {
                code: code.authorization_code,
                expiresAt: new Date(code.expires_at),
                redirectUri: code.redirect_uri,
                client: client,
                user: { id: code.user_id }
            };
        } catch (error) {
            console.error('getAuthorizationCode error:', error?.code ?? error?.name);
            throw error;
        }
    },
    getClient: async (clientId, clientSecret) => {
        console.log('getClient:', clientId);
        try {
            const client = await AuthStore.getClient(clientId, clientSecret);
            if (!client) return null;
            return {
                id: client.id,
                redirectUris: client.redirect_uris,
                grants: client.grants
            };
        } catch (error) {
            console.error('getClient error:', error?.code ?? error?.name);
            throw error;
        }
    },
    saveToken: async (token, client, user) => {
        console.log('saveToken:', client?.id, user?.id);
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
            console.error('saveToken error:', error?.code ?? error?.name);
            throw error;
        }
    },
    saveAuthorizationCode: async (code, client, user) => {
        console.log('saveAuthorizationCode:', client?.id, user?.id);
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
            console.error('saveAuthorizationCode error:', error?.code ?? error?.name);
            throw error;
        }
    },
    revokeToken: async (token) => {
        console.log('revokeToken:', token?.client?.id, token?.user?.id);
        try {
            await AuthStore.unsetRefreshToken(token.refreshToken);
            return true;
        } catch (error) {
            console.error('revokeToken error:', error?.code ?? error?.name);
            throw error;
        }
    },
    revokeAuthorizationCode: async (code) => {
        console.log('revokeAuthorizationCode:', code?.client?.id, code?.user?.id);
        try {
            await AuthStore.unsetAuthCode(code.code);
            return true;
        } catch (error) {
            console.error('revokeAuthorizationCode error:', error?.code ?? error?.name);
            throw error;
        }
    }
};

const oauth = new OAuth2Server({ model: AuthModel });

exports.auth = async (req, res, _next) => {
    console.info('/auth query', redactForLog(req.query));
    console.info('/auth body', redactForLog(req.body));
    const state = (req.query?.state || req.body?.state);
    const bearer = req.headers.authorization;

    if (bearer && bearer.startsWith('Bearer ')) {
        const idToken = bearer.split('Bearer ')[1];
        delete req.headers.authorization;
        let decodedIdToken;
        try {
            decodedIdToken = await getAuth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Auth verify error:', error);
            res.status(401).json({ error: "invalid_request", description: 'Unauthorized' });
            return;
        }
        // PKCE は未対応のため code_challenge は無視する (認可コードに保存させない)。
        // Express 5 の req.query は参照のたびに再生成される getter なので、コピーを上書きして差し替える。
        const query = { ...req.query };
        delete query.code_challenge;
        delete query.code_challenge_method;
        Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true });
        if (req.body && typeof req.body === 'object') {
            delete req.body.code_challenge;
            delete req.body.code_challenge_method;
        }
        try {
            const options = { authenticateHandler: { handle: () => ({ id: decodedIdToken.sub }) } };
            const request = new OAuth2Server.Request(req);
            const response = new OAuth2Server.Response(res);
            const authcode = await oauth.authorize(request, response, options);
            res.status(200).send(authcode.authorizationCode);
            return;
        } catch (error) {
            console.error('Auth authorize error:', error);
            const description = isClientOAuthError(error) ? error.message : 'invalid_request';
            res.status(401).json({ error: "invalid_request", description: description });
            return;
        }
    }
    // login.ejs は redirect_uri をそのまま遷移先に使うため、画面を出す前に登録済みの値と照合する。
    const clientId = req.query?.client_id ?? req.body?.client_id;
    const requestedUri = req.query?.redirect_uri ?? req.body?.redirect_uri;
    const invalidRequest = () => res.status(400).json({ error: 'invalid_request', description: 'invalid client_id or redirect_uri' });
    if (typeof clientId !== 'string' || clientId === '' ||
        (requestedUri !== undefined && requestedUri !== null && typeof requestedUri !== 'string')) {
        return invalidRequest();
    }
    let client;
    try {
        client = await AuthStore.getClient(clientId);
    } catch (error) {
        return showError(res, error);
    }
    if (!client) {
        return invalidRequest();
    }
    // 未指定・空は @node-oauth/oauth2-server の getRedirectUri と同様に先頭の登録済み URI を使う。
    const redirect_uri = requestedUri ? requestedUri : client.redirect_uris[0];
    if (!client.redirect_uris.includes(redirect_uri)) {
        return invalidRequest();
    }
    return res.render('login', {
        config: firebaseConfig,
        redirect_uri: redirect_uri,
        state: state
    });
};

exports.token = async (req, res, _next) => {
    console.info('/token query', redactForLog(req.query));
    console.info('/token body', redactForLog(req.body));
    // PKCE は未対応。フォークは code_verifier があると client secret の検証を省くため、ライブラリに渡す前に拒否する。
    if (req.body?.code_verifier !== undefined || req.query?.code_verifier !== undefined) {
        res.status(400).json({ error: 'invalid_request', description: 'code_verifier is not supported' });
        return;
    }
    // scope は未使用。フォークは refresh で scope が付くと 400 invalid_scope にする (3.1.1 は無視) ため、ここで取り除く。
    // req.query は Express 5 で参照のたびに再生成される getter なので、コピーを上書きして差し替える。
    const query = { ...req.query };
    delete query.scope;
    Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true });
    if (req.body && typeof req.body === 'object') {
        delete req.body.scope;
    }
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
        if (isClientOAuthError(error)) {
            res.status(error.code).send({ error: error.name, description: error.message });
        } else {
            res.status(500).send({ error: 'server_error', description: 'internal_error' });
        }
    }
};

exports.AuthModel = AuthModel;
