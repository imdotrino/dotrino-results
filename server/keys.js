'use strict';

// Clave de "match" canónica para alinear el MISMO partido entre proveedores y
// entre el override manual y los datos de proveedor. App-agnóstica: se arma con
// el par de códigos FIFA (sin orden) + si es fase de grupos o eliminatoria.
//
// Por qué el flag grupos/eliminatoria: en un Mundial un par de selecciones juega
// a lo sumo UNA vez por fase, pero podría cruzarse en grupos y de nuevo en una
// eliminatoria. Sin distinguir fase, esas dos se pisarían bajo la misma clave.
// El corte por tiempo de arranque separa limpio: el primer partido de
// eliminatoria (FIFA #73) arranca 2026-06-28T19:00Z y ningún partido de grupos
// arranca después de ~2026-06-28T02:00Z, así que un umbral a mediodía del 28 los
// separa sin depender de etiquetas del proveedor.

const KNOCKOUT_START = Date.parse(process.env.RESULTS_KNOCKOUT_START || '2026-06-28T12:00:00Z');

function phaseOf(kickoffIso) {
    const t = Date.parse(kickoffIso || '') || 0;
    return t >= KNOCKOUT_START ? 'ko' : 'grp';
}

function matchKey(m) {
    const pair = [String(m.home || '').toUpperCase(), String(m.away || '').toUpperCase()]
        .sort()
        .join('-');
    return phaseOf(m.kickoff) + ':' + pair;
}

module.exports = { matchKey, phaseOf, KNOCKOUT_START };
