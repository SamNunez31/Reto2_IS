#!/usr/bin/env node
/**
 * Genera gateway/kong.tmpl.yml (Kong DB-less) a partir de las MISMAS reglas de enrutamiento que usa
 * cada microservicio (backend/src/common/middleware/rol-servicio.ts). Una sola fuente de verdad:
 * si cambia el reparto de rutas, se regenera el gateway y no se desalinean.
 *
 *   node gateway/generar-kong.js           escribe gateway/kong.tmpl.yml
 *   node gateway/generar-kong.js --check   falla (exit 1) si el archivo está desactualizado
 *
 * Los secretos y las URLs NO van en el archivo: llevan marcadores __X__ que el entrypoint del
 * contenedor reemplaza con variables de entorno (Azure Container Apps).
 */
const fs = require('fs');
const path = require('path');
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '../backend')] }));

const SALIDA = path.join(__dirname, 'kong.tmpl.yml');
const fuente = fs.readFileSync(path.join(__dirname, '../backend/src/common/middleware/rol-servicio.ts'), 'utf8')
  .replace(/import .*problem.*\n/, '').replace(/import .*express.*\n/, '');
const js = ts.transpileModule(fuente, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const { REGLAS, ROLES } = m.exports;

const aKong = (re) => '~' + re.source.replace(/^\^/, '').replace(/\\\//g, '/');
const q = (s) => JSON.stringify(s);
const L = [];
const w = (s = '') => L.push(s);

w('# GENERADO por gateway/generar-kong.js — no editar a mano (npm run gateway:generar en backend).');
w('_format_version: "3.0"');
w('_transform: true');
w('');
w('services:');
for (const rol of ROLES) {
  w(`  - name: ${rol}`);
  w(`    url: __UPSTREAM_${rol.toUpperCase()}__`);
  w('    retries: 2');
  w('    connect_timeout: 30000   # scale-to-zero: el primer paquete puede esperar el arranque en frío');
  w('    read_timeout: 60000');
  w('    write_timeout: 60000');
  w('    routes:');
  let prioridad = 1000;
  // Salud y estado: siempre al servicio de reservas (lo mantiene activo con el monitor de Booking).
  if (rol === 'reservations') {
    w('      - name: health-raiz');
    w('        paths: [' + q('~/health$') + ']');
    w('        regex_priority: 2000');
    w('        strip_path: false');
    w('      - name: health-v1');
    w('        paths: [' + q('~/api/v1/health$') + ']');
    w('        regex_priority: 2000');
    w('        strip_path: false');
    w('      - name: health-v2');
    w('        paths: [' + q('~/api/v2/alojamientos/health$') + ']');
    w('        regex_priority: 2000');
    w('        strip_path: false');
  }
  if (rol === 'catalog') {
    // Datos casi estáticos y públicos: se cachean en el borde (S8, proxy-cache).
    w('      - name: catalogo-cache-tipos');
    w('        paths: [' + q('~/api/v2/alojamientos/tipos$') + ']');
    w('        methods: [GET]');
    w('        regex_priority: 1500');
    w('        strip_path: false');
    w('        plugins:');
    w('          - name: proxy-cache');
    w('            config: { strategy: memory, request_method: [GET], response_code: [200], content_type: ["application/json"], cache_ttl: 60 }');
  }
  for (const [re, r] of REGLAS) {
    prioridad--;
    if (r !== rol) continue;
    const nombre = `${rol}-${REGLAS.findIndex((x) => x[0] === re) + 1}`;
    w(`      - name: ${nombre}`);
    w('        paths: [' + q(aKong(re)) + ']');
    w(`        regex_priority: ${prioridad}`);
    w('        strip_path: false');
  }
}
w('');
w('  # Estado del propio gateway (S8: "no monitorear el Gateway" es un error común).');
w('  - name: gateway-estado');
w('    url: http://127.0.0.1:8000');
w('    routes:');
w('      - name: gateway-health');
w('        paths: [' + q('~/gateway/health$') + ']');
w('        regex_priority: 3000');
w('        strip_path: false');
w('        plugins:');
w('          - name: request-termination');
w('            config: { status_code: 200, content_type: "application/json", body: \'{"status":"UP","gateway":"kong","node":"NODE_ALO_PEC"}\' }');
w('');
w('consumers:');
w('  - username: booking          # Booking Prototipo (identificado por X-API-Key)');
w('    keyauth_credentials:');
w('      - key: __SERVICE_API_KEY__');
w('    plugins:');
w('      - name: rate-limiting');
w('        config: { minute: 1200, policy: local, limit_by: consumer }');
w('  - username: anonimo          # sin llave: frontend propio, health checks y tráfico no identificado');
w('');
w('plugins:');
w('  - name: key-auth             # identifica al consumidor; "anonymous" deja pasar y el backend decide con JWT + scopes');
w('    config: { key_names: ["X-API-Key"], anonymous: anonimo, hide_credentials: false }');
w('  - name: rate-limiting        # límite por IP para el tráfico no identificado (el de Booking es mayor, por consumer)');
w('    config: { minute: 240, policy: local, limit_by: ip }');
w('  - name: correlation-id       # trazabilidad: el gateway inyecta X-Correlation-Id si el cliente no lo trae');
w('    config: { header_name: X-Correlation-Id, generator: uuid, echo_downstream: true }');
w('  - name: request-size-limiting');
w('    config: { allowed_payload_size: 200, size_unit: kilobytes }');
w('  - name: response-transformer');
w('    config: { add: { headers: ["X-Gateway: posada-kong"] } }');
w('  - name: prometheus           # métricas del gateway en el puerto de estado (8100) /metrics');
w('    config: { per_consumer: true, status_code_metrics: true, latency_metrics: true }');
w('');

const salida = L.join('\n');
if (process.argv.includes('--check')) {
  const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, 'utf8') : '';
  if (actual !== salida) { console.error('gateway/kong.tmpl.yml está desactualizado: ejecuta node gateway/generar-kong.js'); process.exit(1); }
  console.log('gateway/kong.tmpl.yml al día');
} else {
  fs.writeFileSync(SALIDA, salida);
  console.log(`Escrito ${path.relative(process.cwd(), SALIDA)} (${REGLAS.length} reglas + 4 servicios)`);
}
