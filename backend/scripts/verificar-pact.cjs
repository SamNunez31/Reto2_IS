// Verificación del PROVEEDOR (Posada EC) contra el pact de Booking.
//   PROVIDER_URL=http://localhost:8080 SERVICE_API_KEY=... node scripts/verificar-pact.cjs
// Apunta al gateway (8080) o a un servicio directo. Falla (exit 1) si Posada rompe el contrato.
const path = require('path');
// Se usa el motor (pact-core) directamente: el Verifier de pact-js pone un proxy que rompe los POST con cuerpo (408).
const { Verifier } = require('@pact-foundation/pact-core');

const url = process.env.PROVIDER_URL || 'http://localhost:8080';
const llave = process.env.SERVICE_API_KEY || '';

new Verifier({
  provider: 'Posada-EC',
  providerBaseUrl: url,
  pactUrls: [path.resolve(__dirname, '../pacts/Booking-Prototipo-Posada-EC.json')],
  // Booking llama con X-API-Key: contra el proveedor real se reemplaza el valor de ejemplo por la llave de servicio.
  // (customProviderHeaders evita el proxy interno de requestFilter, que no reenvía bien el cuerpo de los POST)
  customProviderHeaders: llave ? ['X-API-Key: ' + llave] : [],
  // Sin stateHandlers a propósito: los estados del contrato ("existen tipos de alojamiento", etc.) ya se cumplen con los datos
  // reales del servicio, y declararlos hace que pact-js ponga un proxy que no reenvía el cuerpo de los POST (408).
  logLevel: process.env.PACT_LOG || 'warn',
})
  .verify()
  .then(() => console.log('\nContrato verificado: Posada EC cumple lo que Booking espera.'))
  .catch((e) => { console.error('\nEl proveedor NO cumple el contrato:', e.message || e); process.exit(1); });
