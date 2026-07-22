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

export type ProductDescriptionSuggestion = {
  description: string;
  missingDetails: string[];
  source: "ai" | "fallback";
};

export type ProductFormRecommendationKind =
  | "ADD_MEDIA"
  | "ADD_SUPPORTING_MEDIA"
  | "ADD_NAME"
  | "IMPROVE_DESCRIPTION"
  | "REVIEW_AUDIENCE"
  | "SELECT_CATEGORY"
  | "SET_PRICE"
  | "SET_STOCK"
  | "SET_UP_OPTIONS";

export type ProductFormRecommendation = {
  kind: ProductFormRecommendationKind;
  optionAxes: string[];
  reason: string;
  title: string;
};

export type ProductFormGuidance = {
  recommendations: ProductFormRecommendation[];
  source: "ai" | "fallback";
  summary: string;
};

export type ProductFormGuidanceInput = {
  availableCategories?: string[];
  category?: string;
  contentRating?: "GENERAL" | "SENSITIVE_18";
  currentDescription?: string;
  mediaCount: number;
  name?: string;
  optionCount: number;
  optionNames?: string[];
  placement?: string;
  price?: string;
  stock?: string;
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
  suggestProductDescription(input: {
    name: string;
    category?: string;
    currentDescription?: string;
    attributes?: Record<string, string | number | boolean>;
  }): Promise<ProductDescriptionSuggestion>;
  suggestProductFormGuidance(input: ProductFormGuidanceInput): Promise<ProductFormGuidance>;
}
