import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { StockGrpcService } from './stock-grpc.service';

/** Cliente gRPC del stock hacia Booking (contrato v2 §5). El acceso a datos va por DbService (módulo global). */
@Module({
  imports: [JobsModule],
  providers: [StockGrpcService],
  exports: [StockGrpcService],
})
export class StockGrpcModule {}
