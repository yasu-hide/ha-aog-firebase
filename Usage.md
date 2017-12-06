# データ投入方法

## デバイスの追加
```
./sample/client.py add_device \
    --manufacturer メーカー名 \
    --model        型式 \
    --type         種別 (種別一覧を参照) \
    --traits       特性 (複数指定可、特性一覧を参照) \
    (--name)       "メーカー名 型式"以外の名前を付けたい場合に指定
    (--report-state) 状態変更後、Googleに状態を伝える
```
```
- 種別一覧
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
```
- 特性一覧
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
./client.py add_device \
    --manufacturer Panasonic \
    --model HHFZ5160 \
    --type LIGHT
    --traits Brightness \
    --traits OnOff \
    --traits Toggles
```

