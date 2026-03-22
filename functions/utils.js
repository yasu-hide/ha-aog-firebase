'use strict';

const valuniq = (obj) => {
    const arrobj = {};
    for (let i = 0; i < obj.length; i++) {
        arrobj[obj[i]['id']] = obj[i];
    }
    const newret = [];
    for (let key in arrobj) {
        newret.push(arrobj[key]);
    }
    return newret;
};

const flatten = (arr) => Array.isArray(arr) ? [].concat.apply([], arr.map(flatten)) : arr;

const showError = (res, message) => {
    console.error(message);
    res.status(400).set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }).json({ error: message });
    return;
};

module.exports = {
    valuniq,
    flatten,
    showError
};
