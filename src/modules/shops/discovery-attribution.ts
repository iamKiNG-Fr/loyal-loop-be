export const DISCOVERY_SOURCES = [
  "copy",
  "facebook",
  "instagram",
  "native",
  "snapchat",
  "tiktok",
  "whatsapp",
] as const;

export const DISCOVERY_CAMPAIGNS = [
  "launch_share",
  "product_share",
  "receipt_share",
  "shop_share",
  "trust_card_share",
] as const;

export type DiscoveryAttribution = {
  campaign: (typeof DISCOVERY_CAMPAIGNS)[number];
  medium: "social";
  source: (typeof DISCOVERY_SOURCES)[number];
};

export type DiscoveryQuery = {
  utm_campaign?: string;
  utm_medium?: string;
  utm_source?: string;
};

export function toDiscoveryAttribution(query?: DiscoveryQuery): DiscoveryAttribution | undefined {
  if (!query) return undefined;
  if (query.utm_medium !== "social") return undefined;
  if (!DISCOVERY_SOURCES.includes(query.utm_source as DiscoveryAttribution["source"])) return undefined;
  if (!DISCOVERY_CAMPAIGNS.includes(query.utm_campaign as DiscoveryAttribution["campaign"])) return undefined;
  return {
    campaign: query.utm_campaign as DiscoveryAttribution["campaign"],
    medium: "social",
    source: query.utm_source as DiscoveryAttribution["source"],
  };
}

export function discoverySource(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const attribution = (metadata as Record<string, unknown>).attribution;
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return undefined;
  const source = (attribution as Record<string, unknown>).source;
  return DISCOVERY_SOURCES.includes(source as DiscoveryAttribution["source"])
    ? source as DiscoveryAttribution["source"]
    : undefined;
}
