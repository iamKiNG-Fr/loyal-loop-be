import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MonitoringService } from './monitoring.service';

@Global()
@Module({
  controllers: [HealthController],
  providers: [MonitoringService],
  exports: [MonitoringService],
})
export class MonitoringModule {}
