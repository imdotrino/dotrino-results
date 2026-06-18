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

async function fetchMatches(opts) {
    const url = `${BASE}?dates=${opts.fromYmd}-${opts.toYmd}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } }); }
    finally { clearTimeout(t); }
    if (!res.ok) throw new Error('espn http ' + res.status);
    return normalize(await res.json());
}

module.exports = { id: 'espn', label: 'ESPN', fetchMatches, _normalize: normalize };
