'use strict';

// Firma del FEED con la clave de SERVICIO de este relay (ECDSA P-256). No es una
// identidad de vault (no necesita peer book): firma datos PÚBLICOS (resultados
// oficiales). Produce el mismo sobre canónico/ieee-p1363 que verifica todo el
// ecosistema, así que el cliente lo valida con WebCrypto contra la pubkey PINEADA.
//
// La clave se toma de (en orden): env RESULTS_PRIVATE_JWK → archivo persistido
// (0600) → se genera y persiste. La pubkey se publica en GET /pubkey y se PINEA
// en el cliente (la confianza no depende de la pubkey que viaje en el sobre).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalStringify } = require('./signature.js');

const KEY_FILE = process.env.RESULTS_KEY_FILE || path.join(__dirname, 'data', 'relay-key.json');

function loadOrCreateKey() {
    const envJwk = process.env.RESULTS_PRIVATE_JWK;
    if (envJwk) {
        try { return JSON.parse(envJwk); } catch (_) { console.error('[results] RESULTS_PRIVATE_JWK inválida, ignorada'); }
    }
    try { return JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch (_) { /* generar */ }
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = privateKey.export({ format: 'jwk' });
    try {
        fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
        fs.writeFileSync(KEY_FILE, JSON.stringify(jwk), { mode: 0o600 });
        console.log('[results] clave de servicio generada y persistida en', KEY_FILE);
    } catch (e) {
        console.error('[results] no pude persistir la clave de servicio:', e.message);
    }
    return jwk;
}

const privJwk = loadOrCreateKey();
const privateKeyObj = crypto.createPrivateKey({ key: privJwk, format: 'jwk' });
const pubJwk = { kty: 'EC', crv: 'P-256', x: privJwk.x, y: privJwk.y };
const pubJwkString = JSON.stringify(pubJwk);

/** Firma `data` (que ya debe incluir data.publickey) → base64 raw r||s. */
function signData(data) {
    const bytes = Buffer.from(canonicalStringify(data), 'utf8');
    return crypto.sign('sha256', bytes, { key: privateKeyObj, dsaEncoding: 'ieee-p1363' }).toString('base64');
}

module.exports = { signData, pubJwk, pubJwkString };
