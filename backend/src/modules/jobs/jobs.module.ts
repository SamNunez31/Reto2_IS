import { Module } from '@nestjs/common';
import { AuditoriaConsumidor, BusEventos } from './bus-eventos';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { NotificadorCheckout } from '../integracion/notificador-checkout';
import { JobsService } from './jobs.service';

@Module({
  providers: [BusEventos, AuditoriaConsumidor, JobsService, NotificadorCheckin, NotificadorCheckout],
  exports: [JobsService, BusEventos],
})
export class JobsModule {}
