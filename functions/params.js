'use strict';

const { defineString, defineSecret } = require('firebase-functions/params');

// .value() はモジュールロード時に呼ばず、ハンドラ/関数内で評価すること。
exports.OAUTH_CLIENT_ID = defineString('OAUTH_CLIENT_ID');
exports.HOMEGRAPH_API_KEY = defineString('HOMEGRAPH_API_KEY');
exports.OAUTH_CLIENT_SECRET = defineSecret('OAUTH_CLIENT_SECRET');
