'use strict';

// Proveedor PRIMARIO: API oculta de ESPN. Server-side (CORS irrelevante), sin
// API key. Una sola request por rango de fechas trae TODO el torneo.
//   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD-YYYYMMDD
// Campos clave por competidor: abbreviation (código FIFA), score, winner (bool,
// autoritativo incl. penales), shootoutScore (penales). status.type.state =
// 'pre'|'in'|'post', .completed = bool. Normaliza al shape app-agnóstico común.

const BASE = process.env.RESULTS_ESPN_BASE
    || 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

function stageFromEspn(ev) {
    const slug = (ev && ev.season && ev.season.slug) || '';
    if (/round-of-32/.test(slug)) return 'round-of-32';
    if (/round-of-16/.test(slug)) return 'round-of-16';
    if (/quarter/.test(slug)) return 'quarterfinal';
    if (/semi/.test(slug)) return 'semifinal';
    if (/third/.test(slug)) return 'third-place';
    if (/(^|[^-])final/.test(slug)) return 'final';
    return null;
}

function normalize(json) {
    const out = [];
    for (const ev of (json && json.events) || []) {
        const comp = (ev.competitions && ev.competitions[0]) || {};
        const cs = comp.competitors || [];
        const home = cs.find(c => c.homeAway === 'home') || cs[0];
        const away = cs.find(c => c.homeAway === 'away') || cs[1];
        if (!home || !away) continue;
        const hCode = ((home.team && home.team.abbreviation) || '').toUpperCase();
        const aCode = ((away.team && away.team.abbreviation) || '').toUpperCase();
        if (!hCode || !aCode) continue;
        const st = (ev.status && ev.status.type) || (comp.status && comp.status.type) || {};
        const state = st.state || 'pre';
        const finished = st.completed === true || state === 'post';
        const started = state !== 'pre';
        const hG = started ? num(home.score) : null;
        const aG = started ? num(away.score) : null;
        const hP = num(home.shootoutScore);
        const aP = num(away.shootoutScore);
        let winner = null;
        if (finished) {
            if (home.winner === true) winner = hCode;
            else if (away.winner === true) winner = aCode;
            else if (hG != null && aG != null) {
                const hWin = (hP != null && aP != null && (hP || aP)) ? hP > aP : hG > aG;
                const aWin = (hP != null && aP != null && (hP || aP)) ? aP > hP : aG > hG;
                winner = hWin ? hCode : (aWin ? aCode : null);
            }
        }
        out.push({
            home: hCode, away: aCode, kickoff: ev.date || null, stage: stageFromEspn(ev),
            status: finished ? 'final' : (started ? 'in' : 'scheduled'),
            started, finished,
            homeGoals: hG, awayGoals: aG,
            homePens: (hP || aP) ? hP : null, awayPens: (hP || aP) ? aP : null,
            winner, source: 'espn',
        });
    }
    return out;
}

// ESPN limita el scoreboard a ~100 eventos por RESPUESTA. Un Mundial de 104
// partidos pedido en UNA sola ventana (todo el torneo) devuelve solo los primeros
// 100 y TRUNCA las últimas rondas (semis/final/3º). Solución: pedir el rango en
// TROZOS de pocos días (cada uno muy por debajo de 100 eventos) y unir/deduplicar.
const CHUNK_DAYS = Math.max(1, Number(process.env.ESPN_CHUNK_DAYS || 14));

function ymdToDate(ymd) {
    return new Date(Date.UTC(+String(ymd).slice(0, 4), +String(ymd).slice(4, 6) - 1, +String(ymd).slice(6, 8)));
}
function dateToYmd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

async function fetchWindow(fromYmd, toYmd, timeoutMs) {
    const url = `${BASE}?dates=${fromYmd}-${toYmd}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 12000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } }); }
    finally { clearTimeout(t); }
    if (!res.ok) throw new Error('espn http ' + res.status);
    return normalize(await res.json());
}

async function fetchMatches(opts) {
    const start = ymdToDate(opts.fromYmd), end = ymdToDate(opts.toYmd);
    // Ventanas contiguas de CHUNK_DAYS días, sin solapar.
    const windows = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + CHUNK_DAYS)) {
        const wEnd = new Date(d); wEnd.setUTCDate(wEnd.getUTCDate() + CHUNK_DAYS - 1);
        windows.push([dateToYmd(d), dateToYmd(wEnd <= end ? wEnd : end)]);
    }
    const seen = new Map();
    let anyOk = false, lastErr = null;
    for (const [wFrom, wTo] of windows) {
        try {
            const part = await fetchWindow(wFrom, wTo, opts.timeoutMs);
            anyOk = true;
            for (const m of part) {
                // clave: par de códigos (sin orden) + kickoff → un partido único.
                const key = [m.home, m.away].sort().join('-') + '|' + (m.kickoff || m.stage || '');
                seen.set(key, m);
            }
        } catch (e) { lastErr = e; /* un trozo falla → seguimos con los demás */ }
    }
    if (!anyOk && lastErr) throw lastErr;
    return [...seen.values()];
}

module.exports = { id: 'espn', label: 'ESPN', fetchMatches, _normalize: normalize };
