import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
export const palette = { paper: '#F7F4ED', forest: '#1B3C34', ink: '#17251F', sage: '#A8B9A7', copper: '#BF8A55', muted: '#526457' };
export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });
export function Action({ title, onPress, disabled, quiet = false }: { title: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, quiet && styles.quiet, { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 }]}><Text style={[styles.actionText, quiet && styles.quietText]}>{title}</Text></Pressable>;
}
export function Brand() { return <View style={styles.brandRow}><Text style={styles.mark}>▥</Text><Text style={styles.brand}>Bookmarkit</Text></View>; }
const styles = StyleSheet.create({ action: { minHeight: 52, paddingHorizontal: 22, paddingVertical: 14, backgroundColor: palette.forest, alignItems: 'center', justifyContent: 'center', borderRadius: 3 }, actionText: { color: palette.paper, fontSize: 16, fontWeight: '600' }, quiet: { backgroundColor: 'transparent' }, quietText: { color: palette.forest }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 }, mark: { color: palette.copper, fontSize: 24 }, brand: { color: palette.forest, fontFamily: serif, fontSize: 24 } });
