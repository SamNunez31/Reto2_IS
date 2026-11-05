// Prueba pura del reparto de rutas por servicio (sin base de datos). Uso: node scripts/prueba-rol-servicio.cjs
const ts = require('typescript'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/common/middleware/rol-servicio.ts'), 'utf8')
  .replace(/import .*problem.*\n/, '').replace(/import .*express.*\n/, '');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const { atiende, servicioDeRuta } = m.exports;
let fallos = 0;
const t = (cond, nombre) => { console.log((cond ? 'OK   ' : 'FALLA') + ' ' + nombre); if (!cond) fallos++; };
const casos = [
  ['/api/v1/auth/login', 'identity'], ['/api/v1/me', 'identity'], ['/api/v1/search', 'catalog'],
  ['/api/v1/orders/abc/review', 'catalog'], ['/api/v1/orders', 'reservations'], ['/api/v1/webhooks/x', 'integration'],
  ['/api/v2/clientes', 'identity'], ['/api/v1/host/orders/abc/arrival', 'reservations'],
  ['/api/v2/alojamientos', 'catalog'], ['/api/v2/alojamientos/HTL-1', 'catalog'], ['/api/v2/alojamientos/categorias', 'catalog'],
  ['/api/v2/alojamientos/orders/create', 'reservations'], ['/api/v2/alojamientos/HTL-1/inventario', 'reservations'],
  ['/api/v2/alojamientos/availability', 'reservations'], ['/api/v2/alojamientos/eventos', 'integration'],
  ['/api/v2/alojamientos/promociones/contrato', 'integration'], ['/api/v2/alojamientos/HTL-1/reviews', 'catalog'],
];
for (const [r, s] of casos) t(servicioDeRuta(r) === s, `${r} -> ${s}`);
for (const h of ['/health', '/api/v2/alojamientos/health']) for (const rol of ['identity', 'catalog', 'reservations', 'integration']) t(atiende(rol, h), `${h} en ${rol}`);
t(atiende('all', '/lo/que/sea'), 'rol all atiende todo');
t(!atiende('catalog', '/api/v1/auth/login'), 'catalog rechaza /auth');
console.log(fallos ? `\n${fallos} fallos` : '\nTodo OK'); process.exit(fallos ? 1 : 0);
