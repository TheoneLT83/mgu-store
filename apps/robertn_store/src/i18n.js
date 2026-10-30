'use strict';
/**
 * The Store's words in the head unit's display language. The English text
 * is the key: t('Update {0}', version) is its translation in the language
 * in use, with {0}, {1} ... replaced by the arguments, or the English where
 * the language has no translation. Arguments are data (names, versions,
 * sources, SSIDs, the updater's errors) and are never translated.
 *
 * The languages are src/locales.js (tools/gen_locales.js, from
 * locales/<code>.json). setHmiLanguage(value) picks the one for the HMI's
 * display language (a CommonTypes.Language name), English for any other,
 * an invalid value or none.
 */
const LOCALES = require('./locales.js');

let current = null;

function codes() {
    return LOCALES.map((l) => l.code);
}

/* Returns whether the language changed. */
function setHmiLanguage(value) {
    const next = LOCALES.find((l) => typeof value === 'string' && l.hmiLanguages.indexOf(value) >= 0) || null;
    if (next === current) {
        return false;
    }
    current = next;
    return true;
}

function language() {
    return current ? current.code : 'en';
}

function font() {
    return (current && current.font) || null;
}

function t(key, ...args) {
    const words = current && current.words;
    const text = words && Object.prototype.hasOwnProperty.call(words, key) && typeof words[key] === 'string' ? words[key] : key;
    return text.replace(/\{(\d+)\}/g, (match, i) => (Number(i) < args.length ? String(args[i]) : match));
}

module.exports = { codes, setHmiLanguage, language, font, t };
