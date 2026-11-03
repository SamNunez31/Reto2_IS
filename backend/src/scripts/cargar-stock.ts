import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { StockGrpcService } from '../modules/stock-grpc/stock-grpc.service';

/**
 * Carga inicial / reconciliación del stock: envía a Booking, por gRPC, el cupo absoluto de cada
 * noche de los próximos N días (por defecto 90) de todas las unidades publicadas.
 *   npm run stock:cargar            ->  90 días
 *   npm run stock:cargar -- 30      ->  30 días
 */
async function main(): Promise<void> {
  const dias = Number(process.argv[2]) || 90;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const stock = app.get(StockGrpcService);
  if (!stock.habilitado) {
    console.error('STOCK_GRPC_TARGET está vacío en backend/.env (ejemplo: STOCK_GRPC_TARGET=100.x.y.z:50051).');
    await app.close();
    process.exit(1);
  }
  console.log(`Enviando stock de los próximos ${dias} días a ${stock.objetivo} ...`);
  const r = await stock.cargarTodo(dias);
  console.log(`Listo: ${r.mensajes} mensajes, ${r.enviados} aceptados, ${r.obsoletos} obsoletos (Booking ya tenía algo más nuevo), ${r.fallidos} fallidos.`);
  const muestra = await stock.verificarMuestra(3);
  for (const v of muestra) console.log(`  verificación ${v.item} ${v.fecha}: nosotros ${v.nuestro} · Booking ${v.booking ?? '-'} -> ${v.estado}`);
  await app.close();
  process.exit(r.fallidos ? 1 : 0);
}
void main();
