import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import type {
  CustomerEvidenceItem,
  CustomerInsight,
  DiscoveryFilter,
  DiscoveryQueryPlan,
  IntelligenceProvider,
  ProductDescriptionSuggestion,
  ProductFormGuidance,
  ProductFormGuidanceInput,
  ProductFormRecommendation,
  ProductFormRecommendationKind,
} from "./intelligence.types";
import { PrismaService } from "../prisma/prisma.service";

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["expandedTerms", "filters"],
  properties: {
    expandedTerms: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    filters: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "value"],
        properties: {
          key: {
            type: "string",
            enum: [
              "category",
              "color",
              "size",
              "minPrice",
              "maxPrice",
              "inStock",
            ],
          },
          label: { type: "string" },
          value: { type: ["string", "number", "boolean"] },
        },
      },
    },
  },
};

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "headline",
    "overview",
    "recommendedAction",
    "actionReason",
    "evidenceIds",
  ],
  properties: {
    headline: { type: "string", maxLength: 120 },
    overview: { type: "string", maxLength: 700 },
    recommendedAction: { type: "string", maxLength: 220 },
    actionReason: { type: "string", maxLength: 320 },
    evidenceIds: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
  },
};

const PRODUCT_DESCRIPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "missingDetails"],
  properties: {
    description: { type: "string", maxLength: 700 },
    missingDetails: { type: "array", maxItems: 6, items: { type: "string" } },
  },
};

const PRODUCT_FORM_GUIDANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "recommendations"],
  properties: {
    summary: { type: "string", maxLength: 180 },
    recommendations: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "reason", "optionAxes"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "ADD_MEDIA",
              "ADD_SUPPORTING_MEDIA",
              "ADD_NAME",
              "IMPROVE_DESCRIPTION",
              "REVIEW_AUDIENCE",
              "SELECT_CATEGORY",
              "SET_PRICE",
              "SET_STOCK",
              "SET_UP_OPTIONS",
            ],
          },
          title: { type: "string", maxLength: 100 },
          reason: { type: "string", maxLength: 220 },
          optionAxes: {
            type: "array",
            maxItems: 3,
            items: { type: "string", maxLength: 40 },
          },
        },
      },
    },
  },
};

@Injectable()
export class IntelligenceService implements IntelligenceProvider {
  readonly model: string | null;
  private readonly client: GoogleGenAI | null;
  private readonly customerTimeoutMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const enabled = this.config.get<string>("GEMINI_ENABLED", "false") === "true";
    const apiKey = this.config.get<string>("GEMINI_API_KEY")?.trim();
    this.model = enabled && apiKey
      ? this.config.get<string>("GEMINI_MODEL", "gemini-3.5-flash")
      : null;
    this.client = this.model && apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.timeoutMs = positiveNumber(
      this.config.get<string>("GEMINI_TIMEOUT_MS"),
      5_000,
    );
    this.customerTimeoutMs = positiveNumber(
      this.config.get<string>("GEMINI_CUSTOMER_TIMEOUT_MS"),
      12_000,
    );
  }

  async parseDiscoveryQuery(query: string): Promise<DiscoveryQueryPlan> {
    const startedAt = Date.now();
    const originalQuery = query.trim().slice(0, 120);
    const fallback = fallbackQueryPlan(originalQuery);
    if (!this.client || !this.model || !originalQuery) {
      void this.telemetry("GEMINI_QUERY_FALLBACK", Date.now() - startedAt, { reason: originalQuery ? "disabled" : "empty" });
      return fallback;
    }

    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [
            "Turn this shopping request into expanded search terms and only explicit filters. " +
              "Do not invent a size, color, price, stock state, or category. " +
              `Request: ${JSON.stringify(originalQuery)}`,
          ],
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: QUERY_SCHEMA,
            temperature: 0,
          },
        }),
        this.timeoutMs,
      );
      const parsed = parseJson(response.text);
      const validated = validateQueryPlan(originalQuery, parsed);
      void this.telemetry(validated ? "GEMINI_QUERY_SUCCESS" : "GEMINI_QUERY_INVALID", Date.now() - startedAt, usageMetadata(response));
      return validated ?? fallback;
    } catch {
      void this.telemetry("GEMINI_QUERY_FAILURE", Date.now() - startedAt);
      return fallback;
    }
  }

  async summarizeCustomer(input: {
    businessCategory?: string | null;
    businessName: string;
    customerLabels?: string[];
    customerName: string;
    evidence: CustomerEvidenceItem[];
  }): Promise<CustomerInsight> {
    const startedAt = Date.now();
    const evidence = input.evidence.slice(0, 80);
    const fallback = fallbackCustomerSummary(input.customerName, evidence);
    if (!this.client || !this.model || evidence.length === 0) {
      void this.telemetry("GEMINI_CUSTOMER_FALLBACK", Date.now() - startedAt, { reason: evidence.length ? "disabled" : "no-evidence" });
      return fallback;
    }

    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [
            "Create a concise customer brief for the owner of the named business. " +
              "Describe only this customer's relationship with this specific business. " +
              "Use concrete purchase, payment, delivery, issue, feedback, and team-note details when available. " +
              "Deprioritize repeated operational noise such as multiple receipt-open events. " +
              "Give one practical next action the business can take now and explain why it follows from the evidence. " +
              "Every factual claim and recommendation must be supported by the supplied evidence, and evidenceIds must list only IDs supplied below. " +
              "Do not infer demographics, personality, private attributes, intent, contact details, or facts that are not explicit.\n" +
              JSON.stringify({
                businessCategory: input.businessCategory?.slice(0, 100) ?? null,
                businessName: input.businessName.slice(0, 120),
                customerLabels: (input.customerLabels ?? []).slice(0, 12),
                customerName: input.customerName.slice(0, 100),
                evidence,
              }),
          ],
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: SUMMARY_SCHEMA,
            temperature: 0,
          },
        }),
        this.customerTimeoutMs,
      );
      const parsed = parseJson(response.text);
      const validated = validateCustomerSummary(parsed, evidence);
      void this.telemetry(validated ? "GEMINI_CUSTOMER_SUCCESS" : "GEMINI_CUSTOMER_INVALID", Date.now() - startedAt, usageMetadata(response));
      return validated ? { ...validated, source: "ai" } : fallback;
    } catch {
      void this.telemetry("GEMINI_CUSTOMER_FAILURE", Date.now() - startedAt);
      return fallback;
    }
  }

  async suggestProductDescription(input: {
    name: string;
    category?: string;
    currentDescription?: string;
    attributes?: Record<string, string | number | boolean>;
  }): Promise<ProductDescriptionSuggestion> {
    const fallback = fallbackProductDescription(input);
    if (!this.client || !this.model) return fallback;
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [
            "Improve this product description for a social shop. Use only facts supplied by the merchant. " +
              "Do not invent materials, measurements, benefits, certifications, stock, delivery, or guarantees. " +
              "Write clear natural prose, then list factual details the merchant should still add.\n" +
              JSON.stringify({
                name: input.name.slice(0, 160),
                category: input.category?.slice(0, 100) ?? null,
                currentDescription: input.currentDescription?.slice(0, 1000) ?? null,
                attributes: input.attributes ?? {},
              }),
          ],
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: PRODUCT_DESCRIPTION_SCHEMA,
            temperature: 0.2,
          },
        }),
        this.timeoutMs,
      );
      const parsed = parseJson(response.text);
      const validated = validateProductDescription(parsed);
      void this.telemetry(validated ? "GEMINI_PRODUCT_DESCRIPTION_SUCCESS" : "GEMINI_PRODUCT_DESCRIPTION_INVALID", Date.now() - startedAt, usageMetadata(response));
      return validated ? { ...validated, source: "ai" } : fallback;
    } catch {
      void this.telemetry("GEMINI_PRODUCT_DESCRIPTION_FAILURE", Date.now() - startedAt);
      return fallback;
    }
  }

  async suggestProductFormGuidance(input: ProductFormGuidanceInput): Promise<ProductFormGuidance> {
    const fallback = fallbackProductFormGuidance(input);
    if (!this.client || !this.model) return fallback;
    const startedAt = Date.now();
    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [
            "Help a merchant finish the Add Product form using only the supplied draft. " +
              "The form supports product name, ordered image/video media, price, inventory, one business category, shop placement, description, audience visibility, and product options. " +
              "Each product option supports a customer-facing option name plus optional size, colour, SKU, stock, and price override. " +
              "Recommend SET_UP_OPTIONS only when customers are genuinely likely to choose between versions. For that recommendation, optionAxes may name generic choice types such as Size, Colour, Flavour, Pack, Capacity, or Model, but must not invent actual values. " +
              "Never invent a category outside availableCategories, price, stock, SKU, ingredients, allergens, measurements, certifications, benefits, guarantees, or regulated claims. " +
              "Do not claim that a listing is safe, approved, or available. Return at most five concise, actionable recommendations and use an empty recommendations array when the form is already complete. " +
              "Interface version: catalog-add-product-v2.\n" +
              JSON.stringify(sanitizedProductFormInput(input)),
          ],
          config: {
            responseMimeType: "application/json",
            responseJsonSchema: PRODUCT_FORM_GUIDANCE_SCHEMA,
            temperature: 0,
          },
        }),
        this.timeoutMs,
      );
      const parsed = parseJson(response.text);
      const validated = validateProductFormGuidance(parsed, input);
      void this.telemetry(validated ? "GEMINI_PRODUCT_FORM_SUCCESS" : "GEMINI_PRODUCT_FORM_INVALID", Date.now() - startedAt, usageMetadata(response));
      return validated ? { ...validated, source: "ai" } : fallback;
    } catch {
      void this.telemetry("GEMINI_PRODUCT_FORM_FAILURE", Date.now() - startedAt);
      return fallback;
    }
  }

  private telemetry(type: string, latencyMs: number, metadata?: Record<string, string | number>) {
    return this.prisma.discoveryTelemetry.create({
      data: { type, value: latencyMs, metadata: { latencyMs, model: this.model ?? "deterministic", ...metadata } },
    }).catch(() => null);
  }
}

function usageMetadata(response: unknown) {
  const usage = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
  return {
    promptTokens: usage?.promptTokenCount ?? 0,
    responseTokens: usage?.candidatesTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
  };
}

function fallbackQueryPlan(query: string): DiscoveryQueryPlan {
  const filters: DiscoveryFilter[] = [];
  const price = query.match(/(?:under|below|less than)\s*(?:₦|ngn|n)?\s*([\d,]+)/i);
  if (price) {
    const value = Number(price[1].replace(/,/g, ""));
    if (Number.isFinite(value)) {
      filters.push({ key: "maxPrice", label: `Under ₦${value.toLocaleString()}`, value });
    }
  }
  if (/\bin stock\b|\bavailable\b/i.test(query)) {
    filters.push({ key: "inStock", label: "In stock", value: true });
  }
  return {
    expandedTerms: query ? [query] : [],
    filters,
    mode: "fallback",
    originalQuery: query,
  };
}

function fallbackCustomerSummary(
  customerName: string,
  evidence: CustomerEvidenceItem[],
): CustomerInsight {
  if (!evidence.length) {
    return {
      actionReason: "A useful brief needs at least one purchase, note, delivery, issue, feedback item, or recorded interaction.",
      evidenceIds: [],
      headline: "A new relationship, still taking shape",
      overview: `There is not enough recorded activity to describe ${customerName}'s relationship with this business yet.`,
      recommendedAction: `Add the first useful note about ${customerName} after your next interaction.`,
      source: "fallback",
    };
  }

  const useful = distinctEvidence(evidence);
  const latest = useful.slice(0, 5);
  const issue = useful.find((item) => item.kind === "issue" && /\bopen\b|reported|issue/i.test(item.title));
  const payment = useful.find((item) => /part[ -]?paid|unpaid|payment pending|pending payment/i.test(item.title));
  const delivery = useful.find((item) => item.kind === "delivery" && /pending|preparing|in transit|ready for pickup/i.test(item.title));
  const note = useful.find((item) => item.kind === "note");
  const saleCount = evidence.filter((item) => item.kind === "sale").length;
  const lead = latest[0];

  const recommendation = issue
    ? {
        action: `Contact ${customerName} with a clear update on the open issue.`,
        reason: issue.title,
      }
    : payment
      ? {
          action: `Confirm the outstanding payment status with ${customerName}.`,
          reason: payment.title,
        }
      : delivery
        ? {
            action: `Check that ${customerName}'s delivery is progressing as expected.`,
            reason: delivery.title,
          }
        : note
          ? {
              action: `Use the latest team note to make the next conversation with ${customerName} more personal.`,
              reason: note.title,
            }
          : {
              action: `Send ${customerName} a short, relevant follow-up based on the latest recorded interaction.`,
              reason: lead.title,
            };

  return {
    actionReason: recommendation.reason,
    evidenceIds: latest.map((item) => item.id),
    headline: issue
      ? "An open issue needs attention"
      : saleCount > 1
        ? "A repeat relationship worth nurturing"
        : "A relationship with a clear next step",
    overview: `${lead.title}. ${saleCount ? `${saleCount} recorded ${saleCount === 1 ? "purchase forms" : "purchases form"} part of this business relationship.` : `${evidence.length} recorded relationship ${evidence.length === 1 ? "event is" : "events are"} available as context.`}`,
    recommendedAction: recommendation.action,
    source: "fallback",
  };
}

function fallbackProductDescription(input: {
  name: string;
  category?: string;
  currentDescription?: string;
  attributes?: Record<string, string | number | boolean>;
}): ProductDescriptionSuggestion {
  const facts = Object.entries(input.attributes ?? {})
    .filter(([, value]) => String(value).trim())
    .slice(0, 8)
    .map(([key, value]) => `${key.replace(/[_-]+/g, " ")}: ${value}`);
  const current = input.currentDescription?.trim();
  const opening = current || `${input.name.trim()}${input.category ? ` is listed in ${input.category.trim()}` : ""}.`;
  return {
    description: [opening, facts.length ? `Details: ${facts.join(", ")}.` : ""].filter(Boolean).join(" ").slice(0, 700),
    missingDetails: facts.length
      ? ["Add measurements or fit where relevant", "Explain what is included"]
      : ["Add material or key features", "Add size or measurements", "Explain what is included"],
    source: "fallback",
  };
}

function fallbackProductFormGuidance(input: ProductFormGuidanceInput): ProductFormGuidance {
  const recommendations: ProductFormRecommendation[] = [];
  const name = input.name?.trim() ?? "";
  const description = input.currentDescription?.trim() ?? "";
  const category = input.category?.trim() ?? "";

  if (!name) recommendations.push({ kind: "ADD_NAME", optionAxes: [], title: "Name the product", reason: "A clear product name helps customers understand what they are opening." });
  if (input.mediaCount === 0) recommendations.push({ kind: "ADD_MEDIA", optionAxes: [], title: "Add a clear cover", reason: "Products need clear primary media before they can be considered for discovery." });
  else if (input.mediaCount === 1) recommendations.push({ kind: "ADD_SUPPORTING_MEDIA", optionAxes: [], title: "Add another useful view", reason: "A second angle, label, detail, or scale view can answer a customer question." });
  if (!category) recommendations.push({ kind: "SELECT_CATEGORY", optionAxes: [], title: "Choose a category", reason: "The category controls relevant listing guidance and helps customers browse." });
  if (!(Number(input.price) > 0)) recommendations.push({ kind: "SET_PRICE", optionAxes: [], title: "Add the selling price", reason: "Customers need the current price before deciding whether to request the product." });
  if (input.stock === undefined || input.stock === "") recommendations.push({ kind: "SET_STOCK", optionAxes: [], title: "Clarify availability", reason: "Add current stock so the listing does not imply availability you have not recorded." });
  if (description.length < 80 && name) recommendations.push({ kind: "IMPROVE_DESCRIPTION", optionAxes: [], title: "Strengthen the description", reason: "Add only the features, contents, measurements, or care details you can confirm." });

  if (input.optionCount === 0) {
    const axes = suggestedOptionAxes(`${name} ${category} ${description}`);
    if (axes.length) recommendations.push({
      kind: "SET_UP_OPTIONS",
      optionAxes: axes,
      title: `Consider ${axes.join(" and ")} options`,
      reason: `Use options only if customers choose between different ${axes.map(axis => axis.toLowerCase()).join(" or ")} versions of this product.`,
    });
  }

  const limited = recommendations.slice(0, 5);
  return {
    recommendations: limited,
    source: "fallback",
    summary: limited.length
      ? `${limited.length} practical ${limited.length === 1 ? "step can" : "steps can"} make this listing clearer.`
      : "This draft covers the essential Add Product fields.",
  };
}

function sanitizedProductFormInput(input: ProductFormGuidanceInput) {
  return {
    availableCategories: (input.availableCategories ?? []).map(item => item.trim().slice(0, 100)).filter(Boolean).slice(0, 40),
    category: input.category?.trim().slice(0, 100) || null,
    contentRating: input.contentRating ?? "GENERAL",
    currentDescription: input.currentDescription?.trim().slice(0, 1000) || null,
    mediaCount: Math.max(0, Math.min(8, input.mediaCount)),
    name: input.name?.trim().slice(0, 160) || null,
    optionCount: Math.max(0, Math.min(20, input.optionCount)),
    optionNames: (input.optionNames ?? []).map(item => item.trim().slice(0, 120)).filter(Boolean).slice(0, 20),
    placement: input.placement?.trim().slice(0, 80) || null,
    priceProvided: Number(input.price) > 0,
    stockProvided: input.stock !== undefined && input.stock !== "",
  };
}

function suggestedOptionAxes(value: string) {
  const normalized = value.toLowerCase();
  if (/cake|pastr|cookie|food|drink|juice|yogh?urt/.test(normalized)) return ["Size", "Flavour"];
  if (/shirt|dress|trouser|cloth|shoe|sneaker|fashion/.test(normalized)) return ["Size", "Colour"];
  if (/makeup|foundation|lipstick|beauty/.test(normalized)) return ["Shade", "Size"];
  if (/phone|laptop|tablet|electronic/.test(normalized)) return ["Model", "Capacity"];
  if (/perfume|fragrance/.test(normalized)) return ["Size"];
  return [];
}

function validateProductFormGuidance(
  value: unknown,
  input: ProductFormGuidanceInput,
): Omit<ProductFormGuidance, "source"> | null {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.recommendations)) return null;
  const allowedKinds = new Set<ProductFormRecommendationKind>([
    "ADD_MEDIA",
    "ADD_SUPPORTING_MEDIA",
    "ADD_NAME",
    "IMPROVE_DESCRIPTION",
    "REVIEW_AUDIENCE",
    "SELECT_CATEGORY",
    "SET_PRICE",
    "SET_STOCK",
    "SET_UP_OPTIONS",
  ]);
  const recommendations = value.recommendations.flatMap((entry): ProductFormRecommendation[] => {
    if (!isRecord(entry) || typeof entry.kind !== "string" || !allowedKinds.has(entry.kind as ProductFormRecommendationKind)) return [];
    if (typeof entry.title !== "string" || typeof entry.reason !== "string" || !Array.isArray(entry.optionAxes)) return [];
    const optionAxes = entry.kind === "SET_UP_OPTIONS"
      ? entry.optionAxes.filter((item): item is string => typeof item === "string").map(item => item.trim().slice(0, 40)).filter(Boolean).slice(0, 3)
      : [];
    if (entry.kind === "SET_UP_OPTIONS" && (input.optionCount > 0 || optionAxes.length === 0)) return [];
    const title = entry.title.trim().slice(0, 100);
    const reason = entry.reason.trim().slice(0, 220);
    return title && reason ? [{ kind: entry.kind as ProductFormRecommendationKind, optionAxes, reason, title }] : [];
  }).slice(0, 5);
  const summary = value.summary.trim().slice(0, 180);
  return summary ? { recommendations, summary } : null;
}

function validateProductDescription(value: unknown): Omit<ProductDescriptionSuggestion, "source"> | null {
  if (!isRecord(value) || typeof value.description !== "string" || !Array.isArray(value.missingDetails)) return null;
  const description = value.description.trim().slice(0, 700);
  const missingDetails = value.missingDetails
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 6);
  return description ? { description, missingDetails } : null;
}

function validateQueryPlan(
  originalQuery: string,
  value: unknown,
): DiscoveryQueryPlan | null {
  if (!isRecord(value) || !Array.isArray(value.expandedTerms) || !Array.isArray(value.filters)) return null;
  const allowed = new Set(["category", "color", "size", "minPrice", "maxPrice", "inStock"]);
  const expandedTerms = value.expandedTerms
    .filter((term): term is string => typeof term === "string")
    .map((term) => term.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8);
  const filters = value.filters.flatMap((entry): DiscoveryFilter[] => {
    if (!isRecord(entry) || typeof entry.key !== "string" || !allowed.has(entry.key)) return [];
    if (typeof entry.label !== "string") return [];
    if (!["string", "number", "boolean"].includes(typeof entry.value)) return [];
    return [{
      key: entry.key as DiscoveryFilter["key"],
      label: entry.label.trim().slice(0, 80),
      value: entry.value as string | number | boolean,
    }];
  });
  return {
    expandedTerms: expandedTerms.length ? expandedTerms : [originalQuery],
    filters,
    mode: "ai",
    originalQuery,
  };
}

function validateCustomerSummary(
  value: unknown,
  evidence: CustomerEvidenceItem[],
): Omit<CustomerInsight, "source"> | null {
  if (
    !isRecord(value)
    || typeof value.headline !== "string"
    || typeof value.overview !== "string"
    || typeof value.recommendedAction !== "string"
    || typeof value.actionReason !== "string"
    || !Array.isArray(value.evidenceIds)
  ) return null;
  const allowedIds = new Set(evidence.map((item) => item.id));
  const evidenceIds = [...new Set(
    value.evidenceIds.filter((id): id is string => typeof id === "string" && allowedIds.has(id)),
  )].slice(0, 12);
  const headline = value.headline.trim().slice(0, 120);
  const overview = value.overview.trim().slice(0, 700);
  const recommendedAction = value.recommendedAction.trim().slice(0, 220);
  const actionReason = value.actionReason.trim().slice(0, 320);
  if (!headline || !overview || !recommendedAction || !actionReason || evidenceIds.length === 0) return null;
  return {
    actionReason,
    evidenceIds,
    headline,
    overview,
    recommendedAction,
  };
}

function distinctEvidence(evidence: CustomerEvidenceItem[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const normalized = item.title.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Gemini request timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
