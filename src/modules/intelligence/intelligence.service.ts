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
  required: ["summary", "evidenceIds"],
  properties: {
    summary: { type: "string", maxLength: 600 },
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
      4_000,
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
    customerName: string;
    evidence: CustomerEvidenceItem[];
  }): Promise<CustomerInsight> {
    const startedAt = Date.now();
    const evidence = input.evidence.slice(0, 80);
    const fallback = fallbackCustomerSummary(evidence);
    if (!this.client || !this.model || evidence.length === 0) {
      void this.telemetry("GEMINI_CUSTOMER_FALLBACK", Date.now() - startedAt, { reason: evidence.length ? "disabled" : "no-evidence" });
      return fallback;
    }

    try {
      const response = await withTimeout(
        this.client.models.generateContent({
          model: this.model,
          contents: [
            "Summarize this business relationship in two or three factual sentences. " +
              "Every claim must be supported by the supplied evidence and evidenceIds must list only IDs supplied below. " +
              "Do not infer demographics, intent, personality, contact details, or facts that are not explicit.\n" +
              JSON.stringify({
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
        this.timeoutMs,
      );
      const parsed = parseJson(response.text);
      const validated = validateCustomerSummary(parsed, evidence);
      void this.telemetry(validated ? "GEMINI_CUSTOMER_SUCCESS" : "GEMINI_CUSTOMER_INVALID", Date.now() - startedAt, usageMetadata(response));
      return validated ?? fallback;
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

function fallbackCustomerSummary(evidence: CustomerEvidenceItem[]): CustomerInsight {
  if (!evidence.length) {
    return {
      summary: "No recorded relationship activity is available yet.",
      evidenceIds: [],
    };
  }
  const latest = evidence.slice(0, 3);
  return {
    summary: `Loyal Loop has ${evidence.length} recorded relationship ${evidence.length === 1 ? "event" : "events"}. Recent evidence: ${latest.map((item) => item.title).join("; ")}.`,
    evidenceIds: latest.map((item) => item.id),
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
): CustomerInsight | null {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.evidenceIds)) return null;
  const allowedIds = new Set(evidence.map((item) => item.id));
  const evidenceIds = [...new Set(
    value.evidenceIds.filter((id): id is string => typeof id === "string" && allowedIds.has(id)),
  )].slice(0, 12);
  const summary = value.summary.trim().slice(0, 600);
  if (!summary || evidenceIds.length === 0) return null;
  return { summary, evidenceIds };
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
