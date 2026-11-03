/**
 * Booking falso para probar el aviso de stock REST sin tocar el real.
 *   1) node scripts/mock-booking-stock.cjs            (escucha en :4010 e imprime cada aviso)
 *   2) arrancar el backend con STOCK_REST_URL=http://127.0.0.1:4010 y STOCK_REST_API_KEY=prueba
 *   3) crear o cancelar una reserva (p. ej. npm run test:v2) y mirar esta ventana
 */
const http = require('http');
let n = 0;
http.createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => (cuerpo += c));
  req.on('end', () => {
    n++;
    console.log(`#${n} ${req.method} ${req.url} x-api-key=${req.headers['x-api-key'] || '(ninguna)'} ${cuerpo}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}).listen(4010, () => console.log('Booking falso escuchando en http://127.0.0.1:4010'));
