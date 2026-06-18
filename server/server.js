'use strict';

// results.dotrino.com — relay de resultados oficiales en vivo del Mundial.
// Centraliza la consulta a los proveedores (ESPN primario, FIFA fallback) del
// lado del servidor (una sola IP, sin filtrar la IP de cada visitante a un
// tercero) y sirve a las apps un FEED FIRMADO. El admin puede sobrescribir
// cualquier partido a mano (firmado por su vault) y eso es el "state of truth":
// gana sobre los proveedores; los proveedores rellenan lo que no se cargó.
//
// Endpoints:
//   GET  /official[?source=espn|fifa|manual|merged]   feed firmado {data, signature}
//   GET  /pubkey       clave pública del relay (la pinea el cliente)
//   GET  /health       liveness + estado de proveedores
//   POST /admin/result override manual firmado por el vault del admin (allowlist)

const http = require('node:http');
const { verifyEnvelope, pubkeyId } = require('./signature.js');
const sign = require('./sign.js');
const providers = require('./providers/index.js');
const store = require('./store.js');
const rl = require('./rateLimiter.js');

const PORT = Number(process.env.PORT || 8092);
const COMPETITION = process.env.RESULTS_COMPETITION || 'fifa.world.2026';
const FROM = process.env.RESULTS_FROM || '20260611';
const TO = process.env.RESULTS_TO || '20260719';
const POLL_MS = Number(process.env.RESULTS_POLL_MS || 30000);
const FETCH_TIMEOUT_MS = Number(process.env.RESULTS_FETCH_TIMEOUT_MS || 12000);
const CLOCK_SKEW_MS = Number(process.env.RESULTS_CLOCK_SKEW_MS || 10 * 60 * 1000);
const MAX_BODY = Number(process.env.RESULTS_MAX_BODY || 256 * 1024);
const PRUNE_MS = 60 * 1000;

// Allowlist de admins: thumbprints (pubkeyId hex) o JWK strings completos,
// separados por coma. Vacío = nadie puede cargar overrides (solo proveedores).
const ADMINS = (process.env.RESULTS_ADMIN_PUBKEYS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
// Thumbprints (pubkeyId hex) de los admins — públicos, se exponen en el feed para
// que el cliente muestre el botón "Publicar" SOLO a un admin (la seguridad real
// la da igual la verificación de firma + allowlist en POST /admin/result).
const ADMIN_IDS = ADMINS.map(a => (/^[0-9a-f]{64}$/i.test(a) ? a.toLowerCase() : pubkeyId(a)));

// Snapshot en memoria del último refresh de proveedores.
let snapshot = { updatedAt: 0, providerResults: {}, matches: [] };

async function refresh() {
    try {
        const providerResults = await providers.collect({ fromYmd: FROM, toYmd: TO, timeoutMs: FETCH_TIMEOUT_MS });
        const matches = providers.mergeProviders(providerResults);
        snapshot = { updatedAt: Date.now(), providerResults, matches };
        const summary = Object.entries(providerResults)
            .map(([id, r]) => r.ok ? `${id}:${r.count}` : `${id}:ERR(${r.error})`).join(' ');
        console.log(`[results] refresh: ${matches.length} partidos fundidos | ${summary}`);
    } catch (e) {
        console.error('[results] refresh fatal:', e.message);
    }
}

function isAdmin(publickeyJwkString) {
    if (!ADMINS.length) return false;
    const id = pubkeyId(publickeyJwkString);
    return ADMINS.includes(id) || ADMINS.includes(publickeyJwkString);
}

// Arma el feed firmado. `source`: 'espn'|'fifa' (vista de un proveedor),
// 'manual' (solo overrides), o por defecto 'merged' (proveedores + overrides).
function buildFeed(source) {
    const providerHealth = {};
    for (const [id, r] of Object.entries(snapshot.providerResults)) {
        providerHealth[id] = { ok: r.ok, count: r.count || 0, fetchedAt: r.fetchedAt, error: r.error || null };
    }
    let matches = snapshot.matches;
    let overrides = store.overrides();
    if (source && source !== 'merged') {
        if (source === 'manual') {
            matches = [];
        } else if (snapshot.providerResults[source]) {
            matches = snapshot.providerResults[source].ok ? snapshot.providerResults[source].matches : [];
            overrides = [];
        }
    }
    const data = {
        v: 1,
        competition: COMPETITION,
        updatedAt: snapshot.updatedAt,
        providers: providers.providerIds,
        providerLabels: providers.providerLabels,
        providerHealth,
        // `matches` = mejor dato de proveedor por partido. `overrides` = manual
        // (state of truth). El cliente aplica matches y luego overrides (ganan).
        matches,
        overrides,
        admins: ADMIN_IDS,
        publickey: sign.pubJwkString,
    };
    return { data, signature: sign.signData(data) };
}

// --- helpers HTTP (estilo geo) ---

function send(res, status, obj, extraHeaders) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'cache-control': 'no-store',
        ...(extraHeaders || {}),
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0; const chunks = [];
        req.on('data', c => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch (_) { reject(new Error('invalid json')); }
        });
        req.on('error', reject);
    });
}

async function handleAdmin(req, res, now) {
    const { data, signature } = (await readBody(req)) || {};
    if (!data || typeof data !== 'object') return send(res, 400, { error: 'falta data' });
    if (!verifyEnvelope(data, signature)) return send(res, 401, { error: 'firma inválida' });
    if (!isAdmin(data.publickey)) return send(res, 403, { error: 'no autorizado (pubkey fuera de la allowlist)' });
    if (typeof data.issuedAt !== 'number' || Math.abs(now - data.issuedAt) > CLOCK_SKEW_MS) {
        return send(res, 401, { error: 'sobre vencido o reloj fuera de rango' });
    }
    if (data.competition && data.competition !== COMPETITION) return send(res, 400, { error: 'competición no coincide' });
    if (!Array.isArray(data.matches)) return send(res, 400, { error: 'matches debe ser un arreglo' });
    const changed = store.applyOverrides(data.matches, pubkeyId(data.publickey), now);
    console.log(`[results] override admin ${pubkeyId(data.publickey).slice(0, 12)}…: ${changed} cambio(s)`);
    return send(res, 200, { ok: true, changed, total: store.count() });
}

const server = http.createServer(async (req, res) => {
    const now = Date.now();
    try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        if (req.method === 'OPTIONS') return send(res, 204, {});

        if (url.pathname === '/health') {
            const ph = {};
            for (const [id, r] of Object.entries(snapshot.providerResults)) ph[id] = r.ok ? r.count : `ERR:${r.error}`;
            return send(res, 200, { ok: true, updatedAt: snapshot.updatedAt, providers: ph, overrides: store.count() });
        }
        if (url.pathname === '/pubkey') {
            return send(res, 200, { v: 1, alg: 'ECDSA-P256-SHA256', jwk: sign.pubJwk, pubkey: sign.pubJwkString });
        }

        if (url.pathname === '/official' && req.method === 'GET') {
            const { allowed, retryAfter } = rl.take('read', rl.clientIp(req), now);
            if (!allowed) return send(res, 429, { error: 'demasiadas solicitudes' }, { 'retry-after': String(retryAfter) });
            return send(res, 200, buildFeed(url.searchParams.get('source')));
        }

        if (url.pathname === '/admin/result' && req.method === 'POST') {
            const { allowed, retryAfter } = rl.take('write', rl.clientIp(req), now);
            if (!allowed) return send(res, 429, { error: 'demasiadas solicitudes' }, { 'retry-after': String(retryAfter) });
            return await handleAdmin(req, res, now);
        }

        return send(res, 404, { error: 'not found' });
    } catch (err) {
        const msg = (err && err.message) || 'error';
        const status = (msg === 'body too large' || msg === 'invalid json') ? 400 : 500;
        return send(res, status, { error: msg });
    }
});

async function main() {
    console.log(`[results] proveedores: ${providers.providerIds.join(' → ')} | admins: ${ADMINS.length}`);
    await refresh();
    setInterval(refresh, POLL_MS).unref();
    setInterval(() => rl.prune(Date.now()), PRUNE_MS).unref();
    server.listen(PORT, () => console.log(`[results] results.dotrino.com escuchando en :${PORT}`));
}

main().catch(err => { console.error('[results] fatal', err); process.exit(1); });
