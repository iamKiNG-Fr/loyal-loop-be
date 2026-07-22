import { describe, expect, it } from "vitest";
import {
  assessDeliveryCoverage,
  canonicalNigerianState,
  customerFulfillmentMethods,
} from "./delivery-eligibility";

describe("delivery eligibility", () => {
  it("matches structured Google address state data against the shop's Nigerian states", () => {
    expect(assessDeliveryCoverage({
      administrativeArea1: "Lagos State",
      countryCode: "ng",
      deliveryStates: ["Lagos", "Ogun"],
    })).toEqual({ administrativeArea1: "Lagos", status: "ELIGIBLE" });

    expect(assessDeliveryCoverage({
      administrativeArea1: "Rivers State",
      countryCode: "NG",
      deliveryStates: ["Lagos", "Ogun"],
    })).toEqual({ administrativeArea1: "Rivers", status: "OUTSIDE_AREA" });
  });

  it("marks manual addresses for review when state-restricted coverage cannot be established", () => {
    expect(assessDeliveryCoverage({
      address: "Near the blue gate",
      deliveryStates: ["Lagos"],
    })).toEqual({ status: "NEEDS_REVIEW" });
  });

  it("normalizes FCT aliases and keeps arrange-later opt-in", () => {
    expect(canonicalNigerianState("FCT Abuja")).toBe("Federal Capital Territory");
    expect(customerFulfillmentMethods(["DELIVERY", "NOT_REQUIRED"])).toEqual(["DELIVERY"]);
    expect(customerFulfillmentMethods([])).toEqual(["DELIVERY", "PICKUP"]);
  });
});
