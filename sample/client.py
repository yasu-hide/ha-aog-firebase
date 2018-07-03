#!/usr/bin/env python3
import os, sys, types
import argparse
import firebase_admin
from firebase_admin import credentials,firestore
import pprint
import json, urllib.request

## List Device Traits, see https://developers.google.com/actions/smarthome/traits/
DEVICE_TRAITS_PREFIX = 'action.devices.traits.'
DEVICE_COMMANDS_PREFIX = 'action.devices.commands.'
DEVICE_TRAITS = {
    'Brightness': {
        'description': '''Absolute brightness setting is in a normalized range from 0 to 100 (individual lights may not support every point in the range based on their LED configuration).''',
        'language': [ 'en', 'de', 'fr', 'ja', 'it' ],
        'commands': [
            'BrightnessAbsolute'
        ]
    },
    'CameraStream': {
        'description': '''This trait belongs to devices which have the capability to stream video feeds to third party screens, Chromecast-connected screens or an Android phone. By and large, these are currently security cameras or baby cameras. But this would also apply to more complex devices which have a camera on them (for example, video-conferencing robotics/devices or a vacuum robot with a camera on it).''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'GetCameraStream'
        ]
    },
    'ColorSpectrum': {
        'description': '''This applies to "full" color bulbs that take RGB color ranges. Lights may have any combination of ColorSpectrum and ColorTemperature; accent lights and LED strips may just have Spectrum, whereas some reading bulbs just have Temperature. Basic bulbs, or dumb lights on smart plugs, have neither.''',
        'language': [ 'en', 'de', 'fr', 'ja', 'it' ],
        'commands': [
            'ColorAbsolute'
        ]
    },
    'ColorTemperature': {
        'description': '''This applies to "warmth" bulbs that take a color point in Kelvin. This is generally a separate modality from ColorSpectrum, and there may be white points available via Temperature that cannot be reached by Spectrum. Based on available traits, Google may pick the appropriate mode to use based on request and light type (for example, Make the living room lights white might send Temperature commands to some bulbs and Spectrum commands to LED strips).''',
        'language': [ 'en', 'de', 'fr', 'ja', 'it' ],
        'commands': [
            'ColorAbsolute'
        ]
    },
    'Dock': {
        'description': '''This trait is designed for self-mobile devices that can be commanded to return for charging.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'Dock'
        ]
    },
    'FanSpeed': {
        'description': '''This trait belongs to devices that support setting the speed of a fan (that is, blowing air from the device at various levels, which may be part of an air conditioning or heating unit, or in a car), with settings such as low, medium, and high.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'SetFanSpeed',
            'Reverse'
        ]
    },
    'Locator': {
        'description': '''This trait is used for devices that can be "found". This includes phones, robots (including vacuums and mowers), drones, and tag-specific products that attach to other devices.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'Locate'
        ]
    },
    'Modes': {
        'description': '''This trait belongs to any devices with an arbitrary number of "n-way" modes in which the modes and settings for each mode are arbitrary and unique to each device or device type. Each mode has multiple possible settings, but only one can be selected at a time; a dryer cannot be in "delicate," "normal," and "heavy duty" mode simultaneously. A setting that simply can be turned on or off belongs in the Toggles trait.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'SetModes'
        ]
    },
    'OnOff': {
        'description': '''The basic on and off functionality for any device that has binary on and off, including plugs and switches as well as many future devices.''',
        'language': [ 'en', 'de', 'fr', 'ja', 'it' ],
        'commands': [
            'OnOff'
        ]
    },
    'RunCycle': {
        'description': '''This trait represents any device that has an ongoing duration for its operation which can be queried. This includes, but is not limited to, devices that operate cyclically, such as washing machines, dryers, and dishwashers.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': []
    },
    'Scene': {
        'description': '''In the case of scenes, the type maps 1': {1 to the trait, as scenes don't combine with other traits to form composite devices.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'ActivateScene'
        ]
    },
    'StartStop': {
        'description': '''Starting and stopping a device serves a similar function to turning it on and off. Devices that inherit this trait function differently when turned on and when started. Unlike devices that simply have an on and off state, some devices that can start and stop are also able to pause while performing operation.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'StartStop',
            'PauseUnpause'
        ]
    },
    'TemperatureControl': {
        'description': '''Trait for devices (other than thermostats) that support controlling temperature, either within or around the device. This includes devices such as ovens and refrigerators.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'SetTemperature'
        ]
    },
    'TemperatureSetting': {
        'description': '''This trait covers handling both temperature point and modes.''',
        'language': [ 'en', 'de', 'fr', 'ja', 'it' ],
        'commands': [
            'ThermostatTemperatureSetpoint',
            'ThermostatTemperatureSetRange',
            'ThermostatSetMode'
        ]
    },
    'Toggles': {
        'description': '''This trait belongs to any devices with settings that can only exist in one of two states. These settings can represent a physical button with an on/off or active/inactive state, a checkbox in HTML, or any other sort of specifically enabled/disabled element.''',
        'language': [ 'en', 'de', 'fr', 'ja' ],
        'commands': [
            'SetToggles'
        ]
    },
}

# List Device Types, see https://developers.google.com/actions/smarthome/guides/
DEVICE_TYPES_PREFIX = 'action.devices.types.'
DEVICE_TYPES = {
    'AC_UNIT': {
        'description': '''Air conditioning units are similar to thermostats, but do not support heating and may not support setting temperature targets, but rather rely on modes, toggles, and fan speed settings (for example, high and low).'''
    },
    'AIRPURIFIER': {
        'description': '''Air purifiers can be turned on and off and may support adjusting fan speed levels. Some may also have various toggles or modes, and each mode has its own related settings. These are specific to the air purifier and are interpreted in a generalized form.'''
    },
    'CAMERA': {
        'description': '''Cameras are complex and features will vary significantly between vendors. Over time, cameras will acquire many traits and attributes describing specific capabilities, many of which may interact with the video/audio stream in special ways, such as sending a stream to another device, identifying what's in the stream, replaying feeds, etc. As such, cameras also interact with other devices - especially screens and other media targets.'''
    },
    'COFFEE_MAKER': {
        'description': '''Interactions with coffee makers may include turning them on and off, adjusting the target temperature, and adjusting various mode settings.'''
    },
    'DISHWASHER': {
        'description': '''Dishwashers can have start and stop functionality independent from being on or off (some washers have separate power buttons, and some do not). Some can be paused and resumed while washing. Dishwashers also have various modes and each mode has its own related settings. These are specific to the dishwasher and are interpreted in a generalized form.'''
    },
    'DRYER': {
        'description': '''Dryers have start and stop functionality independent from being on or off. Some can be paused and resumed while drying. Dryers also have various modes and each mode has its own related settings. These are specific to the dryer and are interpreted in a generalized form.'''
    },
    'KETTLE': {
        'description': '''Kettles are devices that boil water. Interactions with kettles may include turning them on and off, adjusting the target temperature, and perhaps adjusting various mode settings.'''
    },
    'LIGHT': {
        'description': '''This type indicates that the device gets the light bulb icon and some light synonyms/aliases.'''
    },
    'OUTLET': {
        'description': '''This type indicates that the device gets the plug icon and some outlet synonyms/aliases.'''
    },
    'OVEN': {
        'description': '''Interaction with ovens involves the ability to bake or broil at certain temperatures. The physical temperature inside the oven differs as the oven is heating, so this may also be monitored. The oven has a cook time that limits the duration of baking.'''
    },
    'REFRIGERATOR': {
        'description': '''This type indicates that the device gets the appropriate icon and some refrigerator synonyms/aliases. Refrigerators are temperature-managing devices which may have various modes/settings.'''
    },
    'SCENE': {
        'description': '''Scenes defined here are partner scenes, implemented as virtual devices and activated by name.'''
    },
    'SPRINKLER': {
        'description': '''Sprinklers can start and stop (or turn on and off). In the future, they may support timers and/or schedules.'''
    },
    'SWITCH': {
        'description': '''This type indicates that the device gets the switch icon and some switch synonyms/aliases.'''
    },
    'THERMOSTAT': {
        'description': '''Thermostats are temperature-managing devices, with set points and modes. This separates them from heaters and AC units which may only have modes and settings (for example, high/low) vs a temperature target.'''
    },
    'VACUUM': {
        'description': '''Vacuums can have binary modes and settings (for example, on/off and start/pause) as well as a mode to schedule cleaning sessions and a mode to charge themselves. Partners can construct their vacuum cleaner specifics using a combination of these standard modes, as well as the Dock trait to support returning for charge.'''
    },
    'WASHER': {
        'description': '''Washers can have start and stop functionality independent from being on or off (some washers have separate power buttons, and some do not). Some can be paused and resumed while washing. Washers also have various modes and each mode has its own related settings. These are specific to the washer and are interpreted in a generalized form.'''
    }
}

class BaseCollection(object):
    baseUrl = 'https://homegraph.googleapis.com'
    collectionRootPath = None
    def __init__(self, client, apikey=None):
        self.client = client
        self.apikey = apikey
    def _get_colref(self, collectionPath=None):
        if collectionPath is None:
            collectionPath = self.collectionRootPath
        return self.client.collection(collectionPath)
    def _get_doc(self, documentSnap):
        id_dict = { 'id': documentSnap.id }
        data_dict = documentSnap.to_dict()
        merged_dict = { **id_dict, **data_dict }
        yield { k: v.get().to_dict() if isinstance(v, firestore.DocumentReference) else v for k, v in merged_dict.items() }
    def _get(self, dockey=None):
        collectionref = self._get_colref()
        docsnaps = []
        if dockey:
            docsnaps = [ self._get_colref().document(dockey).get() ]
        else:
            docsnaps = self._get_colref().get()
        for docsnap in docsnaps:
            yield self._get_doc(docsnap)
    def _add(self, docdata={}):
        try:
            update_time, docref = self._get_colref().add(docdata)
            if update_time:
                sys.stdout.write("{} was added\n".format(self.collectionRootPath + '/' + docref.id))
            else:
                raise ValueError('data add failed')
        except:
            (t, e) = sys.exc_info()[:2]
            sys.stderr.write(str(e) + "\n")
            sys.exit(1)
        return docref
    def _del(self, dockey):
        try:
            docref = self._get_colref().document(dockey)
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
        return docref
    def getDeviceReference(self, device_id, checkExists=False):
        deviceReference = self._get_colref(Device.collectionRootPath).document(device_id)
        if checkExists == True and deviceReference is None:
            sys.stderr.write("{} cannot referenced, check Devices\n".format(device_id))
            sys.exit(1)
        return deviceReference
    def getGroupReference(self, group_id, checkExists=False):
        groupReference = self._get_colref(Group.collectionRootPath).document(group_id)
        if checkExists == True and groupReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(group_id))
            sys.exit(1)
        return groupReference
    def getRemoteReference(self, remote_id, checkExists=False):
        remoteReference = self._get_colref(Remote.collectionRootPath).document(remote_id)
        if checkExists == True and remoteReference is None:
            sys.stderr.write("{} cannot referenced, check Remotes\n".format(remote_id))
            sys.exit(1)
        return remoteReference
    def getUserReference(self, user_id, checkExists=False):
        userReference = self._get_colref(User.collectionRootPath).document(user_id)
        if checkExists == True and userReference is None:
            sys.stderr.write("{} cannot referenced, check Groups\n".format(userId))
            sys.exit(1)
        return userReference
    def requestSync(self, agent_user_id):
        if not self.apikey:
            return
        url = self.baseUrl + '/v1/devices:requestSync?key=' + self.apiKey
        headers = { 'Content-Type': 'application/json' }
        data = json.dumps({ 'agent_user_id' : agent_user_id }).encode()
        req = urllib.request.Request(url, data=data, method='POST', headers=headers)
        with urllib.request.urlopen(req) as res:
            return res.status, res.reason
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
        ('--device-id',     { 'type': str,    'required': False}),
        ('--full',          { 'type': bool,   'required': False}),
    )
    def run(self, args=object):
        device_id = args.device_id
        show_full = args.full
        device_info = {}
        for device in self._get(device_id):
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
        ('--manufacturer',  { 'type': str,    'required': True }),
        ('--model',         { 'type': str,    'required': True }),
        ('--traits',        { 'type': list,   'required': True, 'choices': DEVICE_TRAITS.keys() }),
        ('--type',          { 'type': str,    'required': True, 'choices': DEVICE_TYPES.keys() }),
        ('--report-state',  { 'type': bool,   'required': False }),
        ('--name',          { 'type': str,    'required': False }),
    )
    def run(self, args=object):
        device_manufacturer = args.manufacturer
        device_model = args.model
        device_traits = [ DEVICE_TRAITS_PREFIX + t for t in args.traits ]
        device_type = DEVICE_TYPES_PREFIX + args.type
        device_report_state = args.report_state
        device_name = args.name
        docdata = {
            'manufacturer': device_manufacturer,
            'model': device_model,
            'type': device_type,
            'willReportState': device_report_state,
            'traits': device_traits,
        }
        if device_name:
            docdata['name'] = device_name
        self._add(docdata)
        return

class DelDevice(Device):
    arguments = (
        ('--device-id',     { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        device_id = args.device_id
        self._del(device_id)
        return

class GetDeviceAttribute(Device):
    arguments = (
        ('--device-id',     { 'type': str,    'required': True }),
        ('--attr-name',     { 'type': str,    'required': False }),
        ('--full',          { 'type': bool,   'required': False }),
    )
    def run(self, args=object):
        device_id = args.device_id
        attr_name = args.attr_name
        show_full = args.full
        for device in self._get(device_id):
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
        ('--device-id',     { 'type': str,    'required': True }),
        ('--attr-name',     { 'type': str,    'required': True }),
        ('--attr-data',     { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        device_id = args.device_id
        attr_name = args.attr_name
        attr_data = args.attr_data
        attr_data = json.loads(attr_data)
        docdata = {
            'attributes' : { attr_name: attr_data }
        }
        update_time = self.getDeviceReference(device_id).update(docdata)
        return

class DelDeviceAttribute(Device):
    arguments = (
        ('--device-id',     { 'type': str,    'required': True }),
        ('--attr-name',     { 'type': str,    'required': True }),
    )

class GetRemote(Remote):
    arguments = (
        ('--remote-id',     { 'type': str,    'required': False }),
        ('--full',          { 'type': bool,   'required': False }),
    )
    def run(self, args=object):
        remote_id = args.remote_id
        show_full = args.full
        for remote in self._get(remote_id):
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
        ('--mac-addr',      { 'type': str,    'required': True }),
        ('--remote-type',   { 'type': str,    'required': True }),
        ('--name',          { 'type': str,    'required': False }),
    )
    def run(self, args=object):
        remote_macaddr = args.mac_addr
        remote_type = args.remote_type
        remote_name = args.name
        docdata = {
            'mac_addr': remote_macaddr,
            'type': remote_type
        }
        if remote_name:
            docdata['name'] = remote_name
        self._add(docdata)
        return

class DelRemote(Remote):
    arguments = (
        ('--remote-id',     { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        remote_id = args.remote_id
        self._del(remote_id)
        return

class GetRemoteCode(Device):
    arguments = (
        ('--device-id',     { 'type': str,    'required': True }),
        ('--remote-type',   { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        device_id = args.device_id
        remote_type = args.remote_type
        remote_collection = '/'.join((self.collectionRootPath, device_id, remote_type))
        for docsnap in self._get_colref(remote_collection).get():
            action = docsnap.id
            for remote in self._get_doc(documentSnap=docsnap):
                del remote['id']
                pprint.pprint({action: remote})
        return

class AddRemoteCode(Device):
    arguments = (
        ('--device-id',     { 'type': str,    'required': True }),
        ('--remote-type',   { 'type': str,    'required': True }),
        ('--action',        { 'type': str,    'required': True,	'choices': sorted(set(x for v in DEVICE_TRAITS.values() for x in v['commands'])) }),
        ('--values',        { 'type': list,   'required': True }),
    )
    def run(self, args):
        device_id = args.device_id
        remote_type = args.remote_type
        remotecode_action = DEVICE_COMMANDS_PREFIX + args.action
        remotecode_values = args.values
        try:
            colref = self.getDeviceReference(device_id, True).collection(remote_type)
            docref = colref.document(remotecode_action)
            for v in remotecode_values:
                if '=' not in v:
                    raise ValueError('{} value separated with "=" was required'.format(v))
                kv,vv = v.split('=')
                if kv is None or vv is None:
                    raise ValueError('{} value with key and value was required'.format(v))
                try:
                    docref.get()
                    update_time = docref.update({kv: vv})
                except:
                    update_time = colref.add({kv: vv}, remotecode_action)
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
        ('--device-id',     { 'type': str,    'required': True }),
        ('--remote-type',   { 'type': str,    'required': True }),
        ('--action',        { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        device_id = args.device_id
        remote_type = args.remote_type
        remotecode_action = args.action
        try:
            colref = self.getDeviceReference(device_id, True).collection(remote_type)
            docref = colref.document(remotecode_action)
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
        ('--user-id',       { 'type': str,    'required': False }),
        ('--full',          { 'type': bool,   'required': False }),
    )
    def run(self, args=object):
        user_id = args.user_id
        show_full = args.full
        for user in self._get(user_id):
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
        ('--name',          { 'type': str,    'required': False }),
    )
    def run(self, args=object):
        user_name = args.name
        docdata = {}
        if user_name:
            docdata['name'] = user_name
        docref = self._add(docdata)
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
        ('--user-id',       { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        user_id = args.user_id
        self._del(user_id)
        return

class GetGroup(Group):
    arguments = (
        ('--group-id',      { 'type': str,    'required': False }),
        ('--full',          { 'type': bool,   'required': False }),
    )
    def run(self, args=object):
        group_id = args.group_id
        show_full = args.full
        for group in self._get(group_id):
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
        ('--user-id',       { 'type': list,    'required': True }),
    )
    def run(self, args=object):
        user_ids = args.user_id
        docdata = {}
        if user_ids:
            for user_id in user_ids:
                userref = self.getUserReference(user_id)
                if userref is None:
                    continue
                docdata[user_id] = userref
        self._add(docdata)
        return

class DelGroup(Group):
    arguments = (
        ('--group-id',      { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        group_id = args.group_id
        self._del(group_id)
        return

class GetUserDevice(UserDevice):
    arguments = (
        ('--user-device-id',    { 'type': str,      'required': False }),
        ('--user-id',           { 'type': str,      'required': False }),
        ('--full',              { 'type': bool,     'required': False }),
    )
    def run(self, args=object):
        user_device_id = args.user_device_id
        user_id = args.user_id
        show_full = args.full
        for udevice in self._get(user_device_id):
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
        ('--device-id',     { 'type': str,    'required': True }),
        ('--user-id',       { 'type': str,    'required': True }),
        ('--remote-id',     { 'type': str,    'required': True }),
        ('--name',          { 'type': str,    'required': False }),
    )
    def run(self, args=object):
        device_id = args.device_id
        user_id = args.user_id
        remote_id = args.remote_id
        user_device_name = args.name
        deviceReference = self.getDeviceReference(device_id, True)
        userReference  = self.getUserReference(user_id, True)
        remoteReference = self.getRemoteReference(remote_id, True)
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
        self._add(docdata)
        self.requestSync(user_id)
        return

class DelUserDevice(UserDevice):
    arguments = (
        ('--user-device-id',    { 'type': str,      'required': True }),
    )
    def run(self, args=object):
        user_device_id = args.user_device_id
        self._del(user_device_id)
        return

class GetGroupDevice(GroupDevice):
    arguments = (
        ('--group-device-id',   { 'type': str,      'required': False }),
        ('--group-id',          { 'type': str,      'required': False }),
        ('--full',              { 'type': bool,     'required': False }),
    )
    def run(self, args=object):
        group_device_id = args.group_device_id
        group_id = args.group_id
        show_full = args.full
        for gdevice in self._get(group_device_id):
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
        ('--device-id',     { 'type': str,    'required': True }),
        ('--group-id',      { 'type': str,    'required': True }),
        ('--remote-id',     { 'type': str,    'required': True }),
        ('--name',          { 'type': str,    'required': False }),
    )
    def run(self, args=object):
        device_id = args.device_id
        group_id  = args.group_id
        remote_id = args.remote_id
        device_reference = self.getDeviceReference(device_id, True)
        group_reference  = self.getGroupReference(group_id, True)
        remote_reference = self.getRemoteReference(remote_id, True)
        docdata = {
            'deviceId': device_id,
            'groupId' : group_id,
            'remoteId': remote_id,
            'deviceReference': device_reference,
            'groupReference' : group_reference,
            'remoteReference': remote_reference,
        }
        group_device_name = args.name
        if group_device_name:
            docdata['name'] = group_device_name
        self._add(docdata)
        for grp_docsnap in group_reference.get():
            user_id = grp_docsnap.id
            self.requestSync(user_id)
        return

class DelGroupDevice(GroupDevice):
    arguments = (
        ('--group-device-id',   { 'type': str,    'required': True }),
    )
    def run(self, args=object):
        group_device_id = args.group_device_id
        self._del(group_device_id)
        return

def get_client(serviceAccountKeyFile=None):
    default_serviceAccountKeyFile = os.path.join(os.getcwd(), 'serviceAccountKey.json')
    if(serviceAccountKeyFile is None):
        serviceAccountKeyFile = default_serviceAccountKeyFile
    cred = credentials.Certificate(serviceAccountKeyFile)
    cert_cred = cred.get_credential()
    app = firebase_admin.initialize_app(cred)
    return firestore.client(app)

def get_apikey(apiKeyFile=None):
    default_apiKeyFile = os.path.join(os.getcwd(), 'apikey.txt')
    if(apiKeyFile is None):
        apiKeyFile = default_apiKeyFile
    apikey = None
    apikey_length = 12
    try:
        with open(apiKeyFile, 'r') as fd:
            apikey = fd.read(apikey_length)
        return apikey
    except:
        (t, e) = sys.exc_info()[:2]
        return None

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

    client = get_client()
    apikey = get_apikey()
    p = argparse.ArgumentParser()
    subp = p.add_subparsers(help='sub-command help', dest='mode')
    for k, v in mode_class.items():
        pp = subp.add_parser(k, help='see `{} -h`'.format(k))
        for vv in v.arguments:
            args, kwargs = vv
            opt_type = None
            if 'type' in kwargs:
                opt_type = kwargs['type']
                del kwargs['type']
            if opt_type is None:
                pp.add_argument(args, **kwargs)
            elif opt_type is list:
                pp.add_argument(args, **kwargs, action='append')
            elif opt_type is bool:
                pp.add_argument(args, **kwargs, action='store_true')
            else:
                pp.add_argument(args, **kwargs, type=opt_type)
    args = p.parse_args()
    if(not args.mode):
        p.print_help(sys.stderr)
        sys.exit(255)
    c = mode_class[args.mode](client, apikey)
    c.run(args)
    sys.exit(0)
