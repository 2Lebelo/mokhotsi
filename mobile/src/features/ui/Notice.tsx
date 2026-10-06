import { StyleSheet, Text, View } from 'react-native';

export interface NoticeProps {
  tone?: 'info' | 'warn' | 'error';
  title: string;
  body?: string;
}

/** Inline banner used to surface stubbed features, missing models and errors without crashing. */
export function Notice({ tone = 'info', title, body }: NoticeProps) {
  return (
    <View style={[styles.box, styles[tone]]}>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 8, padding: 12, gap: 4, borderWidth: 1 },
  info: { backgroundColor: '#EEF4FF', borderColor: '#B9CCF5' },
  warn: { backgroundColor: '#FFF6E5', borderColor: '#F2CF8C' },
  error: { backgroundColor: '#FDECEC', borderColor: '#F0A8A8' },
  title: { fontSize: 15, fontWeight: '600', color: '#1A1A1A' },
  body: { fontSize: 13, color: '#333333' },
});
