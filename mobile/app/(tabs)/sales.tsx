import { StyleSheet, Text } from 'react-native';

import { useSales } from '@/features/sales/useSales';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function SalesScreen() {
  const { sales, error } = useSales();
  return (
    <Screen title="Sales">
      {error ? <Notice tone="warn" title="Sales unavailable" body={error} /> : null}
      {sales.map((s) => (
        <Text key={s.id} style={styles.row}>
          {s.createdAtLabel} · {s.totalLabel}
        </Text>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { fontSize: 16, paddingVertical: 8 },
});
