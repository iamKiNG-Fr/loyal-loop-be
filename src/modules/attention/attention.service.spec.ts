import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { assertTrustedPushEndpoint } from "./attention.service";

describe("owner attention safety", () => {
  it("accepts known browser push services and rejects arbitrary HTTPS callbacks", () => {
    expect(() => assertTrustedPushEndpoint("https://fcm.googleapis.com/fcm/send/example")).not.toThrow();
    expect(() => assertTrustedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/example")).not.toThrow();
    expect(() => assertTrustedPushEndpoint("https://web.push.apple.com/Q/example")).not.toThrow();
    expect(() => assertTrustedPushEndpoint("https://example.internal/reminder-hook")).toThrow(BadRequestException);
  });
});
