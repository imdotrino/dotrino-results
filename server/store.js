'use strict';

// Overrides MANUALES (el "state of truth"): lo que carga el admin firmado por su
// vault gana SIEMPRE sobre los proveedores; los proveedores rellenan el resto.
// Persistencia simple en un archivo JSON (sobrevive reinicios). Keyed por
// matchKey (par de códigos FIFA + fase), así re-publicar un partido lo actualiza
// y `clear:true` lo borra (vuelve a mandar el proveedor).

const fs = require('node:fs');
const path = require('node:path');
const { matchKey } = require('./keys.js');

const FILE = process.env.RESULTS_STORE_FILE || path.join(__dirname, 'data', 'overrides.json');

function loadFile() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
    catch (_) { return {}; }
}
let cache = loadFile();

function persist() {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(cache));
    } catch (e) { console.error('[results] persist overrides error:', e.message); }
}

function numOrNull(x) {
    if (x === null || x === undefined || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

function normalizeOverride(it, by, now) {
    const hCode = String(it.home).toUpperCase();
    const aCode = String(it.away).toUpperCase();
    const hG = numOrNull(it.homeGoals);
    const aG = numOrNull(it.awayGoals);
    const hP = numOrNull(it.homePens);
    const aP = numOrNull(it.awayPens);
    let winner = (typeof it.winner === 'string' && it.winner) ? it.winner.toUpperCase() : null;
    // Un override manual representa un resultado CONOCIDO.
    const finished = winner != null || (hG != null && aG != null);
    if (!winner && finished && hG != null && aG != null) {
        const hWin = (hP != null && aP != null && (hP || aP)) ? hP > aP : hG > aG;
        const aWin = (hP != null && aP != null && (hP || aP)) ? aP > hP : aG > hG;
        winner = hWin ? hCode : (aWin ? aCode : null);
    }
    return {
        home: hCode, away: aCode, kickoff: it.kickoff || null, stage: it.stage || null,
        status: finished ? 'final' : 'scheduled', started: finished, finished,
        homeGoals: hG, awayGoals: aG,
        homePens: (hP || aP) ? hP : null, awayPens: (hP || aP) ? aP : null,
        winner, source: 'manual', by, at: now,
    };
}

/**
 * Aplica un lote de overrides del admin. Cada item:
 *   { home, away, kickoff?, homeGoals, awayGoals, homePens?, awayPens?, winner?, stage?, clear? }
 * Devuelve cuántos cambiaron.
 */
function applyOverrides(items, byPubkeyId, now) {
    let changed = 0;
    for (const it of items || []) {
        if (!it || typeof it.home !== 'string' || typeof it.away !== 'string') continue;
        const k = matchKey({ home: it.home, away: it.away, kickoff: it.kickoff });
        // Sin dato (ni goles ni ganador) no hay nada que afirmar: se trata como
        // `clear`. Un override vacío guardado taparía el dato real del proveedor
        // en todos los clientes (pasó con MEX-RSA el 2026-06-10).
        const empty = it.homeGoals == null && it.awayGoals == null && !it.winner;
        if (it.clear === true || empty) {
            if (cache[k]) { delete cache[k]; changed++; }
            continue;
        }
        cache[k] = normalizeOverride(it, byPubkeyId, now);
        changed++;
    }
    if (changed) persist();
    return changed;
}

/** Lista de overrides manuales (el state of truth a aplicar sobre los proveedores). */
function overrides() { return Object.values(cache); }

function count() { return Object.keys(cache).length; }

module.exports = { applyOverrides, overrides, count, _file: FILE };
