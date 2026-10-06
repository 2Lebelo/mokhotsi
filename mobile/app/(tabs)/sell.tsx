import { Button, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CheckoutCamera } from '@/features/checkout/CheckoutCamera';
import { useCameraGate } from '@/features/checkout/useCameraGate';
import { useCheckout } from '@/features/checkout/useCheckout';
import { useModelStatus } from '@/features/checkout/useModelStatus';
import { Notice } from '@/features/ui/Notice';

export default function SellScreen() {
  const camera = useCameraGate();
  const models = useModelStatus();
  const checkout = useCheckout();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.preview}>
        {!camera.hasPermission ? (
          <View style={styles.center}>
            <Text style={styles.text}>Mokhotsi needs the camera to recognise products.</Text>
            {camera.canRequestPermission ? (
              <Button title="Allow camera" onPress={() => void camera.requestPermission()} />
            ) : (
              <Text style={styles.text}>
                Camera access was denied. Enable it in Android Settings → Apps → Mokhotsi.
              </Text>
            )}
          </View>
        ) : camera.device ? (
          <CheckoutCamera device={camera.device} />
        ) : (
          <View style={styles.center}>
            <Text style={styles.text}>No back camera found.</Text>
          </View>
        )}
      </View>
      <View style={styles.panel}>
        {models.state !== 'ready' ? (
          <Notice tone="warn" title="Recognition unavailable" body={models.message} />
        ) : null}
        <Text style={styles.total}>Total {checkout.totalLabel}</Text>
        <Text style={styles.text}>{checkout.lines.length} items · checkout is a TODO(feature) stub</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  preview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  panel: { backgroundColor: '#FFFFFF', padding: 16, gap: 8 },
  total: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  text: { fontSize: 14, color: '#888888', textAlign: 'center' },
});
