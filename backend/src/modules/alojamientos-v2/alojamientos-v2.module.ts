import { Module } from '@nestjs/common';
import { AlojamientosV2Controller } from './alojamientos-v2.controller';
import { ClientesV2Controller } from './clientes-v2.controller';
import { AlojamientosV2Service } from './alojamientos-v2.service';

/** Capa del contrato v2.2.0 (Reto 2). El acceso a datos va por DbService (módulo global). */
@Module({
  controllers: [AlojamientosV2Controller, ClientesV2Controller],
  providers: [AlojamientosV2Service],
})
export class AlojamientosV2Module {}
