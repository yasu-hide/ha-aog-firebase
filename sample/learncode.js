'use strict';

const getDevice = require('./getDevice');
let timeout = null;
let closeClient = null;
let getDataTimeout = null;

const stop = (log=console.log) => {
    // Reset existing learn requests
    if (!closeClient) {
        return;
    }
    closeClient();
    closeClient = null;
    log(`Learn Code (stopped)`);
    return true;
};

const start = (host=process.argv[2], log=console.log) => {
    return new Promise((resolve, reject) => {
        stop(log);
        host = String(host).toLowerCase();
        // Get the Broadlink device
        const deviceTimer = setInterval(() => {
            const device = getDevice({ host: host, log: log, learnOnly: true });
            if(device) {
                clearInterval(deviceTimer);
                resolve(device);
            }
        }, 100);
    }).then((device) => {
        if (!device.enterLearning) {
            return log(`Learn Code (IR learning not supported for device at ${host})`);
        }

        let onRawData;
        closeClient = (err) => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = null;
            if (getDataTimeout) {
                clearTimeout(getDataTimeout);
            }
            getDataTimeout = null;
            device.removeListener('rawData', onRawData);
        };
        onRawData = (message) => {
            if (!closeClient) {
                return;
            }
            const hex = message.toString('hex');
            log(`Learn Code (learned hex code: ${hex})`);
            log(`Learn Code (complete)`);
            closeClient();
        };

        device.on('rawData', onRawData);
        device.enterLearning();
        log(`Learn Code (ready)`);
        getDataTimeout = setTimeout(() => {
            getData(device);
        }, 1000);
    });
};

const getData = (device) => {
    if (getDataTimeout) {
        clearTimeout(getDataTimeout);
    }
    if (!closeClient) {
        return;
    }
    device.checkData();
    getDataTimeout = setTimeout(() => {
        getData(device);
    }, 1000);
};
start();
