// Ecosystem de PM2 para dotrino-results (referencia; en proxy2 vive como
// ~/cc-results.config.cjs). PM2 NO lee EnvironmentFile, así que el `env` va acá
// con los valores parseados de server/.env. Deploy: `pm2 start ~/cc-results.config.cjs`
// y persistencia en boot con `pm2 save` (pm2-seyacat.service ya instalado).
//
// CD (cc-deploy-listener): git pull en ~/dotrino-results + `pm2 restart dotrino-results`.

module.exports = {
  apps: [{
    name: 'dotrino-results',
    cwd: process.env.HOME + '/dotrino-results/server',
    script: 'server.js',
    interpreter: 'node',
    autorestart: true,
    max_restarts: 20,
    env: {
      PORT: '8092',
      RESULTS_COMPETITION: 'fifa.world.2026',
      RESULTS_FROM: '20260611',
      RESULTS_TO: '20260719',
      RESULTS_PROVIDERS: 'espn,fifa',
      RESULTS_POLL_MS: '30000',
      // Pegá acá el/los thumbprint(s) admin (pubkeyId hex) separados por coma.
      RESULTS_ADMIN_PUBKEYS: '',
      // RESULTS_PRIVATE_JWK vacío → clave persistida en server/data/relay-key.json
    },
  }],
};
