#!/usr/bin/env python
import os, sys, types
import argparse
import firebase_admin
from firebase_admin import credentials,firestore
import pprint
import json

class BaseCollection(object):
    collectionRootPath = None
    def __init__(self, client, args):
        self.client = client
        self.args = args
    def getSubCollectionRef(self, docsnap):
        for subcollectionPath in self.client._firestore_api.list_collection_ids(docsnap.reference._document_path):
            docpath = list(docsnap.reference._path)
            docpath.append(subcollectionPath)
            yield self.getCollectionRef('/'.join(docpath))
    def getCollectionRef(self, collectionPath=None):
        if collectionPath is None:
            collectionPath = self.collectionRootPath
        return self.client.collection(collectionPath)
    def get_snap(self, docsnap):
        id_dict = { 'id': docsnap.id }
        data_dict = docsnap.to_dict()
        merged_dict = { **id_dict, **data_dict }
        yield { k: v.get().to_dict() if isinstance(v, firestore.DocumentReference) else v for k, v in merged_dict.items() }
    def get(self, dockey=None):
        collectionref = self.getCollectionRef()
        docsnaps = []
        if dockey:
            docsnaps = [ self.getCollectionRef().document(dockey).get() ]
        else:
            docsnaps = self.getCollectionRef().get()
        for docsnap in docsnaps:
            yield self.get_snap(docsnap)

    def add(self, docdata={}):
        try:
            update_time, docref = self.client.collection(self.collectionRootPath).add(docdata)
            if update_time:
                sys.stdout.write("{} was added\n".format(self.collectionRootPath + '/' + docref.id))
            else:
                raise ValueError('data add failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return docref
    def delete(self, dockey):
        try:
            docref = self.client.collection(self.collectionRootPath).document(dockey)
            if(docref.get().exists):
                times = docref.delete()
                if times:
                    sys.stdout.write("{} was deleted\n".format(self.collectionRootPath + '/' + dockey))
            else:
                raise ValueError('{} delete failed'.format(self.collectionRootPath + '/' + dockey))
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return
class Device(BaseCollection):
    collectionRootPath = 'devices'
class Remote(BaseCollection):
    collectionRootPath = 'remotes'
class User(BaseCollection):
    collectionRootPath = 'users'
class Group(BaseCollection):
    collectionRootPath = 'groups'
class UserDevice(BaseCollection):
    collectionRootPath = 'user_devices'
class GroupDevice(BaseCollection):
    collectionRootPath = 'group_devices'

class GetDevice(Device):
    arguments = (
        ('--device-id',     str,    False),
        ('--full',          bool,   False),
    )
    def run(self):
        device_id = self.args.device_id
        show_full = self.args.full
        device_info = {}
        for device in self.get(device_id):
            device_basic_info = None
            for dev in device:
                device_id = dev['id']
                del dev['id']
                if show_full:
                    pprint.pprint({device_id: dev})
                else:
                    device_name = dev['manufacturer'] + ' ' + dev['model']
                    if 'name' in dev:
                        device_name = dev['name']
                    print("{device_id}        {device_name}".format(device_id=device_id, device_name=device_name))
        return

class AddDevice(Device):
    arguments = (
        ('--manufacturer',  str,    True),
        ('--model',         str,    True),
        ('--traits',        list,   True),
        ('--type',          str,    True),
        ('--report-state',  bool,   False),
        ('--name',          str,    False),
    )
    def run(self):
        device_manufacturer = self.args.manufacturer
        device_model = self.args.model
        device_traits = self.args.traits
        device_type = self.args.type
        device_report_state = self.args.report_state
        device_name = self.args.name
        docdata = {
            'manufacturer': device_manufacturer,
            'model': device_model,
            'type': device_type,
            'willReportState': device_report_state,
            'traits': device_traits,
        }
        if device_name:
            docdata['name'] = device_name
        self.add(docdata)
        return

class DelDevice(Device):
    arguments = (
        ('--device-id',     str,    True),
    )
    def run(self):
        device_id = self.args.device_id
        self.delete(device_id)
        return

class GetDeviceAttribute(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--attr-name',     str,    False),
        ('--full',          bool,   False),
    )
    def run(self):
        device_id = self.args.device_id
        attr_name = self.args.attr_name
        show_full = self.args.full
        for device in self.get(device_id):
            for dev in device:
                if 'attributes' not in dev:
                    continue
                if attr_name in dev['attributes']:
                    show_attrs = { attr_name: dev['attributes'][attr_name] }
                else:
                    show_attrs = dev['attributes']
                pprint.pprint(show_attrs)

class AddDeviceAttribute(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--attr-name',     str,    True),
        ('--attr-data',     str,    True),
    )
    def run(self):
        device_id = self.args.device_id
        attr_name = self.args.attr_name
        attr_data = self.args.attr_data
        attr_data = json.load(attr_data)
        docdata = {
            'attributes' : { attr_name: attr_data }
        }
        update_time = self.client.collection(self.collectionRootPath).document(device_id).update(docdata)
        return

class DelDeviceAttribute(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--attr-name',     str,    True),
    )

class GetRemote(Remote):
    arguments = (
        ('--remote-id',     str,    False),
        ('--full',          bool,   False),
    )
    def run(self):
        remote_id = self.args.remote_id
        show_full = self.args.full
        for remote in self.get(remote_id):
            for r in remote:
                remote_id = r['id']
                del r['id']
                if show_full:
                    pprint.pprint({remote_id: r})
                else:
                    remote_name = r['mac_addr']
                    remote_type = r['type']
                    if 'name' in r:
                        remote_name = r['name']
                    print("{remote_id}    {remote_type}    {remote_name}".format(remote_id=remote_id, remote_name=remote_name, remote_type=remote_type))
        return

class AddRemote(Remote):
    arguments = (
        ('--mac-addr',      str,    True),
        ('--remote-type',   str,    True),
        ('--name',          str,    False),
    )
    def run(self):
        remote_macaddr = self.args.mac_addr
        remote_type = self.args.remote_type
        remote_name = self.args.name
        docdata = {
            'mac_addr': remote_macaddr,
            'type': remote_type
        }
        if remote_name:
            docdata['name'] = remote_name
        self.add(docdata)
        return

class DelRemote(Remote):
    arguments = (
        ('--remote-id',      str,    True),
    )
    def run(self):
        remote_id = self.args.remote_id
        self.delete(remote_id)
        return

class GetRemoteCode(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--remote-type',   str,    True),
    )
    def run(self):
        device_id = self.args.device_id
        remote_type = self.args.remote_type
        remote_collection = '/'.join((self.collectionRootPath, device_id, remote_type))
        for docsnap in self.getCollectionRef(remote_collection).get():
            action = docsnap.id
            for remote in self.get_snap(docsnap):
                del remote['id']
                pprint.pprint({action: remote})
        return

class AddRemoteCode(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--remote-type',   str,    True),
        ('--action',        str,    True),
        ('--values',        list,   True),
    )
    def run(self):
        device_id = self.args.device_id
        remote_type = self.args.remote_type
        remotecode_action = self.args.action
        remotecode_values = self.args.values
        try:
            docref = self.client.collection(self.collectionRootPath).document(device_id).collection(remote_type).document(remotecode_action)
            for v in remotecode_values:
                if '=' not in v:
                    raise ValueError('{} value separated with "=" was required'.format(v))
                kv,vv = v.split('=')
                if kv is None or vv is None:
                    raise ValueError('{} value with key and value was required'.format(v))
                try:
                    docref.get()
                    update_time = self.client.collection(self.collectionRootPath).document(device_id).collection(remote_type).document(remotecode_action).update({kv: vv})
                except:
                    update_time = self.client.collection(self.collectionRootPath).document(device_id).collection(remote_type).add({kv: vv}, remotecode_action)
                if update_time:
                    cpath = [self.collectionRootPath, device_id, remote_type, remotecode_action, remotecode_values]
                    cpath = [ str(i) for i in cpath ]
                    sys.stdout.write("{} was added\n".format('/'.join(cpath)))
                else:
                    raise ValueError('data add failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return

class DelRemoteCode(Device):
    arguments = (
        ('--device-id',     str,    True),
        ('--remote-type',   str,    True),
        ('--action',        str,    True),
    )
    def run(self):
        device_id = self.args.device_id
        remote_type = self.args.remote_type
        remotecode_action = self.args.action
        try:
            docref = self.client.collection(self.collectionRootPath).document(device_id).collection(remote_type).document(remotecode_action)
            if(not docref.get().exists):
                return
            times = docref.delete()
            cpath = [self.collectionRootPath, device_id, remote_type, remotecode_action]
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

class GetUser(User):
    arguments = (
        ('--user-id',       str,    False),
        ('--full',          bool,    False),
    )
    def run(self):
        user_id = self.args.user_id
        show_full = self.args.full
        for user in self.get(user_id):
            for u in user:
                user_id = u['id']
                del u['id']
                if show_full:
                    pprint.pprint({user_id: u})
                else:
                    user_name = u['name']
                    print("{user_id}    {user_name}".format(user_id=user_id, user_name=user_name))
        return


class AddUser(User):
    arguments = (
        ('--name',          str,    False),
    )
    def run(self):
        user_name = self.args.name
        docdata = {}
        if user_name:
            docdata['name'] = user_name
        docref = self.add(docdata)
        try:
            update_time = docref.update({ 'id': docref.id })
            if update_time is None:
                raise ValueError('id update failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return;

class DelUser(User):
    arguments = (
        ('--user-id',       str,    True),
    )
    def run(self):
        user_id = self.args.user_id
        self.delete(user_id)
        return

class GetGroup(Group):
    arguments = (
        ('--group-id',      str,    False),
        ('--full',          bool,   False),
    )
    def run(self):
        group_id = self.args.group_id
        show_full = self.args.full
        for group in self.get(group_id):
            for g in group:
                group_id = g['id']
                del g['id']
                if show_full:
                    pprint.pprint({group_id: g})
                else:
                    print(group_id)
                    for user_id, u in g.items():
                        print("    {user_id}".format(user_id=user_id))
        return

class AddGroup(Group):
    arguments = (
        ('--user-id',        list,    True),
    )
    def run(self):
        user_ids = self.args.user_id
        docdata = {}
        if user_ids:
            for user_id in user_ids:
                userref = self.client.collection(User.collectionPath).document(user_id)
                if userref is None:
                    continue
                docdata[user_id] = userref
        self.add(docdata)
        return

class DelGroup(Group):
    arguments = (
        ('--group-id',      str,    True),
    )
    def run(self):
        group_id = self.args.group_id
        self.delete(group_id)
        return

class GetUserDevice(UserDevice):
    arguments = (
        ('--user-device-id',    str,    False),
        ('--user-id',           str,    False),
        ('--full',              bool,    False),
    )
    def run(self):
        user_device_id = self.args.user_device_id
        user_id = self.args.user_id
        show_full = self.args.full
        for udevice in self.get(user_device_id):
            for ud in udevice:
                user_device_id = ud['id']
                del ud['id']
                if user_id and user_id not in ud:
                    continue
                if show_full:
                    print({user_device_id: ud})
                else:
                    device_id = ud['deviceId']
                    remote_id = ud['remoteId']
                    user_device_name = ud['name']
                    print("{user_device_id}    {device_id}    {remote_id}    {user_device_name}".format(user_device_id=user_device_id, device_id=device_id, remote_id=remote_id, user_device_name=user_device_name))
        return


class AddUserDevice(UserDevice):
    arguments = (
        ('--device-id',     str,    True),
        ('--user-id',       str,    True),
        ('--remote-id',     str,    True),
        ('--name',          str,    False),
    )
    def run(self):
        device_id = self.args.device_id
        user_id = self.args.user_id
        remote_id = self.args.remote_id
        user_device_name = self.args.name
        deviceReference = self.client.collection(Devices.collectionPath).document(device_id)
        if deviceReference is None:
            sys.stderr.write("{} cannot referenced, check Devices\n".format(deviceId))
            sys.exit(1)
        userReference  = self.client.collection(User.collectionPath).document(user_id)
        if userReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(userId))
            sys.exit(1)
        remoteReference = self.client.collection(Remotes.collectionPath).document(remote_id)
        if remoteReference is None:
            sys.stderr.write("{} cannot referenced, check Remotes\n".format(remoteId))
            sys.exit(1)
        docdata = {
            'deviceId': device_id,
            'userId' : user_id,
            'remoteId': remote_id,
            'deviceReference': deviceReference,
            'userReference' : userReference,
            'remoteReference': remoteReference
        }
        if user_device_name:
            docdata['name'] = user_device_name
        self.add(docdata)
        return

class DelUserDevice(UserDevice):
    arguments = (
        ('--user-device-id',    str,    True),
    )
    def run(self):
        user_device_id = self.args.user_device_id
        self.delete(user_device_id)
        return

class GetGroupDevice(GroupDevice):
    arguments = (
        ('--group-device-id',   str,    False),
        ('--group-id',          str,    False),
        ('--full',              bool,    False),
    )
    def run(self):
        group_device_id = self.args.group_device_id
        group_id = self.args.group_id
        show_full = self.args.full
        for gdevice in self.get(group_device_id):
            for gd in gdevice:
                group_device_id = gd['id']
                del gd['id']
                if group_id and group_id not in gd:
                    continue
                if show_full:
                    print({group_device_id: gd})
                else:
                    device_id = gd['deviceId']
                    remote_id = gd['remoteId']
                    group_device_name = gd['name']
                    print("{group_device_id}    {device_id}    {remote_id}    {group_device_name}".format(group_device_id=group_device_id, device_id=device_id, remote_id=remote_id, group_device_name=group_device_name))
        return


class AddGroupDevice(GroupDevice):
    arguments = (
        ('--device-id',     str,    True),
        ('--group-id',      str,    True),
        ('--remote-id',     str,    True),
        ('--name',          str,    False),
    )
    def run(self):
        device_id = self.args.device_id
        group_id = self.args.group_id
        remote_id = self.args.remote_id
        group_device_name = self.args.name
        deviceReference = self.client.collection(Devices.collectionPath).document(device_id)
        if deviceReference is None:
            sys.stderr.write("{} cannot referenced, check Devices\n".format(deviceId))
            sys.exit(1)
        groupReference  = self.client.collection(Groups.collectionPath).document(group_id)
        if groupReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(groupId))
            sys.exit(1)
        remoteReference = self.client.collection(Remotes.collectionPath).document(remote_id)
        if remoteReference is None:
            sys.stderr.write("{} cannot referenced, check Remotes\n".format(remoteId))
            sys.exit(1)
        docdata = {
            'deviceId': device_id,
            'groupId' : group_id,
            'remoteId': remote_id,
            'deviceReference': deviceReference,
            'groupReference' : groupReference,
            'remoteReference': remoteReference
        }
        if group_device_name:
            docdata['name'] = group_device_name
        self.add(docdata)
        return

class DelGroupDevice(GroupDevice):
    arguments = (
        ('--group-device-id',   str,    True),
    )
    def run(self):
        group_device_id = self.args.group_device_id
        self.delete(group_device_id)
        return

def get_client(serviceAccountKeyFile=None):
    default_serviceAccountKeyFile = os.path.join(os.getcwd(), 'serviceAccountKey.json')
    if(serviceAccountKeyFile is None):
        serviceAccountKeyFile = default_serviceAccountKeyFile
    cred = credentials.Certificate(serviceAccountKeyFile)
    app = firebase_admin.initialize_app(cred)
    return firestore.client(app)

if __name__ == '__main__':
    mode_class = {
        'get_device': GetDevice,
        'get_device_attr': GetDeviceAttribute,
        'get_remote': GetRemote,
        'get_remote_code': GetRemoteCode,
        'get_user': GetUser,
        'get_group': GetGroup,
        'get_user_device': GetUserDevice,
        'get_group_device': GetGroupDevice,
        'add_device': AddDevice,
        'add_device_attr': AddDeviceAttribute,
        'add_remote': AddRemote,
        'add_remote_code': AddRemoteCode,
        'add_user': AddUser,
        'add_group': AddGroup,
        'add_user_device': AddUserDevice,
        'add_group_device': AddGroupDevice,
        'del_device': DelDevice,
        'del_device_attr': DelDeviceAttribute,
        'del_remote': DelRemote,
        'del_remote_code': DelRemoteCode,
        'del_user': DelUser,
        'del_group': DelGroup,
        'del_user_device': DelUserDevice,
        'del_group_device': DelGroupDevice,
    }

    p = argparse.ArgumentParser()
    subp = p.add_subparsers(help='sub-command help', dest='mode')
    for k, v in mode_class.items():
        pp = subp.add_parser(k, help='see `{} -h`'.format(k))
        for vv in v.arguments:
            argname, argtype, argrequire = vv
            if argtype == list:
                pp.add_argument(argname, required=argrequire, action='append')
            elif argtype == bool:
                pp.add_argument(argname, required=argrequire, action='store_true')
            else:
                pp.add_argument(argname, type=argtype, required=argrequire)

    args, opts = p.parse_known_args()
    client = get_client()
    c = mode_class[args.mode](client, args)
    c.run()
    sys.exit(0)
