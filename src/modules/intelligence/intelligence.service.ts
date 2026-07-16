import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI } from "@google/genai";
import type {
  CustomerEvidenceItem,
  CustomerInsight,
  DiscoveryFilter,
  DiscoveryQueryPlan,
  IntelligenceProvider,
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
