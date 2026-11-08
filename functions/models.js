'use strict';

const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

const getFromFirestore = (collection, doc) => {
    return getFirestore().collection(collection).doc(doc);
};

const getFromDatabase = (refkey, pkey) => {
    return getDatabase().ref(refkey + '/' + pkey).once('value');
};

const Model = {};

const getPersonalDevices = async (personal, personalId) => {
    let personalId_key;
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

    const querysnap = await getFirestore().collection(personal).where(personalId_key, '==', personalId).get();

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
    return getDatabase().ref('commands/' + indivDeviceId).set(commandData);
};

Model.getStates = async (indivDeviceId) => {
    const snap = await getFromDatabase('states', indivDeviceId);
    return {
        id: indivDeviceId,
        data: snap.val()
    };
};

Model.setStates = (indivDeviceId, statesData) => {
    return getDatabase().ref('states/' + indivDeviceId).update(statesData);
};

Model.getGroupDevicesByUserId = async (userId) => {
    // groups ドキュメントはメンバーのユーザーIDを項目名に持つ。select() は射影で絞り込まないため where で絞る。
    // ユーザーIDに '.' などが含まれても1つの項目名として扱うよう FieldPath を使う。
    const querysnap = await getFirestore().collection('groups').where(new FieldPath(userId), '!=', null).select().get();
    const groupDevicePromises = [];
    querysnap.forEach((docsnap) => {
        if (docsnap && docsnap.exists)
            groupDevicePromises.push(Model.getGroupDevices(docsnap.id));
    });
    return Promise.all(groupDevicePromises);
};

// Firestore のドキュメントID / RTDB のキーとして安全に使える ID か ('/' によるパス操作を防ぐ)
// Firestore 予約 ID (__.*__) と 1500 バイト超の ID も拒否する (500 ではなく未所有として扱う)
const isSafeId = (id) => typeof id === 'string' && id !== '' && !id.includes('/') && id !== '.' && id !== '..'
    && !/^__.*__$/.test(id) && Buffer.byteLength(id) <= 1500;

// グループ groupId に uid のメンバー項目 (null 以外) があるか。groupCache は groupId -> Promise で、
// 同一リクエスト内のグループ読み取りを1回にまとめる。
const isGroupMember = (uid, groupId, groupCache) => {
    if (!isSafeId(groupId)) {
        return Promise.resolve(false);
    }
    if (!groupCache.has(groupId)) {
        groupCache.set(groupId, getFromFirestore('groups', groupId).get().then((docsnap) => {
            if (!docsnap || !docsnap.exists) {
                return false;
            }
            const data = docsnap.data() || {};
            return Object.prototype.hasOwnProperty.call(data, uid) && data[uid] != null;
        }));
    }
    return groupCache.get(groupId);
};

// uid のユーザーが deviceId (user_devices / group_devices のドキュメントID) にアクセスできるか。
Model.userOwnsDevice = async (uid, deviceId, groupCache = new Map()) => {
    if (!isSafeId(uid) || !isSafeId(deviceId)) {
        return false;
    }
    const [usersnap, groupsnap] = await Promise.all([
        getFromFirestore('user_devices', deviceId).get(),
        getFromFirestore('group_devices', deviceId).get()
    ]);
    if (usersnap && usersnap.exists && usersnap.data().userId === uid) {
        return true;
    }
    if (groupsnap && groupsnap.exists) {
        return isGroupMember(uid, groupsnap.data().groupId, groupCache);
    }
    return false;
};

// リクエスト内の重複を除いた device ID ごとに所有者チェックを並列で1回ずつ行い、id -> boolean の Map を返す
Model.checkOwnership = async (uid, ids) => {
    const distinct = [...new Set(ids)];
    const groupCache = new Map();
    const owned = await Promise.all(distinct.map((id) => Model.userOwnsDevice(uid, id, groupCache)));
    return new Map(distinct.map((id, i) => [id, owned[i]]));
};

module.exports = Model;
