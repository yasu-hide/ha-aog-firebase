'use strict';

const admin = require("firebase-admin");

const getFromFirestore = (collection, doc) => {
    return admin.firestore().collection(collection).doc(doc);
};

const getFromDatabase = (refkey, pkey) => {
    return admin.database().ref(refkey + '/' + pkey).once('value');
};

const Model = {};

const getPersonalDevices = async (personal, personalId) => {
    let personalId_key = undefined;
    switch (personal) {
        case "group_devices":
            personalId_key = 'groupId';
            break;
        case "user_devices":
            personalId_key = 'userId';
            break;
        default:
            throw new SyntaxError('personal required');
    }

    const querysnap = await admin.firestore().collection(personal).where(personalId_key, '==', personalId).get();

    const devicePromises = querysnap.docs.map(async (docsnap) => {
        const docdata = docsnap.data();
        if (!docdata.deviceId && !docdata.deviceReference) {
            throw new SyntaxError('require deviceId or deviceReference in group_devices.');
        }

        let data;
        if (docdata.deviceReference) {
            const devsnap = await docdata.deviceReference.get();
            data = devsnap.exists ? devsnap.data() : null;
        } else {
            const devobj = await Model.getDevice(docdata.deviceId);
            data = devobj.data || null;
        }

        return {
            id: docsnap.id,
            name: docdata.name,
            data: data
        };
    });

    return Promise.all(devicePromises);
};

Model.getGroupDevices = (groupId) => {
    return getPersonalDevices('group_devices', groupId);
};

Model.getUserDevices = (userId) => {
    return getPersonalDevices('user_devices', userId);
};

Model.getDevice = async (deviceId) => {
    const docsnap = await getFromFirestore('devices', deviceId).get();
    if (docsnap && docsnap.exists) {
        return {
            id: docsnap.id,
            data: docsnap.data()
        };
    }
    return {};
};

Model.getRemote = async (remoteId) => {
    const docsnap = await getFromFirestore('remotes', remoteId).get();
    if (docsnap && docsnap.exists) {
        return {
            id: docsnap.id,
            data: docsnap.data()
        };
    }
    return {};
};

Model.getUser = async (userId) => {
    const docsnap = await getFromFirestore('users', userId).get();
    if (docsnap && docsnap.exists) {
        return {
            id: docsnap.id,
            data: docsnap.data()
        };
    }
    return {};
};

Model.getGroup = async (groupId) => {
    const docsnap = await getFromFirestore('groups', groupId).get();
    if (docsnap && docsnap.exists) {
        return {
            id: docsnap.id,
            data: docsnap.data()
        };
    }
    return {};
};

Model.getCommands = async (indivDeviceId) => {
    const snap = await getFromDatabase('commands', indivDeviceId);
    return {
        id: indivDeviceId,
        data: snap.val()
    };
};

Model.setCommands = (indivDeviceId, commandData) => {
    return admin.database().ref('commands/' + indivDeviceId).set(commandData);
};

Model.getStates = async (indivDeviceId) => {
    const snap = await getFromDatabase('states', indivDeviceId);
    return {
        id: indivDeviceId,
        data: snap.val()
    };
};

Model.setStates = (indivDeviceId, statesData) => {
    return admin.database().ref('states/' + indivDeviceId).update(statesData);
};

Model.getGroupDevicesByUserId = async (userId) => {
    const querysnap = await admin.firestore().collection('groups').select(userId).get();
    const groupDevicePromises = [];
    querysnap.forEach((docsnap) => {
        if (docsnap && docsnap.exists)
            groupDevicePromises.push(Model.getGroupDevices(docsnap.id));
    });
    return Promise.all(groupDevicePromises);
};

module.exports = Model;
