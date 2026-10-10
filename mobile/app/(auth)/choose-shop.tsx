import { ActivityIndicator, Button, Pressable, StyleSheet, Text } from 'react-native';

import { useChooseShop } from '@/features/auth/useAuth';
import { Notice } from '@/features/ui/Notice';
import { Screen } from '@/features/ui/Screen';

export default function ChooseShopScreen() {
  const { shops, error, pending, choose, reload, signOut } = useChooseShop();

  return (
    <Screen title="Choose a shop">
      {shops === null && !error ? <ActivityIndicator /> : null}
      {error ? <Notice tone="error" title="Cannot continue" body={error} /> : null}
      {shops?.map((shop) => (
        <Pressable
          key={shop.id}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          disabled={pending}
          onPress={() => void choose(shop)}
          accessibilityRole="button"
          accessibilityLabel={`Use ${shop.name}`}
        >
          <Text style={styles.name}>{shop.name}</Text>
          <Text style={styles.role}>{shop.my_role === 'keeper' ? 'Owner' : 'Shop-sitter'}</Text>
        </Pressable>
      ))}
      {error || shops?.length === 0 ? <Button title="Try again" onPress={() => void reload()} /> : null}
      <Button title="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderColor: '#DDDDDD', borderRadius: 8, padding: 16, minHeight: 56, gap: 2 },
  pressed: { backgroundColor: '#F2F2F2' },
  name: { fontSize: 17, fontWeight: '600', color: '#1A1A1A' },
  role: { fontSize: 13, color: '#666666' },
});
