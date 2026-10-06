import { useCallback, useState } from 'react';

import { notImplemented } from '@/lib/errors';

export const MAX_ENROLMENT_PHOTOS = 3;

export interface Enrolment {
  productId: string;
  photoUris: string[];
  /** Capture one photo (1–3 per product). */
  capturePhoto(): Promise<void>;
  /** Detect → crop → embed each photo, then store vectors + outbox ops in one transaction. */
  save(): Promise<void>;
}

export function useEnrolment(productId: string): Enrolment {
  const [photoUris] = useState<string[]>([]);

  const capturePhoto = useCallback(async () => {
    // TODO(feature): take a photo (VisionCamera photo output), keep its local URI, cap at MAX_ENROLMENT_PHOTOS.
    notImplemented(`enrolment.capturePhoto (${productId})`);
  }, [productId]);

  const save = useCallback(async () => {
    // TODO(feature): for each photo: detect → crop → embed; embeddings.addEmbeddings(); products.addProductImage(); index.add().
    notImplemented(`enrolment.save (${productId})`);
  }, [productId]);

  return { productId, photoUris, capturePhoto, save };
}
