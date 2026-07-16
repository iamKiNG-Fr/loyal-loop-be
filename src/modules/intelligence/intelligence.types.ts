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
  kind:
    | "activity"
    | "delivery"
    | "feedback"
    | "interest"
    | "issue"
    | "note"
    | "sale";
  occurredAt: string;
  title: string;
};

export type CustomerInsight = {
  actionReason: string;
  evidenceIds: string[];
  headline: string;
  overview: string;
  recommendedAction: string;
  source: "ai" | "fallback";
};

export interface IntelligenceProvider {
  readonly model: string | null;
  parseDiscoveryQuery(query: string): Promise<DiscoveryQueryPlan>;
  summarizeCustomer(input: {
    businessCategory?: string | null;
    businessName: string;
    customerLabels?: string[];
    customerName: string;
    evidence: CustomerEvidenceItem[];
  }): Promise<CustomerInsight>;
}
