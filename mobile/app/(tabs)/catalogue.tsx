import { Link } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { useProducts } from '@/features/catalogue/useProducts';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function CatalogueScreen() {
  const { products, error } = useProducts();
  return (
    <Screen title="Catalogue">
      {error ? <Notice tone="warn" title="Products unavailable" body={error} /> : null}
      {products.map((p) => (
        <Link key={p.id} href={{ pathname: '/enrol/[productId]', params: { productId: p.id } }}>
          <Text style={styles.row}>
            {p.name} · {p.priceLabel}
          </Text>
        </Link>
      ))}
      <Link href={{ pathname: '/enrol/[productId]', params: { productId: 'new' } }} style={styles.link}>
        + Enrol a product
      </Link>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { fontSize: 16, paddingVertical: 8 },
  link: { fontSize: 16, color: '#1F5FD1', paddingVertical: 8 },
});
