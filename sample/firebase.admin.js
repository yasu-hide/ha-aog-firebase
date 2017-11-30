const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://<プロジェクト名>.firebaseio.com"
});

const getFromFirestore = (collection, doc) => {
    return admin.firestore().collection(collection).doc(doc).get();
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
        throw new Error('personal required');
    }
    return admin.firestore().collection(personal).where(personalId_key, '==', personalId).get().then((querysnap) => {
        const devicePromises = [];
        querysnap.forEach((docsnap) => {
            const docdata = docsnap.data();
            if(!docdata.deviceId && !docdata.deviceReference) {
                console.error('require deviceId or deviceReference in group_devices.');
                return {};
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
    return getFromFirestore('devices', deviceId).then((docsnap) => {
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
    return getFromFirestore('remotes', remoteId).then((docsnap) => {
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
    return getFromFirestore('users', userId).then((docsnap) => {
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
    return getFromFirestore('groups', groupId).then((docsnap) => {
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
        return snap.val();
    });
};
Model.setCommands = (indivDeviceId, commandData) => {
    return admin.database().ref('commands/' + indivDeviceId).set(commandData);
};
Model.getStates = (indivDeviceId) => {
    return getFromDatabase('states', indivDeviceId).then((snap) => {
        return snap.val();
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
Model.getDeviceByPersonalDeviceId = (personalDeviceId) => {
    if(!personalDeviceId) {
        console.error('personalDeviceId is required');
        return Promise.reject('personalDeviceId is required');
    }
    const groupDocsnap = admin.firestore().collection('group_devices').doc(personalDeviceId).get();
    const userDocsnap = admin.firestore().collection('user_devices').doc(personalDeviceId).get();
    return Promise.all([groupDocsnap, userDocsnap]).then(([groupDevice, userDevice]) => {
        const groupDeviceExist = (groupDevice && groupDevice.exists);
        const userDeviceExist = (userDevice && userDevice.exists);
        if(groupDeviceExist && userDeviceExist) {
            throw new Error('data consistency error');
        }
        if(groupDeviceExist) {
            return groupDevice.data();
        }
        if(userDeviceExist) {
            return userDevice.data();
        }
    }).then((deviceData) => {
        let deviceReference, remoteReference;
        if(!deviceData.deviceId && !deviceData.deviceReference) {
            throw new Error('data consistency error');
        }
        if(!deviceData.remoteId && !deviceData.remoteReference) {
            throw new Error('data consistency error');
        }
        if(deviceData.deviceReference) {
            deviceReference = deviceData.deviceReference.get();
        } else {
            deviceReference = Model.getDevice(deviceData.deviceId);
        }
        if(deviceData.remoteReference) {
            remoteReference = deviceData.remoteReference.get();
        } else {
            remoteReference = Model.getRemote(deviceData.remoteId);
        }
        return {
            name: deviceData.name,
            device: deviceReference,
            remote: remoteReference
        };
    }).catch(console.error);
};
exports.admin = admin;
exports.Model = Model;
