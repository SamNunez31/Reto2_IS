#!/usr/bin/env node
/**
 * Divide el contrato propio de Posada EC (contracts/posada-ec-openapi.yaml, el "monolito") en UN contrato
 * OpenAPI por microservicio (contracts/services/<servicio>-openapi.yaml).
 *
 *   npm run contract:split          ->  genera / regenera los 4 contratos
 *   npm run contract:split -- --check  ->  no escribe nada: falla si los archivos generados no están al día
 *
 * Reglas del reparto: docs/ARQUITECTURA_MICROSERVICIOS.md §3. Cada ruta pertenece a UN solo servicio
 * (salvo /health, que existe en todos). Los esquemas se copian por cierre transitivo de los $ref que usa
 * cada servicio, así ningún contrato queda con referencias rotas.
 * No cambia lógica de negocio ni toca el contrato oficial de Booking.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const ORIGEN = path.join(ROOT, 'contracts', 'posada-ec-openapi.yaml');
const DESTINO = path.join(ROOT, 'contracts', 'services');
const VERSION_INICIAL = '1.0.0';

/** Primer patrón que coincide gana. Las excepciones van antes que las reglas generales. */
const REGLAS = [
  [/^\/api\/v1\/orders\/\{[a-zA-Z]+\}\/review$/, 'catalog'],
  [/^\/api\/v1\/host\/reviews(\/|$)/, 'catalog'],
  [/^\/api\/v1\/host\/accommodations\/\{[a-zA-Z]+\}\/units$/, 'reservations'],
  [/^\/api\/v1\/host\/units(\/|$)/, 'reservations'],
  [/^\/api\/v1\/host\/accommodations(\/|$)/, 'catalog'],
  [/^\/api\/v1\/host\/(orders|income)(\/|$)/, 'reservations'],
  [/^\/api\/v1\/auth(\/|$)/, 'identity'],
  [/^\/api\/v1\/me$/, 'identity'],
  [/^\/api\/v1\/me\/orders$/, 'reservations'],
  [/^\/api\/v1\/admin\/users(\/|$)/, 'identity'],
  [/^\/api\/v1\/admin\/(accommodations|catalogs)(\/|$)/, 'catalog'],
  [/^\/api\/v1\/admin\/(taxes|indicators|sales-by-city|top-accommodations)(\/|$)/, 'reservations'],
  [/^\/api\/v1\/admin\/(events|jobs)(\/|$)/, 'integration'],
  [/^\/api\/v1\/webhooks(\/|$)/, 'integration'],
  [/^\/api\/v1\/(search|details|chains|constants|reviews)(\/|$)/, 'catalog'],
  [/^\/api\/v1\/(availability|bulk-availability|orders)(\/|$)/, 'reservations'],
];

/** Metadatos que se escriben en cada contrato (x-servicio). Deben coincidir con la arquitectura. */
const SERVICIOS = {
  identity: {
    titulo: 'Posada EC — Servicio de Identidad',
    descripcion: 'Registro, inicio de sesión, emisión y validación de JWT, perfil y administración de usuarios y roles.',
    tablas: ['usuario', 'token_usuario'],
    publica: ['UsuarioRegistrado', 'UsuarioActualizado', 'UsuarioDesactivado'],
    consume: [],
  },
  catalog: {
    titulo: 'Posada EC — Servicio de Catálogo y Búsqueda',
    descripcion: 'Alojamientos, imágenes, amenidades, ciudades, búsqueda y reseñas. Es el dueño de los datos descriptivos del alojamiento.',
    tablas: ['alojamiento', 'imagen_alojamiento', 'alojamiento_amenidad', 'amenidad', 'ciudad', 'tipo_alojamiento', 'politica_cancelacion', 'politica_cancelacion_regla', 'resena'],
    publica: ['AlojamientoPublicado', 'AlojamientoActualizado', 'AlojamientoSuspendido', 'ResenaPublicada'],
    consume: ['EstanciaCompletada', 'UsuarioActualizado'],
  },
  reservations: {
    titulo: 'Posada EC — Servicio de Inventario, Precios y Reservas',
    descripcion: 'Unidades vendibles, calendario de cupo, precios e impuestos, cotizaciones, órdenes (v1 y canal Booking v2), cancelaciones, pagos y facturas. La frontera del servicio es la frontera de la transacción de reserva.',
    tablas: ['unidad_alojamiento', 'calendario_unidad', 'impuesto_tarifa', 'reserva', 'reserva_detalle', 'cancelacion', 'orden_preview', 'cotizacion_v2', 'orden_v2', 'idempotencia', 'pago', 'factura'],
    publica: ['ReservaCreada', 'ReservaConfirmada', 'ReservaModificada', 'ReservaCancelada', 'ReservaRechazada', 'ReservaExpirada', 'EstanciaCompletada', 'PagoRegistrado', 'ReembolsoRegistrado', 'FacturaEmitida', 'FacturaAnulada', 'StockCambiado'],
    consume: ['AlojamientoPublicado', 'AlojamientoActualizado', 'AlojamientoSuspendido', 'UsuarioActualizado'],
  },
  integration: {
    titulo: 'Posada EC — Servicio de Integración',
    descripcion: 'Webhooks hacia terceros, empuje de stock a Booking por gRPC, trabajos programados y consulta del registro de eventos.',
    tablas: ['webhook_suscripcion', 'webhook_evento', 'webhook_entrega', 'evento_recibido'],
    publica: [],
    consume: ['ReservaCreada', 'ReservaConfirmada', 'ReservaCancelada', 'ReservaRechazada', 'ReservaExpirada', 'EstanciaCompletada', 'StockCambiado'],
  },
};

function servicioDe(ruta) {
  if (ruta === '/health') return 'todos';
  for (const [re, srv] of REGLAS) if (re.test(ruta)) return srv;
  return null;
}

/** Recorre un objeto y devuelve los nombres de esquemas referenciados (#/components/schemas/X). */
function refs(nodo, acc = new Set()) {
  if (Array.isArray(nodo)) nodo.forEach((n) => refs(n, acc));
  else if (nodo && typeof nodo === 'object') {
    for (const [k, v] of Object.entries(nodo)) {
      if (k === '$ref' && typeof v === 'string') {
        const m = /^#\/components\/schemas\/(.+)$/.exec(v);
        if (m) acc.add(m[1]);
      } else refs(v, acc);
    }
  }
  return acc;
}

function cierre(inicio, esquemas) {
  const visto = new Set();
  const cola = [...inicio];
  while (cola.length) {
    const n = cola.pop();
    if (visto.has(n)) continue;
    if (!esquemas[n]) throw new Error(`Esquema referenciado que no existe: ${n}`);
    visto.add(n);
    refs(esquemas[n]).forEach((r) => cola.push(r));
  }
  return visto;
}

function usaSeguridad(paths) {
  const usados = new Set();
  for (const ops of Object.values(paths))
    for (const op of Object.values(ops))
      for (const req of op.security || []) Object.keys(req).forEach((s) => usados.add(s));
  return usados;
}

function main() {
  const soloComprobar = process.argv.includes('--check');
  const base = yaml.load(fs.readFileSync(ORIGEN, 'utf8'));
  const esquemas = base.components.schemas;
  const reparto = Object.fromEntries(Object.keys(SERVICIOS).map((s) => [s, {}]));
  const huerfanas = [];

  for (const [ruta, ops] of Object.entries(base.paths)) {
    const srv = servicioDe(ruta);
    if (!srv) huerfanas.push(ruta);
    else if (srv === 'todos') for (const s of Object.keys(SERVICIOS)) reparto[s][ruta] = ops;
    else reparto[srv][ruta] = ops;
  }
  if (huerfanas.length) {
    console.error('Rutas sin servicio asignado (agrega una regla en REGLAS):\n  ' + huerfanas.join('\n  '));
    process.exit(2);
  }

  const resultados = {};
  for (const [srv, meta] of Object.entries(SERVICIOS)) {
    const paths = reparto[srv];
    const nombres = [...cierre(refs(paths), esquemas)].sort();
    const tagsUsados = new Set();
    for (const ops of Object.values(paths)) for (const op of Object.values(ops)) (op.tags || []).forEach((t) => tagsUsados.add(t));
    const seg = usaSeguridad(paths);
    const doc = {
      openapi: base.openapi,
      info: {
        title: meta.titulo,
        description: `${meta.descripcion}\n\nContrato derivado del contrato propio de Posada EC v${base.info.version}; versión propia de este servicio con SemVer (ver contracts/POLITICA_VERSIONADO.md).`,
        version: VERSION_INICIAL,
      },
      'x-servicio': {
        nombre: srv,
        tablas_propias: meta.tablas,
        eventos_que_publica: meta.publica,
        eventos_que_consume: meta.consume,
        contrato_de_eventos: '../events/posada-events-asyncapi.yaml',
      },
      servers: [{ url: '/', description: 'Detrás del API Gateway (ver docs/ARQUITECTURA_MICROSERVICIOS.md §6)' }],
      tags: (base.tags || []).filter((t) => tagsUsados.has(t.name)),
      paths,
      components: {
        securitySchemes: Object.fromEntries(Object.entries(base.components.securitySchemes).filter(([k]) => seg.has(k))),
        schemas: Object.fromEntries(nombres.map((n) => [n, esquemas[n]])),
      },
    };
    const cabecera =
      `# GENERADO con \`npm run contract:split\` a partir de contracts/posada-ec-openapi.yaml. No editar a mano.\n` +
      `# Servicio: ${srv}. Política de versiones: contracts/POLITICA_VERSIONADO.md\n`;
    resultados[srv] = { texto: cabecera + yaml.dump(doc, { lineWidth: -1, noRefs: true }), rutas: Object.keys(paths).length, esquemas: nombres.length };
  }

  // Cobertura: cada operación del origen debe aparecer exactamente en un servicio (salvo /health).
  const opsOrigen = Object.entries(base.paths).filter(([r]) => r !== '/health').reduce((n, [, o]) => n + Object.keys(o).length, 0);
  const opsRepartidas = Object.values(reparto).reduce(
    (n, paths) => n + Object.entries(paths).filter(([r]) => r !== '/health').reduce((m, [, o]) => m + Object.keys(o).length, 0),
    0,
  );
  if (opsOrigen !== opsRepartidas) {
    console.error(`Cobertura rota: origen ${opsOrigen} operaciones, repartidas ${opsRepartidas}`);
    process.exit(3);
  }

  fs.mkdirSync(DESTINO, { recursive: true });
  let desactualizados = 0;
  for (const [srv, r] of Object.entries(resultados)) {
    const archivo = path.join(DESTINO, `${srv}-openapi.yaml`);
    if (soloComprobar) {
      const actual = fs.existsSync(archivo) ? fs.readFileSync(archivo, 'utf8') : '';
      if (actual !== r.texto) {
        desactualizados++;
        console.error(`DESACTUALIZADO ${path.relative(ROOT, archivo)}`);
      }
    } else {
      fs.writeFileSync(archivo, r.texto, 'utf8');
    }
    console.log(`${soloComprobar ? 'revisado' : 'escrito '} ${srv.padEnd(13)} ${String(r.rutas).padStart(3)} rutas  ${String(r.esquemas).padStart(3)} esquemas`);
  }
  console.log(`Cobertura: ${opsRepartidas}/${opsOrigen} operaciones repartidas, ${huerfanas.length} sin dueño.`);
  if (desactualizados) process.exit(1);
}

main();
