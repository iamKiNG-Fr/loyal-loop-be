import { Module } from "@nestjs/common";
import { CustomerReportsController } from "./customer-reports.controller";
import { CustomerReportsService } from "./customer-reports.service";

@Module({
  controllers: [CustomerReportsController],
  providers: [CustomerReportsService],
})
export class CustomerReportsModule {}
