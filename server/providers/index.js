'use strict';

// Registro de proveedores + cadena de fallback. El PRIMERO de la lista es el
// preferido; los demás rellenan los partidos que falten o aportan un estado más
// avanzado (terminado > en juego > programado). Agregar un proveedor = agregar
// un módulo con { id, label, fetchMatches(opts) } y meterlo acá en orden.

const espn = require('./espn.js');
const fifa = require('./fifa.js');
const { matchKey } = require('../keys.js');

// Orden de preferencia (configurable por env RESULTS_PROVIDERS="espn,fifa").
const ALL = { espn, fifa };
const ORDER = (process.env.RESULTS_PROVIDERS || 'espn,fifa')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(id => ALL[id]).filter(Boolean);
const PROVIDERS = ORDER.length ? ORDER : [espn, fifa];

function rank(m) { return m.finished ? 3 : (m.started ? 2 : 1); }

// Total de goles reportado (en vivo, el proveedor más al día es el que ya vio
// el último gol). Sin marcador = -1 para que cualquier dato gane a la nada.
function goalsOf(m) {
    return (m.homeGoals == null && m.awayGoals == null) ? -1 : (m.homeGoals || 0) + (m.awayGoals || 0);
}

/** Trae de cada proveedor en paralelo; devuelve {id: {ok,count,matches,error,fetchedAt}}. */
async function collect(opts) {
    const out = {};
    await Promise.all(PROVIDERS.map(async (p) => {
        try {
            const matches = await p.fetchMatches(opts);
            out[p.id] = { ok: true, count: matches.length, matches, fetchedAt: Date.now() };
        } catch (e) {
            out[p.id] = { ok: false, error: e.message, matches: [], fetchedAt: Date.now() };
        }
    }));
    return out;
}

/**
 * Funde los proveedores en una sola lista. Por cada partido (matchKey), gana el
 * primer proveedor en ORDER que lo tenga; uno posterior solo lo reemplaza si trae
 * un estado MÁS avanzado (p.ej. ESPN aún 'in' y FIFA ya 'final') o, a igual
 * estado, MÁS GOLES (en vivo, el proveedor más al día es el que ya vio el
 * último gol; los marcadores solo crecen, así que más goles = más fresco).
 */
function mergeProviders(results) {
    const byKey = new Map();
    for (const p of PROVIDERS) {
        const r = results[p.id];
        if (!r || !r.ok) continue;
        for (const m of r.matches) {
            const k = matchKey(m);
            const cur = byKey.get(k);
            if (!cur || rank(m) > rank(cur) || (rank(m) === rank(cur) && goalsOf(m) > goalsOf(cur))) {
                byKey.set(k, m);
            }
        }
    }
    return [...byKey.values()];
}

module.exports = {
    PROVIDERS,
    providerIds: PROVIDERS.map(p => p.id),
    providerLabels: Object.fromEntries(PROVIDERS.map(p => [p.id, p.label])),
    collect,
    mergeProviders,
};
