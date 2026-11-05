'use strict';

// Quién gana un partido por el marcador: los penales, si hubo; si no, los goles. Un empate
// sin penales no tiene ganador (null). Una sola regla para el proveedor (ESPN) y para el
// override manual del admin, que antes la tenían copiada cada uno.

/**
 * @param {{ home: string, away: string, homeGoals: number|null, awayGoals: number|null, homePens?: number|null, awayPens?: number|null }} m
 * @returns {string|null} el código del ganador, o null
 */
function winnerByScore({ home, away, homeGoals: hG, awayGoals: aG, homePens: hP = null, awayPens: aP = null }) {
    if (hG == null || aG == null) return null;
    const byPens = hP != null && aP != null && (hP || aP);
    const hWin = byPens ? hP > aP : hG > aG;
    const aWin = byPens ? aP > hP : aG > hG;
    return hWin ? home : (aWin ? away : null);
}

module.exports = { winnerByScore };
