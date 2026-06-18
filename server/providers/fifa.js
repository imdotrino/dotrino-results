'use strict';

// Proveedor FALLBACK: API oficial de la FIFA (api.fifa.com v3). Sin API key,
// códigos FIFA nativos (mismos que ESPN → la clave de match alinea sin mapear),
// 104 partidos en una request. Es la fuente que publica fifa.com.
//   https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=200&language=en
// Campos por partido (Results[]): Home/Away.Abbreviation (código FIFA),
// Home/Away.IdTeam, HomeTeamScore/AwayTeamScore, HomeTeamPenaltyScore/...,
// Winner (= IdTeam ganador; null = empate/sin decidir), MatchStatus (1=pre,
// 0=post/terminado, otro=en juego), ResultType (2=penales), Date (ISO Z).

const BASE = process.env.RESULTS_FIFA_BASE || 'https://api.fifa.com/api/v3/calendar/matches';
const ID_COMPETITION = process.env.RESULTS_FIFA_COMPETITION || '17';
const ID_SEASON = process.env.RESULTS_FIFA_SEASON || '285023'; // FIFA World Cup 2026

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }

function normalize(json) {
    const out = [];
    const results = (json && (json.Results || json.results)) || [];
    for (const m of results) {
        const H = m.Home || {}, A = m.Away || {};
        const hCode = String(H.Abbreviation || H.IdCountry || '').toUpperCase();
        const aCode = String(A.Abbreviation || A.IdCountry || '').toUpperCase();
        if (!hCode || !aCode) continue; // partidos con plantel sin definir (placeholders)
        const status = m.MatchStatus;
        const finished = status === 0;
        const started = status !== 1; // 1 = programado/pre
        const hG = started ? num(m.HomeTeamScore) : null;
        const aG = started ? num(m.AwayTeamScore) : null;
        const isPens = m.ResultType === 2;
        const hP = isPens ? num(m.HomeTeamPenaltyScore) : null;
        const aP = isPens ? num(m.AwayTeamPenaltyScore) : null;
        let winner = null;
        if (finished && m.Winner != null) {
            if (String(m.Winner) === String(H.IdTeam)) winner = hCode;
            else if (String(m.Winner) === String(A.IdTeam)) winner = aCode;
        }
        out.push({
            home: hCode, away: aCode, kickoff: m.Date || null, stage: null,
            status: finished ? 'final' : (started ? 'in' : 'scheduled'),
            started, finished,
            homeGoals: hG, awayGoals: aG, homePens: hP, awayPens: aP,
            winner, source: 'fifa',
        });
    }
    return out;
}

async function fetchMatches(opts) {
    const url = `${BASE}?idCompetition=${ID_COMPETITION}&idSeason=${ID_SEASON}&count=200&language=en`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 12000);
    let res;
    try { res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } }); }
    finally { clearTimeout(t); }
    if (!res.ok) throw new Error('fifa http ' + res.status);
    return normalize(await res.json());
}

module.exports = { id: 'fifa', label: 'FIFA', fetchMatches, _normalize: normalize };
