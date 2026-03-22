'use strict';

const Model = require('./models');
const { valuniq, flatten, showError } = require('./utils');

const payload_data = (deviceId, deviceNickname, deviceData) => {
    const deviceType = deviceData.type;
    const deviceManufacturer = deviceData.manufacturer;
    const deviceModel = deviceData.model;
    const devicewillReportState = deviceData.willReportState;
    const deviceTraits = deviceData.traits;
    const deviceAttributes = deviceData.attributes;
    let deviceName = deviceData.name;
    if (!deviceName) {
        if (deviceManufacturer && deviceModel) {
            deviceName = String(`${deviceManufacturer} ${deviceModel}`);
        } else {
            deviceName = deviceData.id;
        }
    }
    const device_payload = {
        id: deviceId,
        type: deviceType,
        name: {
            defaultNames: [deviceName],
            name: deviceName,
            nicknames: [deviceNickname]
        },
        deviceInfo: {},
        traits: [],
        willReportState: devicewillReportState
    };
    if (deviceManufacturer) {
        device_payload['deviceInfo']['manufacturer'] = deviceManufacturer;
    }
    if (deviceModel) {
        device_payload['deviceInfo']['model'] = deviceModel;
    }
    if (deviceTraits) {
        device_payload['traits'] = deviceTraits;
    }
    if (deviceAttributes) {
        device_payload['attributes'] = deviceAttributes;
    }
    return device_payload;
};

const sync = async (req, res, params = {}) => {
    try {
        const deviceProps = { requestId: req.body.requestId, payload: { agentUserId: params.uid, devices: [] } };
        const deviceData = await Promise.all([
            Model.getGroupDevicesByUserId(params.uid),
            Model.getUserDevices(params.uid)
        ]);

        valuniq(flatten(deviceData)).forEach((data) => {
            deviceProps['payload']['devices'].push(payload_data(data.id, data.name, data.data));
        });

        console.log('sync:', JSON.stringify(deviceProps));
        res.status(200).json(deviceProps);
    } catch (error) {
        showError(res, error.message || error);
    }
};

const query = async (req, res, _params = {}) => {
    try {
        const deviceStates = { requestId: req.body.requestId, payload: { devices: {} } };
        const reqStates = req.body.inputs[0].payload.devices;

        const states = await Promise.all(reqStates.map(reqDevice => Model.getStates(reqDevice.id)));

        deviceStates['payload']['devices'] = states.reduce((o, c) => Object.assign(o, { [c.id]: c.data }), {});
        console.log('query:', JSON.stringify(deviceStates));
        res.status(200).json(deviceStates);
    } catch (error) {
        showError(res, error.message || error);
    }
};

const execute = async (req, res, _params = {}) => {
    try {
        const respCommands = [];
        const reqCommands = req.body.inputs[0].payload.commands;
        const resPromises = [];

        reqCommands.forEach((curCommand) => {
            curCommand.devices.forEach((curDevice) => {
                let deviceId = String(curDevice.id);
                let commandsData = [];
                curCommand.execution.forEach((curExec) => {
                    commandsData.push({ command: curExec.command, params: curExec.params });
                });
                resPromises.push(Model.setCommands(deviceId, commandsData));
                respCommands.push({ ids: [deviceId], status: "SUCCESS" });
            });
        });

        const resBody = {
            requestId: req.body.requestId,
            payload: {
                commands: respCommands
            }
        };

        await Promise.all(resPromises);
        console.log('execute:', JSON.stringify(resBody));
        res.status(200).json(resBody);
    } catch (error) {
        showError(res, error.message || error);
    }
};

module.exports = {
    sync,
    query,
    execute
};
