import { useLocalSearchParams } from 'expo-router';
import { Button, Text } from 'react-native';

import { MAX_ENROLMENT_PHOTOS, useEnrolment } from '@/features/catalogue/useEnrolment';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function EnrolScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const enrolment = useEnrolment(productId);
  return (
    <Screen title="Enrol product">
      <Text>Product: {productId}</Text>
      <Text>
        Photos: {enrolment.photoUris.length} / {MAX_ENROLMENT_PHOTOS}
      </Text>
      <Notice
        tone="info"
        title="Not implemented yet"
        body="Capturing 1–3 photos and storing their embeddings is a TODO(feature)."
      />
      <Button title="Capture photo" onPress={() => void enrolment.capturePhoto().catch(() => undefined)} />
    </Screen>
  );
}
