import { IsIn, IsUUID } from "class-validator";

export const PWA_TELEMETRY_EVENTS = [
  "PROMPT_SHOWN",
  "PROMPT_ACCEPTED",
  "PROMPT_DISMISSED",
  "INSTALL_GUIDE_OPENED",
  "INSTALLED",
  "STANDALONE_LAUNCH",
] as const;

export const PWA_PLATFORMS = ["ANDROID", "IOS", "DESKTOP", "OTHER"] as const;
export const PWA_AUDIENCES = ["OWNER", "CUSTOMER", "PUBLIC"] as const;

export type PwaTelemetryEvent = typeof PWA_TELEMETRY_EVENTS[number];
export type PwaPlatform = typeof PWA_PLATFORMS[number];
export type PwaAudience = typeof PWA_AUDIENCES[number];

export class PwaTelemetryDto {
  @IsUUID("4")
  installationId!: string;

  @IsIn(PWA_TELEMETRY_EVENTS)
  event!: PwaTelemetryEvent;

  @IsIn(PWA_PLATFORMS)
  platform!: PwaPlatform;

  @IsIn(PWA_AUDIENCES)
  audience!: PwaAudience;
}
