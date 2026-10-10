import { Button, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProducts } from '@/features/catalogue/useProducts';
import { CheckoutCamera } from '@/features/checkout/CheckoutCamera';
import { useCameraGate } from '@/features/checkout/useCameraGate';
import { useCheckout } from '@/features/checkout/useCheckout';
import { useModelStatus } from '@/features/checkout/useModelStatus';
import { useBackupStatus } from '@/features/sync/useBackupStatus';
import { Notice } from '@/features/ui/Notice';

export default function SellScreen() {
  const camera = useCameraGate();
  const models = useModelStatus();
  const checkout = useCheckout();
  const { products } = useProducts();
  const backup = useBackupStatus();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.preview}>
        {!camera.hasPermission ? (
          <View style={styles.center}>
            <Text style={styles.light}>Mokhotsi needs the camera to recognise products.</Text>
            {camera.canRequestPermission ? (
              <Button title="Allow camera" onPress={() => void camera.requestPermission()} />
            ) : (
              <Text style={styles.light}>
                Camera access was denied. Enable it in Android Settings → Apps → Mokhotsi.
              </Text>
            )}
          </View>
        ) : camera.device ? (
          <CheckoutCamera device={camera.device} />
        ) : (
          <View style={styles.center}>
            <Text style={styles.light}>No back camera found.</Text>
          </View>
        )}
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {models.state !== 'ready' ? (
          <Notice
            tone="warn"
            title={
              models.state === 'missing' && models.detectorAvailable
                ? 'Product matching unavailable (detection only)'
                : 'Recognition unavailable'
            }
            body={models.message}
          />
        ) : null}

        <Text style={styles.heading}>Tap a product to add it</Text>
        <View style={styles.chips}>
          {products.map((p) => (
            <Pressable
              key={p.id}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              onPress={() => checkout.addProduct(p.product, 'manual', null)}
              accessibilityRole="button"
              accessibilityLabel={`Add ${p.name}`}
            >
              <Text style={styles.chipText}>
                {p.name} · {p.priceLabel}
              </Text>
            </Pressable>
          ))}
          {products.length === 0 ? (
            <Text style={styles.muted}>Add products in the Catalogue tab.</Text>
          ) : null}
        </View>

        {checkout.lines.map((line) => (
          <View key={line.product.id} style={styles.line}>
            <Text style={styles.lineText}>
              {line.qty} × {line.product.name}
            </Text>
            <Button title="Remove" onPress={() => checkout.removeLine(line.product.id)} />
          </View>
        ))}
        <Text style={styles.total}>Total {checkout.totalLabel}</Text>
        <Button
          title="Complete sale"
          disabled={checkout.lines.length === 0}
          onPress={() => checkout.completeSale()}
        />
        {checkout.error ? <Notice tone="error" title="Sale not saved" body={checkout.error} /> : null}
        {backup.unsyncedSales > 0 ? (
          <Text style={styles.muted}>
            {backup.unsyncedSales} sale{backup.unsyncedSales === 1 ? '' : 's'} not yet backed up
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  preview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  light: { fontSize: 14, color: '#BBBBBB', textAlign: 'center' },
  panel: { flex: 1, backgroundColor: '#FFFFFF' },
  panelContent: { padding: 16, gap: 10 },
  heading: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 24,
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  pressed: { backgroundColor: '#F2F2F2' },
  chipText: { fontSize: 15, color: '#1A1A1A' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineText: { fontSize: 16, color: '#1A1A1A', flexShrink: 1 },
  total: { fontSize: 20, fontWeight: '700', color: '#1A1A1A' },
  muted: { fontSize: 14, color: '#666666' },
});
