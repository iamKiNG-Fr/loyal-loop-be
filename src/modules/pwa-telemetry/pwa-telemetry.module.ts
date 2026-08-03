import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { PwaTelemetryController } from "./pwa-telemetry.controller";
import { PwaTelemetryService } from "./pwa-telemetry.service";

@Module({
  imports: [PrismaModule],
  controllers: [PwaTelemetryController],
  providers: [PwaTelemetryService],
  exports: [PwaTelemetryService],
})
export class PwaTelemetryModule {}
