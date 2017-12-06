# データの取り扱いについて
ha-aog-firebaseでは、デバイスとリモコンコード、リモコンと  
特定のユーザーまたはグループを関連付けて制御をします。

制御対象を、Google Homeアプリのデバイス一覧に表示するには  
`ユーザーデバイス`または`グループデバイス`のいずれかに追加してください

- ユーザーしか操作をしないデバイス、リモコンの組み合わせ  
`ユーザーデバイス`として追加してください

- 家族などユーザーのグループで操作をするデバイス、リモコンの組み合わせ  
`グループデバイス`として追加してください

# データの確認方法

## デバイスの確認と表示例
```
./sample/client.py get_device
```
```
XDXgRxsWJl4cMxKDXJsi        DAIKIN AN22NES-W
41L43WwGCsp09KqNWpzc        Panasonic HHFZ4290
Jl4cMxKDXJXDXgRxsWsi        HITACHI RAS-S28W
GCsp09KqNWpzcJl4cMxK        FOSTEX HPA8
Wpzc43WwGCsp09KqNgRx        TOSHIBA FVH136WRM
```

## リモコンの確認と表示例
```
./sample/client.py get_remote
```
```
EjAiT7S3iiqdX5H51BfM    broadlink    和室のリモコン
p5v5XeavmEkCaP9wEEKk    broadlink    書斎のリモコン
u8ruOrCJWgXGtmpbudlR    broadlink    寝室のリモコン
```

## リモコンコードの確認と表示例
```
./sample/client.py get_remote_code \
    --device-id    デバイスID
    --remote-type  リモコンタイプ
```
```
{'action.devices.commands.BrightnessAbsolute': {'0': '2600ac0074380f0d0f0...',
                                                '100': '2600560074380f0d100e0...',
{'action.devices.commands.OnOff': {'off': '2600560074380f0d100d0f2a0f2a100d0...',
                                   'on': '260007438100d0f0d0f2a102a0f0d0f2a...',}}
```

## ユーザーの確認と表示例
```
./sample/client.py get_user
```
```
Sz6LCQp12rbwnznIGOZd2ASz6LAC    sample-user1@example.jp
0QeK1iSz6LCQp12rbwnznIGOZd2A    sample-user2@example.jp
```

## ユーザーデバイスの確認と表示例
```
./sample/client.py get_user_device
```
```
cHLQrnIc6v7j05Qxo0rJ    41L43WwGCsp09KqNWpzc    p5v5XeavmEkCaP9wEEKk    自室のエアコン
apvuN3EFyzQGDi5Wf255    Jl4cMxKDXJXDXgRxsWsi    p5v5XeavmEkCaP9wEEKk    自室の照明
```

## グループの確認と表示例
```
./sample/client.py get_group
```
```
9VweR9Txfq82cJQqpVT8
    cHLQrnIc6v7j05Qxo0rJ
    apvuN3EFyzQGDi5Wf255
```
## グループデバイスの確認と表示例
```
./sample/client.py get_group_device
```
```
TmZUKGvOSS2m6jqmMsbQ    Wpzc43WwGCsp09KqNgRx    u8ruOrCJWgXGtmpbudlR    寝室の照明
```

# データ投入方法

## デバイスの追加
```
./sample/client.py add_device \
    --manufacturer メーカー名 \
    --model        型式 \
    --type         種別 (種別一覧を参照) \
    --traits       特性 (特性一覧を参照、複数指定可) \
    (--name)       "メーカー名 型式"以外の名前を付けたい場合に指定
    (--report-state) 状態変更後、Googleに状態を伝える
```
- 種別一覧
```
    CAMERA      : カメラ
    DISHWASHER  : 食洗器
    DRYER       : ドライヤー
    LIGHT       : 照明
    OUTLET      : コンセント
    SCENE       : 場面定義
    SWITCH      : スイッチ
    THERMOSTAT  : 温度管理
    VACUUM      : 掃除機
    WASHER      : 洗濯機
```
- 特性一覧
```
    Brightness        : 照度
    CameraStream      : カメラ映像
    ColorSpectrum     : 色分布
    ColorTemperature  : 色温度
    Dock              : ドッキングステーション
    Modes             : 選択可能なモード
    OnOff             : オンオフ
    RunCycle          : 
    Scene             : 場面
    StartStop         : 開始停止
    TemperatureSetting: 温度設定
    Toggles           : トグルするモード
```
### Panasonic 照明器具 HHFZ5160 を追加する例
```
./sample/client.py add_device \
    --manufacturer Panasonic \
    --model HHFZ5160 \
    --type LIGHT
    --traits Brightness \
    --traits OnOff \
    --traits Toggles
```
```
devices/k6Fzrxa80yAQWHCvDGJK was added
```

## リモコンの追加
```
./sample/client.py add_remote \
    --mac-addr     リモコンデバイスMACアドレス \
    --remote-type  リモコンタイプ \
    (--name)       リモコンに名前を付けたい場合に指定
```
### Broadlink RM mini3 を追加する例
```
./sample/client.py add_remote \
    --mac-addr    34:EA:34:DE:AD:FF \
    --remote-type broadlink
    --name        リビングのリモコン
```
```
remotes/AQWHCvDGJKk6Fzrxa80y was added
```

## リモコンコードの追加
```
./sample/client.py add_remote_code \
    --device-id    デバイスID
    --remote-type  リモコン種別
    --action       デバイス特性に関係したアクション
    --values       デバイスに応じたリモコンコード
```
- デバイス特性に関係したアクション一覧
```
    BrightnessAbsolute            Brightness
    GetCameraStream               CameraStream
    ColorAbsolute                 ColorSpectrum, ColorTemperature
    Dock                          Dock
    SetModes                      Modes
    OnOff                         OnOff
    ActivateScene                 Scene
    StartStop                     StartStop
    PauseUnpause                  StartStop
    ThermostatTemperatureSetpoint TemperatureSetting
    ThermostatTemperatureSetRange TemperatureSetting
    ThermostatSetMode             TemperatureSetting
    SetToggles                    Toggles
```
--valuesに指定可能なパラメータは、https://developers.google.com/actions/smarthome/guides/ を参照
### *Panasonic HHFZ5160* を *Broadlink RM mini3* でONするリモコンコードを追加する例
```
./sample/client.py add_remote_code \
    --device-id    k6Fzrxa80yAQWHCvDGJK
    --remote-type  broadlink
    --action       OnOff
    --values       on=2600ac007438100d0f0d0f2a102a0f0d0f2a...0000
```

## ユーザーデバイスの追加
```
./sample/client.py add_user_device \
    --device-id    デバイスID
    --user-id      ユーザーID
    --remote-id    リモコンID
    (--name)       ユーザーデバイスに名前を付けたい場合に指定
```
### 先に追加した *リビングのリモコン* と *Panasonic HHFZ5160* の組み合わせをユーザーID *y08axrzF6kKJGDvCHWQA* に紐づける例
```
./sample/client.py add_user_device \
    --device-id k6Fzrxa80yAQWHCvDGJK \
    --remote-id AQWHCvDGJKk6Fzrxa80y \
    --user-id   y08axrzF6kKJGDvCHWQA \
    --name リビングの照明
```
```
user_devices/DGJKk6FzrAQWHCvxa80y was added
```

## グループの追加
```
./sample/client.py add_group \
    --user-id       グルーピングしたいユーザーID (複数指定可)
```
### ユーザーID *y08axrzF6kKJGDvCHWQA* と *6kKJGDvCHWQAy08axrzF* をグルーピングする例
```
./sample/client.py add_group \
    --user-id y08axrzF6kKJGDvCHWQA \
    --user-id 6kKJGDvCHWQAy08axrzF
```
```
groups/DvCHWQAy08axrzF6kKJG was added
```

## グループデバイスの追加
```
./sample/client.py add_group_device \
    --device-id    デバイスID
    --group-id     グループID
    --remote-id    リモコンID
    (--name)       グループデバイスに名前を付けたい場合に指定
```
### 先に追加した *リビングのリモコン* と *Panasonic HHFZ5160* の組み合わせをグループID *DvCHWQAy08axrzF6kKJG* に紐づける例
```
./sample/client.py add_group_device \
    --device-id k6Fzrxa80yAQWHCvDGJK \
    --remote-id AQWHCvDGJKk6Fzrxa80y \
    --group-id  DvCHWQAy08axrzF6kKJG \
    --name リビングの照明
```
```
group_devices/HCvDGJKk6FzrxAQWa80y was added
```
