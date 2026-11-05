import { Module } from '@nestjs/common';
import { HostController } from './host.controller';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { HostService } from './host.service';

@Module({
  controllers: [HostController],
  providers: [HostService, NotificadorCheckin],
})
export class HostModule {}
