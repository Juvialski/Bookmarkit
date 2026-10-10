import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Action, Brand, palette, serif } from '../components/Editorial';
import { useOfflineCatalog } from '../services/OfflineCatalogContext';
export default function OfflineBooks() {
  const state = useOfflineCatalog();
  useEffect(() => { void state.refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const catalog = state.available || state.installed;
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Brand /><Text style={styles.heading}>Offline Books</Text><Text style={styles.count}>{(state.installed?.works || state.bundled).toLocaleString()} books ready</Text><View style={styles.rule} />
    {catalog && <><Text style={styles.title}>Expanded catalog</Text><Text style={styles.detail}>{catalog.works.toLocaleString()} books · {(catalog.bytes / 1_000_000).toFixed(1)} MB</Text></>}
    {state.progress !== null ? <><Text accessibilityLiveRegion="polite" style={styles.detail}>{Math.round(state.progress * 100)}%</Text><View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(state.progress * 100) }} style={styles.track}><View style={[styles.fill, { width: `${state.progress * 100}%` }]} /></View><Action quiet title="Cancel" onPress={state.cancel} /></> : <>
      {state.available && state.available.sha256 !== state.installed?.sha256 && <Action title={state.installed ? 'Update' : 'Download'} onPress={() => void state.download()} />}
      <Action quiet title="Check for updates" onPress={() => void state.refresh()} />{state.installed && <Action quiet title="Delete expanded catalog" onPress={() => void state.remove()} />}
    </>}
    {!!state.error && <Text accessibilityRole="alert" style={styles.detail}>{state.error}</Text>}<Action quiet title="Back to scanner" onPress={() => router.back()} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: palette.paper }, content: { padding: 24, gap: 16 }, heading: { fontFamily: serif, fontSize: 36, color: palette.ink, marginTop: 28 }, count: { fontSize: 20, color: palette.forest }, title: { fontFamily: serif, fontSize: 26, color: palette.ink }, detail: { fontSize: 16, lineHeight: 24, color: palette.muted }, rule: { height: 1, backgroundColor: palette.sage, marginVertical: 16 }, track: { height: 4, backgroundColor: palette.sage }, fill: { height: 4, backgroundColor: palette.forest } });
