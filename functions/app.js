'use strict';

const OAuth2Server = require("oauth2-server");
const { HOMEGRAPH_API_KEY } = require('./params');
const { showError, redactForLog } = require('./utils');
const { sync, query, execute } = require('./intents');
const Model = require('./models');

const requestSyncEndpoint = 'https://homegraph.googleapis.com/v1/devices:requestSync?key=';
const reportStateEndpoint = 'https://homegraph.googleapis.com/v1/devices?key=';

exports.requestsync = async (req, res) => {
    console.info('/request-sync query', redactForLog(req.query));
    console.info('/request-sync body', redactForLog(req.body));
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    const apiKey = HOMEGRAPH_API_KEY.value();
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth.user.id);
        options.body = JSON.stringify({ agentUserId: auth.user.id });
        const fetchRes = await fetch(requestSyncEndpoint + apiKey, options);
        console.log("request-sync:", fetchRes.status, fetchRes.statusText);
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        showError(res, error);
    }
};

exports.reportstate = async (req, res) => {
    console.info('/report-state query', redactForLog(req.query));
    console.info('/report-state body', redactForLog(req.body));
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    const apiKey = HOMEGRAPH_API_KEY.value();
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth.user.id);
        const reqDevices = req.body?.devices;
        if (!reqDevices || typeof reqDevices !== 'object' || Array.isArray(reqDevices)) {
            throw new SyntaxError('devices required');
        }
        // 所有していない device ID を states / notifications から除外する
        const owned = await Model.checkOwnership(auth.user.id, [
            ...Object.keys(reqDevices.states ?? {}),
            ...Object.keys(reqDevices.notifications ?? {})
        ]);
        const devices = { ...reqDevices };
        for (const key of ['states', 'notifications']) {
            if (reqDevices[key] && typeof reqDevices[key] === 'object') {
                devices[key] = Object.fromEntries(Object.entries(reqDevices[key]).filter(([id]) => owned.get(id)));
            }
        }
        if (Object.keys(devices.states ?? {}).length === 0 && Object.keys(devices.notifications ?? {}).length === 0) {
            return res.status(200).json({ status: 'OK' });
        }
        options.body = JSON.stringify({
            agentUserId: auth.user.id,
            requestId: 'request-' + Math.random(),
            devices
        });
        const fetchRes = await fetch(reportStateEndpoint + apiKey, options);
        console.log('report-state:', fetchRes.status, fetchRes.statusText);
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        showError(res, error);
    }
};

exports.root = async (req, res) => {
    console.info('/ query', JSON.stringify(redactForLog(req.query)));
    console.info('/ body', JSON.stringify(redactForLog(req.body)));
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(res);
    try {
        const auth = await oauth.authenticate(request, response);
        console.info('Auth OK', auth.user.id);
        const inputs = req.body?.inputs;
        if (!Array.isArray(inputs)) {
            return showError(res, "missing inputs");
        }
        const params = {
            uid: auth.user.id,
            access_token: auth.accessToken
        };
        for (let i = 0; i < inputs.length; i++) {
            switch (inputs[i]?.intent) {
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
        showError(res, "missing intent");
    } catch (error) {
        showError(res, error);
    }
};
