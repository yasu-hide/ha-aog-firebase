#!/usr/bin/env python
import os, sys
import argparse
import firebase_admin
from firebase_admin import credentials,firestore
import pprint

class BaseCollection(object):
    collectionPath = None
    element = None
    argparse = argparse.ArgumentParser()
    def __init__(self, client, arguments={}):
        self.client = client
        self.collection = None
    def getSubCollectionRef(self, docsnap):
        for subcollectionPath in self.client._firestore_api.list_collection_ids(docsnap.reference._document_path):
            docpath = list(docsnap.reference._path)
            docpath.append(subcollectionPath)
            yield self.getCollectionRef('/'.join(docpath))
    def getCollectionRef(self, collectionPath=None):
        if collectionPath is None:
            collectionPath = self.collectionPath
        return self.client.collection(collectionPath)
    def get(self):
        for docsnap in self.getCollectionRef().get():
            yield { k: v.get().to_dict() if isinstance(v, firestore.DocumentReference) else v for dic in [ { 'id': docsnap.id }, docsnap.to_dict() ] for k, v in dic.items() }
    def add(self, opts=[]):
        raise Exception("Virtual Method")
    def add_to_db(self, docdata={}):
        try:
            update_time, docref = self.client.collection(self.collectionPath).add(docdata)
            if update_time:
                sys.stdout.write("{} was added\n".format(self.collectionPath + '/' + docref.id))
            else:
                raise ValueError('data add failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return docref
    def rm_from_db(self, dockey):
        try:
            docref = self.client.collection(self.collectionPath).document(dockey)
            if(docref.get().exists):
                times = docref.delete()
                if times:
                    sys.stdout.write("{} was deleted\n".format(self.collectionPath + '/' + dockey))
            else:
                raise ValueError('{} delete failed'.format(self.collectionPath + '/' + dockey))
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return

class Devices(BaseCollection):
    collectionPath = 'devices'
    def get(self, collectionRef=None):
        if collectionRef is None:
            collectionRef = self.getCollectionRef()
        for docsnap in collectionRef.get():
            device = { k: v.get().to_dict() if isinstance(v, firestore.DocumentReference) else v for dic in [ { 'id': docsnap.id }, docsnap.to_dict() ] for k, v in dic.items() }
            for subcollection in self.getSubCollectionRef(docsnap):
                device[subcollection.id] = [ x for x in self.get(subcollection) ]
            yield device
    def add(self, opts=[]):
        self.argparse.add_argument('--manufacturer', required=True)
        self.argparse.add_argument('--model', required=True)
        self.argparse.add_argument('--type', required=True)
        self.argparse.add_argument('--willReportState', action='store_true')
        self.argparse.add_argument('--traits', required=True, action='append')
        self.argparse.add_argument('--name')
        args = self.argparse.parse_args(opts)
        docdata = {
            'manufacturer': args.manufacturer,
            'model': args.model,
            'type': args.type,
            'willReportState': args.willReportState,
            'traits': args.traits
        }
        if args.name:
            docdata['name'] = args.name
        self.add_to_db(docdata)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--device-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.device_id)
        return

class GroupDevices(BaseCollection):
    collectionPath = 'group_devices'
    def add(self, opts=[]):
        self.argparse.add_argument('--device-id', required=True)
        self.argparse.add_argument('--group-id', required=True)
        self.argparse.add_argument('--remote-id', required=True)
        self.argparse.add_argument('--name')
        args = self.argparse.parse_args(opts)
        deviceReference = self.client.collection(Devices.collectionPath).document(args.device_id)
        if deviceReference is None:
            sys.stderr.write("{} cannot referenced, check Devices\n".format(deviceId))
            sys.exit(1)
        groupReference  = self.client.collection(Groups.collectionPath).document(args.group_id)
        if groupReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(groupId))
            sys.exit(1)
        remoteReference = self.client.collection(Remotes.collectionPath).document(args.remote_id)
        if remoteReference is None:
            sys.stderr.write("{} cannot referenced, check Remotes\n".format(remoteId))
            sys.exit(1)
        docdata = {
            'deviceId': args.device_id,
            'groupId' : args.group_id,
            'remoteId': args.remote_id,
            'deviceReference': deviceReference,
            'groupReference' : groupReference,
            'remoteReference': remoteReference
        }
        if args.name:
            docdata['name'] = args.name
        self.add_to_db(docdata)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--group-device-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.group_device_id)
        return

class Groups(BaseCollection):
    collectionPath = 'groups'
    def add(self, opts=[]):
        self.argparse.add_argument('--user-id', required=True, action='append')
        args = self.argparse.parse_args(opts)
        docdata = {}
        if args.user_id:
            for userId in args.user_id:
                userRef = self.client.collection(Users.collectionPath).document(userId)
                if userRef is None:
                    continue
                docdata[userId] = userRef
        self.add_to_db(docdata)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--group-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.group_id)
        return

class Remotes(BaseCollection):
    collectionPath = 'remotes'
    def add(self, opts=[]):
        self.argparse.add_argument('--mac-addr', required=True)
        self.argparse.add_argument('--type', required=True)
        self.argparse.add_argument('--name')
        args = self.argparse.parse_args(opts)
        docdata = {
            'mac_addr': args.mac_addr,
            'type': args.type
        }
        if args.name:
            docdata['name'] = args.name
        self.add_to_db(docdata)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--remote-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.remote_id)
        return

class RemoteCodes(BaseCollection):
    collectionPath = 'devices'
    def add(self, opts=[]):
        self.argparse.add_argument('--device-id', required=True)
        self.argparse.add_argument('--remote-type', required=True)
        self.argparse.add_argument('--action', required=True)
        self.argparse.add_argument('--values', required=True, action='append')
        args = self.argparse.parse_args(opts)
        try:
            docref = self.client.collection(self.collectionPath).document(args.device_id).collection(args.remote_type).document(args.action)
            for v in args.values:
                if '=' not in v:
                    raise ValueError('{} value separated with "=" was required'.format(v))
                kv,vv = v.split('=')
                if kv is None or vv is None:
                    raise ValueError('{} value with key and value was required'.format(v))
                try:
                    docref.get()
                    update_time = self.client.collection(self.collectionPath).document(args.device_id).collection(args.remote_type).document(args.action).update({kv: vv})
                except:
                    update_time = self.client.collection(self.collectionPath).document(args.device_id).collection(args.remote_type).add({kv: vv}, args.action)
                if update_time:
                    cpath = [self.collectionPath, args.device_id, args.remote_type, args.action, args.values]
                    cpath = [ str(i) for i in cpath ]
                    sys.stdout.write("{} was added\n".format('/'.join(cpath)))
                else:
                    raise ValueError('data add failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--device-id', required=True)
        self.argparse.add_argument('--remote-type', required=True)
        self.argparse.add_argument('--action', required=True)
        self.argparse.add_argument('--remove-action', action='store_true')
        self.argparse.add_argument('--value-key')
        args = self.argparse.parse_args(opts)
        try:
            docref = self.client.collection(self.collectionPath).document(args.device_id).collection(args.remote_type).document(args.action)
            if(docref.get().exists):
                times = None
                if args.remove_action:
                    times = docref.delete()
                    cpath = [self.collectionPath, args.device_id, args.remote_type, args.action]
                elif args.value_key:
                    times = docref.update({ args.value_key: firestore.DELETE_FIELD })
                    cpath = [self.collectionPath, args.device_id, args.remote_type, args.action, args.value_key]
                cpath = [ str(i) for i in cpath ]
                if times:
                    sys.stdout.write("{} was deleted\n".format('/'.join(cpath)))
                else:
                    raise ValueError('{} delete failed'.format('/'.join(cpath)))
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return

class UserDevices(BaseCollection):
    collectionPath = 'user_devices'
    def add(self, opts=[]):
        self.argparse.add_argument('--device-id', required=True)
        self.argparse.add_argument('--user-id', required=True)
        self.argparse.add_argument('--remote-id', required=True)
        self.argparse.add_argument('--name')
        args = self.argparse.parse_args(opts)
        deviceReference = self.client.collection(Devices.collectionPath).document(args.device_id)
        if deviceReference is None:
            sys.stderr.write("{} cannot referenced, check Devices\n".format(deviceId))
            sys.exit(1)
        userReference  = self.client.collection(Users.collectionPath).document(args.user_id)
        if userReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(userId))
            sys.exit(1)
        remoteReference = self.client.collection(Remotes.collectionPath).document(args.remote_id)
        if remoteReference is None:
            sys.stderr.write("{} cannot referenced, check Remotes\n".format(remoteId))
            sys.exit(1)
        docdata = {
            'deviceId': args.device_id,
            'userId' : args.user_id,
            'remoteId': args.remote_id,
            'deviceReference': deviceReference,
            'userReference' : userReference,
            'remoteReference': remoteReference
        }
        if args.name:
            docdata['name'] = args.name
        self.add_to_db(docdata)
        return
    def delete(self, opts=[]):
        self.argparse.add_argument('--user-device-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.user_device_id)
        return

class Users(BaseCollection):
    collectionPath = 'users'
    def add(self, opts=[]):
        self.argparse.add_argument('--name')
        args = self.argparse.parse_args(opts)
        docdata = {}
        if args.name:
            docdata['name'] = args.name
        docref = self.add_to_db(docdata)
        try:
            update_time = docref.update({ 'id': docref.id })
            if update_time is None:
                raise ValueError('id update failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return;
    def delete(self, opts=[]):
        self.argparse.add_argument('--user-id', required=True)
        args = self.argparse.parse_args(opts)
        self.rm_from_db(args.user_id)
        return

def get_client(serviceAccountKeyFile=None):
    default_serviceAccountKeyFile = os.path.join(os.getcwd(), 'serviceAccountKey.json')
    if(serviceAccountKeyFile is None):
        serviceAccountKeyFile = default_serviceAccountKeyFile
    cred = credentials.Certificate(serviceAccountKeyFile)
    app = firebase_admin.initialize_app(cred)
    return firestore.client(app)

if __name__ == '__main__':
    mode2class = {
        'device': Devices,
        'remote': Remotes,
        'remote_code': RemoteCodes,
        'user': Users,
        'group': Groups,
        'user_device': UserDevices,
        'group_device': GroupDevices,
    }

    p = argparse.ArgumentParser()
    choices = list(mode2class.keys())
    subp = p.add_subparsers(help='sub-command help', dest='mode')
    pget = subp.add_parser('get', help='see `get -g`')
    pget.add_argument('submode', choices=choices)

    padd = subp.add_parser('add', help='see `add -a`')
    padd.add_argument('submode', choices=choices)

    pdel = subp.add_parser('rm', help='see `rm -r`')
    pdel.add_argument('submode', choices=choices)

    args, opts = p.parse_known_args()

    client = get_client()
    c = mode2class[args.submode]
    pp = pprint.PrettyPrinter()
    if args.mode == 'get':
        pp.pprint([ x for x in c(client).get()])
    elif args.mode == 'add':
        c(client).add(opts)
    elif args.mode == 'rm':
        c(client).delete(opts)
    sys.exit(0)
