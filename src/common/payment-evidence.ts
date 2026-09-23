import type { MediaPurpose } from '../generated/prisma/client';

export const paymentEvidenceSelect = {
  id: true, deliveryType: true, format: true, publicId: true,
  purpose: true, resourceType: true, secureUrl: true, status: true,
} as const;

export type PaymentEvidenceAsset = {
  id: string; deliveryType: string; format: string; publicId: string;
  purpose: MediaPurpose; resourceType: string; secureUrl: string; status: string;
};
