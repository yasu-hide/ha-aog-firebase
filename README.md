# ha-aog-firebase
**いろいろいじり中**

無料FirebaseでActions on Googleスマートホーム連携

Google Assistant/Google Homeのスマートホーム連携機能をDBに記録するだけの簡単なお仕事です。

## IFTTTと異なるところ
IFTTTでGoogle Assistant連携をセットアップすると、単純な言葉に反応させた処理を組み立てられます。
認識される文章が完全に一致した場合しか動作せず、例えば「全部の照明を消して」などには反応しません。

このアプリケーションは、Google Assistantのスマートホームプロバイダとして動作します。
例えば、「全部の照明を消して」と言った時、Google Assistantは、このアプリケーションに記録している全ての照明を制御します。

## 注意
**重要:** 個人利用向けに作ってみました。個人利用以外の目的では使わないでください。
このアプリケーションが将来にわたって利用可能である保証はありません。

不具合や設定不備により、悪意のあるユーザーに個人の情報が侵害される可能性があります。

## 前提
- デプロイ元PCにnode.jsとnpm
- Googleアカウント
- Google Assistant対応端末 (Android, Google Home)

## 使い方
- [USAGE.md](USAGE.md)

## TODO
- [ ] ユーザ管理とデバイス登録のUI
- [ ] OAuth

## ライセンス
MIT License
