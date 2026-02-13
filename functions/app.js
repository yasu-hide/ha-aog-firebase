'use strict';

const functions = require('firebase-functions/v1');
const OAuth2Server = require("oauth2-server");
const fetch = require('node-fetch');
const { showError } = require('./utils');
const { sync, query, execute } = require('./intents');

const requestSyncEndpoint = 'https://homegraph.googleapis.com/v1/devices:requestSync?key=';
const reportStateEndpoint = 'https://homegraph.googleapis.com/v1/devices?key=';

exports.requestsync = async (req, res) => {
    console.info('/request-sync query', req.query);
    console.info('/request-sync body', req.body);
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    const apiKey = functions.config().firebase.apiKey;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth);
        options.body = JSON.stringify({ agentUserId: auth.user.id });
        const fetchRes = await fetch(requestSyncEndpoint + apiKey, options);
        console.log("request-sync:", fetchRes.status, fetchRes.statusText);
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        showError(res, error.message || error);
    }
};

exports.reportstate = async (req, res) => {
    console.info('/report-state query', req.query);
    console.info('/report-state body', req.body);
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    const apiKey = functions.config().firebase.apiKey;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth);
        if (!req.body.devices) {
            throw new SyntaxError('devices required');
        }
        options.body = JSON.stringify({
            agentUserId: auth.user.id,
            requestId: 'request-' + Math.random(),
            devices: req.body.devices
        });
        const fetchRes = await fetch(reportStateEndpoint + apiKey, options);
        console.log('report-state:', fetchRes.status, fetchRes.statusText);
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        showError(res, error.message || error);
    }
};

exports.root = async (req, res) => {
    console.info('/ query', JSON.stringify(req.query));
    console.info('/ body', JSON.stringify(req.body));
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth);
        if (!req.body.inputs) {
            return showError(res, "missing inputs");
        }
        const params = {
            uid: auth.user.id,
            access_token: auth.accessToken
        };
        for (let i = 0; i < req.body.inputs.length; i++) {
            switch (req.body.inputs[i].intent) {
                case "action.devices.SYNC":
                    await sync(req, res, params);
                    return;
                case "action.devices.QUERY":
                    await query(req, res, params);
                    return;
                case "action.devices.EXECUTE":
                    await execute(req, res, params);
                    return;
                default:
                    showError(res, "missing intent");
                    return;
            }
        }
    } catch (error) {
        showError(res, error.message || error);
    }
};
