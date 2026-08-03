import { Body, Controller, Post } from "@nestjs/common";
import { ok } from "../../common/api-response";
import { PwaTelemetryDto } from "./dto/pwa-telemetry.dto";
import { PwaTelemetryService } from "./pwa-telemetry.service";

@Controller("pwa")
export class PwaTelemetryController {
  constructor(private readonly telemetry: PwaTelemetryService) {}

  @Post("telemetry")
  async record(@Body() dto: PwaTelemetryDto) {
    return ok(await this.telemetry.record(dto));
  }
}
