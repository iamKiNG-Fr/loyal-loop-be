import type { FulfillmentType } from "../generated/prisma/client";

export const NIGERIAN_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Federal Capital Territory",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const;

type DeliveryCoverageInput = {
  address?: string | null;
  administrativeArea1?: string | null;
  countryCode?: string | null;
  deliveryAreas?: string[] | null;
  deliveryStates?: string[] | null;
};

export type DeliveryCoverageResult = {
  administrativeArea1?: string;
  status: "ELIGIBLE" | "NEEDS_REVIEW" | "OUTSIDE_AREA";
};

export function assessDeliveryCoverage(input: DeliveryCoverageInput): DeliveryCoverageResult {
  const countryCode = input.countryCode?.trim().toUpperCase();
  if (countryCode && countryCode !== "NG") return { status: "OUTSIDE_AREA" };

  const state = canonicalNigerianState(input.administrativeArea1)
    ?? stateFromAddress(input.address);
  const allowedStates = (input.deliveryStates ?? [])
    .map((value) => canonicalNigerianState(value))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  if (allowedStates.length) {
    if (!state) return { status: "NEEDS_REVIEW" };
    return {
      administrativeArea1: state,
      status: allowedStates.includes(state) ? "ELIGIBLE" : "OUTSIDE_AREA",
    };
  }

  const areas = (input.deliveryAreas ?? []).map(normalizeLocation).filter(Boolean);
  if (areas.length) {
    const address = normalizeLocation(input.address ?? "");
    const covered = areas.some((area) => address.includes(area));
    return { administrativeArea1: state, status: covered ? "ELIGIBLE" : "OUTSIDE_AREA" };
  }

  return { administrativeArea1: state, status: "ELIGIBLE" };
}

export function canonicalNigerianState(value?: string | null) {
  const normalized = normalizeLocation(value ?? "");
  if (!normalized) return undefined;
  if (["abuja", "fct", "fct abuja", "federal capital territory"].includes(normalized)) {
    return "Federal Capital Territory";
  }
  return NIGERIAN_STATES.find((state) => {
    const candidate = normalizeLocation(state);
    return normalized === candidate || normalized === `${candidate} state`;
  });
}

export function customerFulfillmentMethods(methods?: readonly FulfillmentType[] | null): FulfillmentType[] {
  const configured: FulfillmentType[] = (methods ?? []).filter((method) => method !== "NOT_REQUIRED");
  return configured.length ? configured : ["DELIVERY", "PICKUP"];
}

function stateFromAddress(value?: string | null) {
  const normalized = ` ${normalizeLocation(value ?? "")} `;
  if (!normalized.trim()) return undefined;
  if (/\b(?:abuja|fct|federal capital territory)\b/.test(normalized)) {
    return "Federal Capital Territory";
  }
  return NIGERIAN_STATES.find((state) => {
    const candidate = normalizeLocation(state);
    return normalized.includes(` ${candidate} `)
      || normalized.includes(` ${candidate} state `);
  });
}

function normalizeLocation(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
