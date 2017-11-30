'use strict';
const admin = require('./firebase.admin').admin;
const Model = require('./firebase.admin').Model;
const broadlink = require('./getDevice');
const DEBUG = true;
const convert_actions = (actionType, actionParam) => {
    switch(actionType) {
    case 'action.devices.commands.OnOff':
        return (actionParam.on === true) ? 'on' : 'off';
    case 'action.devices.commands.BrightnessAbsolute':
        return actionParam.brightness;
    default:
        return actionParam;
    }
}
const broadlink_commander = (macaddr, commands=[]) => {
    const rm = broadlink({host: macaddr, log: console.log});
    if(rm) {
        commands.forEach((cmdhex) => {
            if(cmdhex) {
                const timer = setInterval(() => {
                    console.log('sendto', macaddr, cmdhex);
                    rm.sendData(new Buffer(cmdhex, "hex"));
                    clearInterval(timer);
                }, 100);
            }
        });
        return true;
    }
};

admin.database().ref('commands').on('child_added', (snap) => {
    const personalDeviceId = snap.key;
    const deviceCommand = snap.val();
    Model.getDeviceByPersonalDeviceId(personalDeviceId).then((docref) => {
        if(!docref) {
            console.error('control device cannot detect', personalDeviceId);
            return;
        }
        const deviceName = docref.name;
        return Promise.all([docref.remote, docref.device]).then(([remoteDocsnap, deviceDocsnap]) => {
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
                const cmdkey = convert_actions(cmd.command, cmd.params);
                deviceCommandPromises.push(remoteCommand.doc(cmd.command).get().then((remoteCommandDocsnap) => {
                    const cmddata = remoteCommandDocsnap.data();
                    if(cmddata.cmdkey) {
                        return cmddata.cmdkey;
                    }
                }));
            });
            return Promise.all(deviceCommandPromises).then((deviceCommandData) => {
                console.log(deviceName, deviceCommandData);
                return broadlink_commander(remoteData.mac_addr, deviceCommandData);
            });
        });
    }).catch(console.error).then(() => {
        Model.setCommands(personalDeviceId, null);
    });
});
