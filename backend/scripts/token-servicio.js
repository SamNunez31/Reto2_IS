#!/usr/bin/env node
/**
 * Genera el token Bearer (JWT HS256) de la CUENTA DE SERVICIO del ESB de Booking.
 *
 *   npm run token:servicio                 -> token de 30 días con los scopes del contrato
 *   npm run token:servicio -- --dias=7     -> otra duración
 *
 * Se entrega a Booking solo durante la prueba. Para revocarlo: cambiar JWT_SECRET o desactivar la cuenta
 *   UPDATE usuario SET activo = false WHERE email = 'esb-booking@servicio.posada.ec';
 * (el guard consulta la BD en cada petición, con una caché de 10 s).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const jwt = require('jsonwebtoken');
const { Client } = require('pg');

const EMAIL = 'esb-booking@servicio.posada.ec';
const SCOPES = 'alojamientos:read alojamientos:book alojamientos:cancel alojamientos:checkin alojamientos:inventory';
const dias = Number((process.argv.find((a) => a.startsWith('--dias=')) || '--dias=30').split('=')[1]) || 30;

async function main() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    console.error('Falta DATABASE_URL o JWT_SECRET en backend/.env');
    process.exit(1);
  }
  const cliente = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /supabase|sslmode=require/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
  });
  await cliente.connect();
  const r = await cliente.query(`SELECT id FROM booking.usuario WHERE email = $1 AND activo`, [EMAIL]);
  await cliente.end();
  if (!r.rows.length) {
    console.error(`No existe la cuenta de servicio ${EMAIL}. Ejecuta database/04_v2_integracion.sql.`);
    process.exit(1);
  }
  const token = jwt.sign({ sub: r.rows[0].id, email: EMAIL, rol: 'USUARIO', scope: SCOPES }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${dias}d`,
  });
  const base = process.env.API_PUBLIC_URL || 'http://localhost:3000';
  console.log(`\nToken de servicio (vence en ${dias} días, scopes: ${SCOPES}):\n\n${token}\n`);
  console.log(`Prueba rápida:\n  curl -H "Authorization: Bearer <token>" ${base}/api/v2/alojamientos/orders/ORD-HTL-XXXXXXXX\n`);
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
