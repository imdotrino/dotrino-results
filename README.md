# dotrino-results

Relay de **resultados oficiales en vivo** del ecosistema Dotrino
(`results.dotrino.com`). Centraliza —en **un solo punto, del lado del
servidor**— la consulta a los proveedores de marcadores y sirve a las apps un
**feed firmado**. Estrenado en el **Pronosticador Mundialista**, pero el feed es
app-agnóstico: cualquier app del ecosistema puede consumirlo.

## Por qué un relay (y no que cada app pegue al proveedor)

- **Sin filtrar IPs a terceros.** Si cada navegador pegara a ESPN/FIFA, la IP de
  cada visitante iría a un tercero (rompe la filosofía *tu info en tu servidor*).
  Acá **solo la IP del relay** toca a los proveedores.
- **Un solo punto de arreglo, sin redeploy.** Si un proveedor falla o cambia, se
  arregla/limpia caché en el relay; las apps no se tocan.
- **Anti-429 / anti-abuso.** El riesgo no era nuestro server: eran *miles de
  clientes* pegando a la vez cuando arranca un partido. Una sola IP poll-ea con
  caché; los proveedores ni se enteran.
- **Firmado.** El feed va en un sobre ECDSA P-256 (canónico, `ieee-p1363`, el
  mismo del resto del ecosistema). El cliente lo verifica contra la **pubkey
  pineada** del relay: nadie puede falsear resultados oficiales.

## Fuentes (cadena de fallback)

| Orden | Proveedor | Key | Notas |
|------:|-----------|-----|-------|
| 1 | **ESPN** (API oculta) | no | `competitor.winner` autoritativo, penales (`shootoutScore`), `state` pre/in/post. Códigos FIFA. |
| 2 | **FIFA** (`api.fifa.com` v3) | no | Códigos FIFA nativos, 104 partidos en una request, `Winner`=IdTeam, `ResultType`=2 (penales). |

El **mejor proveedor** manda por partido; los demás **rellenan** lo que falte o
aportan un estado más avanzado (terminado > en juego > programado). Se configura
con `RESULTS_PROVIDERS=espn,fifa`. Agregar uno = un módulo en `server/providers/`
con `{ id, label, fetchMatches(opts) }` que normalice al shape común.

## Resultados manuales = "state of truth"

Lo que carga el **admin** (firmado por su **vault** de identidad) **gana siempre**
sobre los proveedores; los proveedores rellenan el resto. No hay token ni secreto
compartido: el relay **verifica la firma** del sobre y que el `pubkey` del autor
esté en la **allowlist** (`RESULTS_ADMIN_PUBKEYS`). `clear:true` borra un override
y el partido vuelve al dato del proveedor.

## Endpoints

- `GET /official[?source=espn|fifa|manual|merged]` → `{ data, signature }`. Por
  defecto `merged` (proveedores + overrides). `data.matches` = mejor dato de
  proveedor por partido; `data.overrides` = manuales (ganan). Cada partido lleva
  `source` (procedencia). El cliente aplica `matches` y luego `overrides`.
- `GET /pubkey` → clave pública del relay (la que se **pinea** en el cliente).
- `GET /health` → liveness + conteo por proveedor + overrides.
- `POST /admin/result` → `{ data, signature }` firmado por el vault del admin.
  `data = { op:'set-official', competition, issuedAt, publickey, matches:[ {home,
  away, kickoff?, homeGoals, awayGoals, homePens?, awayPens?, winner?, clear?} ] }`.

### Shape de un partido (app-agnóstico)

```jsonc
{ "home":"MEX", "away":"RSA", "kickoff":"2026-06-11T19:00Z",
  "status":"scheduled|in|final", "started":false, "finished":false,
  "homeGoals":null, "awayGoals":null, "homePens":null, "awayPens":null,
  "winner":null, "source":"espn|fifa|manual" }
```

El cliente mapea cada partido a su fixture interno por el **par de códigos FIFA**
(grupos) o resolviendo la llave (eliminatorias); el relay no necesita conocer el
fixture de cada app.

## Deploy

**Producción (proxy2, PM2):** ver `deploy/cc-results.config.cjs`. Corre como app
PM2 `dotrino-results` en `:8092`, detrás de nginx (`results.dotrino.com` +
certbot). CD por [cc-deploy-listener]: `git pull` + `pm2 restart`.

**Autohospedaje turnkey (Docker):**
```bash
RESULTS_DOMAIN=results.tudominio RESULTS_ADMIN_PUBKEYS=<thumbprint> docker compose up -d
```
Caddy termina TLS automático. Imagen multi-arch en `ghcr.io/dotrino/dotrino-results`.

## Config (env)

Ver `server/.env.example`. Lo más usado: `RESULTS_ADMIN_PUBKEYS` (allowlist de
admins), `RESULTS_PROVIDERS` (cadena), `RESULTS_POLL_MS`, `RESULTS_FROM`/`RESULTS_TO`.

[cc-deploy-listener]: https://github.com/imdotrino/cc-deploy-listener
