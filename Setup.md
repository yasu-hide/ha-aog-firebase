# 使い方
ほとんどがFirebaseの設定です
## "Firebase"プロジェクトを作成
- [Firebase Console](https://console.firebase.google.com/)に移動
- **"新規プロジェクトを作成"** をクリックして新しいプロジェクトを作成
   - この時入力するプロジェクト名がアプリケーションのURLになるので慎重に☆
- プロジェクト名をメモる
- 手元にfirebase CLIを入れる
```
npm install -g firebase-tools
```
### CLIでプロジェクト初期化
```
firebase login
```
n

```
firebase init
```
チェックを付けてエンター、先ほど作ったプロジェクトを選択したら、あとは全部Enter

## "Actions on Google" プロジェクトを作成
- [Actions Console](https://console.actions.google.com/)に移動
- **"Add/import project"** をクリックして新しいプロジェクトを作成
- プロジェクトＩＤをメモる

## "Firebase Authentication" の設定
- FirebaseプロジェクトConsoleに移動
- DEVELOPの **Authentication** に移動
- Authenticationのタブから **ログイン方法**に移動
- 承認済みドメインに`us-central1-<プロジェクトＩＤ>.cloudfunctions.net`を追加
- **ログインプロバイダ** から有効にしたいプロバイダをクリック
- 右上の **有効にする** スライダをクリックし有効化
- プロバイダに応じた認証情報を入力

### Google
- [Google Cloud Platform 認証情報](https://console.cloud.google.com/apis/credentials)を別で開く
- 認証情報を作成から **OAuthクライアントID** を選択
- **ウェブアプリケーション** をチェック
- 名前を入力
- 承認済みのリダイレクトURLに`https://<プロジェクトID>.firebaseapp.com/__/auth/handler`を入力
- 作成をクリック
- 表示される **クライアントID** と **クライアントシークレット** をメモ
- FirebaseのGoogleプロバイダ設定画面に戻る
- **ウェブクライアントID** に、GCP認証情報の **クライアントID** を入力
- **ウェブクライアントシークレット** に、GCP認証情報の **クライアントシークレット** を入力

### 他
- 適当にググってください

## リポジトリをクローンしてデプロイ
- リポジトリをクローン
- node.jsモジュールを取得
```
cd functions && npm install
```
- bowerでfirebaseuiを取得（bowerがなければnpmでインストールしてから）
```
bower install firebaseui --save
```
- OAuth資格情報を生成し設定
    - `ClientId`を作成し、`firebase functions:config:set app.id=<ClientId>`を設定
    - `ClientSecret`を作成し、`firebase functions:config:set app.key=<ClientSecret>`を設定

- デプロイ
```
firebase deploy
```

## "Actions on Google"プロジェクトを設定
- Actionsプロジェクトコンソールに移動
- "Use Actions SDK"をクリック
- **"actions.json"** のURLをプロジェクト名に置き換え
    - `https://us-central1-<プロジェクトID>.cloudfunctions.net/ha` -> `https://us-central1-testapp-6bag.cloudfunctions.net/ha`
- プロジェクト設定を更新するため、`gactions`コマンドに **"actions.json"** を指定して実行
    - [gactions CLIをダウンロード](https://developers.google.com/actions/tools/gactions-cli)
    - `gactions update --project <プロジェクト名> --action_package actions.json` を実行
- App information の下の "ADD" をクリック
- アプリ情報を入力。例えば、アプリ名や説明、連絡先など
- "Account linking (optional)" をクリックして "ADD" をクリック
- OAuth資格情報をフィールドに入力
    - Grant type: `Authorization code`
    - Client information
        - Client ID: **ClientId**と同じ
        - Client secret: **ClientSecret**と同じ
        - Authorization URL: `https://us-central1-<プロジェクトID>.cloudfunctions.net/ha/auth`
        - Token URL: `https://us-central1-<プロジェクトID>.cloudfunctions.net/ha/token`
- "Save"をクリック
- "TEST DRAFT"をクリック

## "Cloud Firestore "の設定
- [Firebase Console](https://console.firebase.google.com/)に移動
- プロジェクトを選択
- **Database** に移動
- **Cloud Firestore** をクリックして有効化

## データの追加
- firebase >プロジェクトの設定 > サービスアカウント > Firebase Admin SDK > Python > 新らしい秘密鍵の生成
    - ./sample/serviceAccountKey.json を書き換え
[Usage.md](Usage.md) を参照

## プロジェクトをGoogle Assitantに接続
- Actions Consoleでプロジェクトを設定したアカウントと同一のアカウントでGoogle Homeにログインしているデバイスを用意
- Google Homeの設定で **"スマートホーム"** をクリック
- "+"をクリック
- アプリの一覧からプロジェクトを探し、選択
- Firebase Authorizationで設定したプロバイダをクリックしサインイン
- "データの追加"で設定したデバイスが追加されることを確認

## 「OK,Google 照明をつけて」
- Realtime Databaseの **commands** と **states** が変更される
- 別のプログラムから接続して変更を検出できる
``` node.js
admin.database().ref('commands').on('child_changed', (snap) => {
```
こんな感じ。
