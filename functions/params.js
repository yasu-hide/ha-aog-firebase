'use strict';

const { defineString, defineSecret } = require('firebase-functions/params');

// .value() はモジュールロード時に呼ばず、ハンドラ/関数内で評価すること。
exports.OAUTH_CLIENT_ID = defineString('OAUTH_CLIENT_ID', { description: 'Google Home Actions 側に設定する OAuth クライアント ID' });
exports.HOMEGRAPH_API_KEY = defineString('HOMEGRAPH_API_KEY', { description: 'HomeGraph API (REQUEST_SYNC / Report State) 用の API キー' });
exports.OAUTH_CLIENT_SECRET = defineSecret('OAUTH_CLIENT_SECRET', { description: 'Google Home Actions 側に設定する OAuth クライアントシークレット' });
