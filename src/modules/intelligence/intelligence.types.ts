export type DiscoveryFilter = {
  key: "category" | "color" | "size" | "minPrice" | "maxPrice" | "inStock";
  label: string;
  value: string | number | boolean;
};

export type DiscoveryQueryPlan = {
  expandedTerms: string[];
  filters: DiscoveryFilter[];
  mode: "ai" | "fallback";
  originalQuery: string;
};

export type CustomerEvidenceItem = {
  id: string;
  kind: "activity" | "delivery" | "interest" | "note" | "sale";
  occurredAt: string;
  title: string;
};

export type CustomerInsight = {
  evidenceIds: string[];
  summary: string;
};

export interface IntelligenceProvider {
  readonly model: string | null;
  parseDiscoveryQuery(query: string): Promise<DiscoveryQueryPlan>;
  summarizeCustomer(input: {
    customerName: string;
    evidence: CustomerEvidenceItem[];
  }): Promise<CustomerInsight>;
}
