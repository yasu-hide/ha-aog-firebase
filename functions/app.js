'use strict';

const functions = require('firebase-functions');
const admin = require("firebase-admin");
const OAuth2Server = require("oauth2-server");
const fetch = require('node-fetch');
const requestSyncEndpoint = 'https://homegraph.googleapis.com/v1/devices:requestSync?key=';
const reportStateEndpoint = 'https://homegraph.googleapis.com/v1/devices?key=';

const getFromFirestore = (collection, doc) => {
    return admin.firestore().collection(collection).doc(doc);
};
const getFromDatabase = (refkey, pkey) => {
    return admin.database().ref(refkey + '/' + pkey).once('value');
};

const Model = {};
const getPersonalDevices = (personal, personalId) => {
    let personalId_key = undefined;
    switch(personal) {
    case "group_devices":
        personalId_key = 'groupId'; break;
    case "user_devices":
        personalId_key = 'userId'; break;
    default:
        throw new SyntaxError('personal required');
    }
    return admin.firestore().collection(personal).where(personalId_key, '==', personalId).get().then((querysnap) => {
        const devicePromises = [];
        querysnap.forEach((docsnap) => {
            const docdata = docsnap.data();
            if(!docdata.deviceId && !docdata.deviceReference) {
                throw new SyntaxError('require deviceId or deviceReference in group_devices.');
            }
            let deviceReference;
            if(docdata.deviceReference) {
                deviceReference = docdata.deviceReference.get();
            } else {
                deviceReference = Model.getDevice(docdata.deviceId);
            }
            devicePromises.push(deviceReference.then((devsnap) => {
                return {
                    id: docsnap.id,
                    name: docdata.name,
                    data: devsnap.data()
                };
            }));
        });
        return Promise.all(devicePromises);
    });
};
Model.getGroupDevices = (groupId) => {
    return getPersonalDevices('group_devices', groupId);
};
Model.getUserDevices = (userId) => {
    return getPersonalDevices('user_devices', userId);
};
Model.getDevice = (deviceId) => {
    return getFromFirestore('devices', deviceId).get().then((docsnap) => {
        if(docsnap && docsnap.exists) {
            return {
                id: docsnap.id,
                data: docsnap.data()
            }
        }
        return {};
    });
};
Model.getRemote = (remoteId) => {
    return getFromFirestore('remotes', remoteId).get().then((docsnap) => {
        if(docsnap && docsnap.exists) {
            return {
                id: docsnap.id,
                data: docsnap.data()
            }
        }
        return {};
    });
};
Model.getUser = (userId) => {
    return getFromFirestore('users', userId).get().then((docsnap) => {
        if(docsnap && docsnap.exists) {
            return {
                id: docsnap.id,
                data: docsnap.data()
            }
        }
        return {};
    });
};
Model.getGroup = (groupId) => {
    return getFromFirestore('groups', groupId).get().then((docsnap) => {
        if(docsnap && docsnap.exists) {
            return {
                id: docsnap.id,
                data: docsnap.data()
            }
        }
        return {};
    });
};
Model.getCommands = (indivDeviceId) => {
    return getFromDatabase('commands', indivDeviceId).then((snap) => {
        return {
            id: indivDeviceId,
            data: snap.val()
        };
    });
};
Model.setCommands = (indivDeviceId, commandData) => {
    return admin.database().ref('commands/' + indivDeviceId).set(commandData);
};
Model.getStates = (indivDeviceId) => {
    return getFromDatabase('states', indivDeviceId).then((snap) => {
        return {
            id: indivDeviceId,
            data: snap.val()
        };
    });
};
Model.setStates = (indivDeviceId, statesData) => {
    return admin.database().ref('states/' + indivDeviceId).update(statesData);
};
Model.getGroupDevicesByUserId = (userId) => {
    return admin.firestore().collection('groups').select(userId).get().then((querysnap) => {
        const groupDevicePromises = [];
        querysnap.forEach((docsnap) => {
            if(docsnap && docsnap.exists)
                groupDevicePromises.push(Model.getGroupDevices(docsnap.id));
        });
        return Promise.all(groupDevicePromises);
    });
};

const valuniq = (obj) => {
    const arrobj = {};
    for(let i = 0; i< obj.length; i++) {
        arrobj[obj[i]['id']] = obj[i];
    }
    const newret = [];
    for(let key in arrobj) {
        newret.push(arrobj[key]);
    }
    return newret;
}
const flatten = (arr) => Array.isArray(arr) ? [].concat.apply([], arr.map(flatten)) : arr;

const sync = (req, res, params={}) => {
    const deviceProps = { requestId: req.body.requestId, payload: { agentUserId: params.uid, devices: [] } };
    const payload_data = (deviceId, deviceNickname, deviceData) => {
        const deviceType = deviceData.type;
        const deviceManufacturer = deviceData.manufacturer;
        const deviceModel = deviceData.model;
        const devicewillReportState = deviceData.willReportState;
        const deviceTraits = deviceData.traits;
        const deviceAttributes = deviceData.attributes;
        let deviceName = deviceData.name;
        if(!deviceName) {
            if(deviceManufacturer && deviceModel) {
                deviceName = new String('' + deviceManufacturer + ' ' + deviceModel);
            } else {
                deviceName = deviceData.id;
            }
        }
        const device_payload = {
            id: deviceId,
            type: deviceData.type,
            name: {
                defaultNames: [ deviceName ],
                name: deviceName,
                nicknames: [ deviceNickname ]
            },
            deviceInfo: {},
            traits: [],
            willReportState: devicewillReportState
        };
        if(deviceManufacturer) {
            device_payload['deviceInfo']['manufacturer'] = deviceManufacturer;
        }
        if(deviceModel) {
            device_payload['deviceInfo']['model'] = deviceModel;
        }
        if(deviceTraits) {
            device_payload['traits'] = deviceTraits;
        }
        if(deviceAttributes) {
            device_payload['attributes'] = deviceAttributes;
        }
        return device_payload;
    };

    Promise.all([
        Model.getGroupDevicesByUserId(params.uid),
        Model.getUserDevices(params.uid)
    ]).then((deviceData) => {
        valuniq(flatten(deviceData)).forEach((data) => {
            deviceProps['payload']['devices'].push(payload_data(data.id, data.name, data.data));
        });
        console.log('sync:', JSON.stringify(deviceProps));
        res.status(200).json(deviceProps);
        return;
    }).catch((error) => {
        showError(res, error);
        return;
    });
};

const query = (req, res, params={}) => {
    const deviceStates = { requestId: req.body.requestId, payload: { devices: {} } };

    const reqStates = req.body.inputs[0].payload.devices;
    const resPromises = [];
    reqStates.forEach((reqDevice) => {
        resPromises.push(Model.getStates(reqDevice.id));
    });
    const payload_devices = {};
    Promise.all(resPromises).then((states) => {
        deviceStates['payload']['devices'] = states.reduce((o,c) => Object.assign(o, {[c.id]: c.data}), {});
        console.log('query:', JSON.stringify(deviceStates));
        res.status(200).json(deviceStates);
        return;
    }).catch((error) => {
        showError(res, error);
        return;
    });
};

const execute = (req, res, params={}) => {
    const respCommands = [];
    const reqCommands = req.body.inputs[0].payload.commands

    const resPromises = [];
    reqCommands.forEach((curCommand) => {
        curCommand.devices.forEach((curDevice) => {
            let deviceId = new String(curDevice.id);
            let commandsData = [];
            curCommand.execution.forEach((curExec) => {
                commandsData.push({ command : curExec.command, params: curExec.params });
            });
            resPromises.push(Model.setCommands(deviceId, commandsData));
            respCommands.push({ ids: [ deviceId ], status: "SUCCESS"});
        });
    });
    const resBody = {
        requestId: req.body.requestId,
        payload: {
            commands: respCommands
        }
    };
    Promise.all(resPromises).then(() => {
        console.log('execute:', JSON.stringify(resBody));
        res.status(200).json(resBody);
        return;
    }).catch((error) => {
        showError(res, error);
        return;
    });
};

exports.requestsync = (req, res) => {
    console.info('/request-sync query', req.query);
    console.info('/request-sync body', req.body);
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(req);
    const apiKey = functions.config().firebase.apiKey;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    oauth.authenticate(request, response).then((auth) => {
        console.info('Auth OK', auth);
        options.body = JSON.stringify({ agentUserId : auth.user.id });
        return fetch(requestSyncEndpoint + apiKey, options).then((res) => {
            console.log("request-sync:", res.status, res.statusText);
            res.status(200).json({ status: 'OK' });
            return;
        }).catch(console.error);
    }).catch((error) => {
        showError(res, error);
        return;
    });
};
exports.reportstate = (req, res) => {
    console.info('/report-state query', req.query);
    console.info('/report-state body', req.body);
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(req);
    const apiKey = functions.config().firebase.apiKey;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        }
    };
    oauth.authenticate(request, response).then((auth) => {
        console.info('Auth OK', auth);
        if(!req.body.devices) {
            throw new SyntaxError('devices required');
        }
        options.body = JSON.stringify({
            agentUserId: auth.user.id,
            requestId: 'request-' + Math.random(),
            devices: req.body.devices
        });
        return fetch(reportStateEndpoint + apiKey, options).then((res) => {
            console.log('report-state:', res.status, res.statusText);
            res.status(200).json({ status: 'OK' });
            return;
        }).catch(console.error);
    }).catch((error) => {
        showError(res, error);
        return;
    });
};
const showError = (res, message) => {
    console.error(message);
    res.status(400).set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }).json({error: message});
    return;
};

exports.root = (req, res) => {
    console.info('/ query', JSON.stringify(req.query));
    console.info('/ body', JSON.stringify(req.body));
    const oauth = new OAuth2Server({ model: require("./oauth2").AuthModel });
    const request = new OAuth2Server.Request(req);
    const response = new OAuth2Server.Response(req);
    oauth.authenticate(request, response).then((auth) => {
        console.info('Auth OK', auth);
        if (! req.body.inputs) {
            return showError(res, "missing inputs");
        }
        const params = {
            uid: auth.user.id,
            access_token: auth.accessToken
        };
        for (let i = 0; i < req.body.inputs.length; i++) {
            switch (req.body.inputs[i].intent) {
                case "action.devices.SYNC":
                    sync(req, res, params);
                    return;
                case "action.devices.QUERY":
                    query(req, res, params);
                    return;
                case "action.devices.EXECUTE":
                    execute(req, res, params);
                    return;
                default:
                    showError(res, "missing intent");
                    return;
            }
        }
        return;
    }).catch((error) => {
        showError(res, error);
        return;
    });
};
