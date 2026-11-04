// Verificación del PROVEEDOR (Posada EC) contra el pact de Booking.
//   PROVIDER_URL=http://localhost:8080 SERVICE_API_KEY=... node scripts/verificar-pact.cjs
// Apunta al gateway (8080) o a un servicio directo. Falla (exit 1) si Posada rompe el contrato.
const path = require('path');
const { Verifier } = require('@pact-foundation/pact');

const url = process.env.PROVIDER_URL || 'http://localhost:8080';
const llave = process.env.SERVICE_API_KEY || '';

new Verifier({
  provider: 'Posada-EC',
  providerBaseUrl: url,
  pactUrls: [path.resolve(__dirname, '../pacts/Booking-Prototipo-Posada-EC.json')],
  // El pact lleva un Bearer de ejemplo; contra el proveedor real se autentica con la API key de servicio.
  requestFilter: (req, _res, next) => {
    delete req.headers['authorization'];
    if (llave) req.headers['x-api-key'] = llave;
    next();
  },
  stateHandlers: {
    'la base de datos está conectada': async () => 'ok',
    'existen tipos de alojamiento': async () => 'ok',
  },
  logLevel: 'warn',
})
  .verifyProvider()
  .then(() => console.log('\nContrato verificado: Posada EC cumple lo que Booking espera.'))
  .catch((e) => { console.error('\nEl proveedor NO cumple el contrato:', e.message || e); process.exit(1); });
