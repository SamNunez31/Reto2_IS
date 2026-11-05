import { Module } from '@nestjs/common';
import { AuditoriaConsumidor, BusEventos } from './bus-eventos';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { JobsService } from './jobs.service';

@Module({
  providers: [BusEventos, AuditoriaConsumidor, JobsService, NotificadorCheckin],
  exports: [JobsService, BusEventos],
})
export class JobsModule {}
