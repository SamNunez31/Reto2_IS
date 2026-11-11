import { Module } from '@nestjs/common';
import { HostController } from './host.controller';
import { NotificadorCheckin } from '../integracion/notificador-checkin';
import { NotificadorCheckout } from '../integracion/notificador-checkout';
import { HostService } from './host.service';

@Module({
  controllers: [HostController],
  providers: [HostService, NotificadorCheckin, NotificadorCheckout],
})
export class HostModule {}
