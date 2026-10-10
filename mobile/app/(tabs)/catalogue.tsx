import { Link } from 'expo-router';
import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { useProducts } from '@/features/catalogue/useProducts';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function CatalogueScreen() {
  const { products, error, createProduct } = useProducts();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [barcode, setBarcode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const save = () => {
    const problem = createProduct({ name, price, barcode });
    setFormError(problem);
    if (!problem) {
      setName('');
      setPrice('');
      setBarcode('');
    }
  };

  return (
    <Screen title="Catalogue">
      <View style={styles.form}>
        <Text style={styles.heading}>Add a product</Text>
        <TextInput
          style={styles.input}
          placeholder="Name, e.g. Maize meal 2.5kg"
          value={name}
          onChangeText={setName}
          accessibilityLabel="Product name"
        />
        <TextInput
          style={styles.input}
          placeholder="Price, e.g. 45.99"
          keyboardType="decimal-pad"
          value={price}
          onChangeText={setPrice}
          accessibilityLabel="Price in maloti"
        />
        <TextInput
          style={styles.input}
          placeholder="Barcode (optional)"
          keyboardType="number-pad"
          value={barcode}
          onChangeText={setBarcode}
          accessibilityLabel="Barcode"
        />
        <Button title="Save product" onPress={save} />
        {formError ? <Notice tone="error" title="Not saved" body={formError} /> : null}
      </View>

      {error ? <Notice tone="warn" title="Products unavailable" body={error} /> : null}
      {products.length === 0 && !error ? <Text style={styles.empty}>No products yet.</Text> : null}
      {products.map((p) => (
        <Link
          key={p.id}
          href={{ pathname: '/enrol/[productId]', params: { productId: p.id } }}
          style={styles.row}
        >
          {p.name} · {p.priceLabel}
        </Link>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#DDDDDD' },
  heading: { fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#CCCCCC',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 48,
  },
  empty: { fontSize: 15, color: '#666666' },
  row: { fontSize: 16, paddingVertical: 12 },
});
