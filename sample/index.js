'use strict';
const admin = require('./firebase.admin').admin;
const Model = require('./firebase.admin').Model;
const broadlink = require('./getDevice');
const DEBUG = true;
const convert_actions = (nowState, actionType, actionParam) => {
    const now = nowState.data;
    switch(actionType) {
    case 'action.devices.commands.OnOff':
        return (actionParam.on === true) ? 'on' : 'off';
    case 'action.devices.commands.BrightnessAbsolute':
        const requestBrightness = actionParam.brightness;
        console.log("req=" + requestBrightness + " now=" + now.brightness);
        console.log("ret=" + (requestBrightness < now.brightness) ? '0' : '100');
        return (requestBrightness < now.brightness) ? '0' : '100';
    default:
        return actionParam;
    }
}

const broadlink_commander = (macaddr, commands=[]) => {
    return new Promise((resolve, reject) => {
        macaddr = String(macaddr).toLowerCase();
        const timer = setInterval(function() {
            const rm = broadlink({host: macaddr, log: console.log})
            if (rm) {
                clearInterval(timer);
                resolve(rm);
            }
        }, 100);
    }).then((rm) => {
        commands.forEach((cmdhex) => {
            if(!cmdhex) {
                return;
            }
            console.log('sendto', macaddr, cmdhex);
            const hexDataBuf = new Buffer(cmdhex, "hex");
            rm.sendData(hexDataBuf);
        });
        return commands;
    }).catch(console.error);
};

admin.database().ref('commands').on('child_added', (snap) => {
    const personalDeviceId = snap.key;
    const deviceCommand = snap.val();
    const nowref = Model.getStates(personalDeviceId);
    Model.getDeviceByPersonalDeviceId(personalDeviceId).then((docref) => {
        if(!docref) {
            console.error('control device cannot detect', personalDeviceId);
            return;
        }
        const deviceName = docref.name;
        return Promise.all([nowref, docref.remote, docref.device]).then(([nowstate, remoteDocsnap, deviceDocsnap]) => {
            if(DEBUG) {
                console.log('deviceNickname=', deviceName);
                console.log('deviceCommand=', deviceCommand);
                console.log('device=', deviceDocsnap.id, deviceDocsnap.data());
                console.log('remote=', remoteDocsnap.id, remoteDocsnap.data());
            }
            const remoteData = remoteDocsnap.data();
            const remoteCommand = deviceDocsnap.ref.collection(remoteData.type);
            const deviceCommandPromises = [];
            deviceCommand.forEach((cmd) => {
                const cmdkey = convert_actions(nowstate, cmd.command, cmd.params);
                deviceCommandPromises.push(remoteCommand.doc(cmd.command).get().then((remoteCommandDocsnap) => {
                    const cmddata = remoteCommandDocsnap.data();
                    if(cmddata[cmdkey]) {
                        return cmddata[cmdkey];
                    }
                }));
            });
            return Promise.all(deviceCommandPromises).then((deviceCommandData) => {
                return broadlink_commander(remoteData.mac_addr, deviceCommandData);
            });
        });
    }).then(() => {
        deviceCommand.forEach((cmd) => {
            console.log("CommandsFinished:", personalDeviceId, cmd.params);
            Model.setStates(personalDeviceId, cmd.params);
        });
    }).catch(console.error).then(() => {
        Model.setCommands(personalDeviceId, null);
    });
});
