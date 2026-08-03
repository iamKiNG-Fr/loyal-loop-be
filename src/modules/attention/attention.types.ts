export type AttentionPriority = "URGENT" | "IMPORTANT" | "ROUTINE";
export type AttentionKind =
  | "ISSUE"
  | "ORDER"
  | "PAYMENT"
  | "DELIVERY"
  | "FOLLOW_UP"
  | "LOW_STOCK"
  | "INVENTORY"
  | "ACTIVITY";

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  priority: AttentionPriority;
  title: string;
  detail: string;
  to: string;
  createdAt: Date;
  dueAt?: Date;
  streakEligible: boolean;
  seen: boolean;
  snoozedUntil?: Date;
};
