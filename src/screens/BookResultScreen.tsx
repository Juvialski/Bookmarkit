import { useEffect, useState } from 'react';
import { Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookResult } from '../models/book';
import { goodreadsSearchUrl } from '../utils/goodreads';
import { primaryRating } from '../utils/ratings';
import { Action, Brand, palette, serif } from '../components/Editorial';
import { groundedSearch, groundingAvailable, SearchEvidence } from '../services/groundedSearch';
import { GroundedEvidence } from '../components/GroundedEvidence';
export function BookResultScreen({ book, onScanAnother }: { book: BookResult; onScanAnother: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false), [linkError, setLinkError] = useState(false);
  const rating = primaryRating(book.ratings);
  const [evidence, setEvidence] = useState<SearchEvidence | null>(null), [searching, setSearching] = useState(false);
  const [groundingEnabled, setGroundingEnabled] = useState(false);
  useEffect(() => { let active = true; void groundingAvailable().then(enabled => { if (active) setGroundingEnabled(enabled); }); return () => { active = false; }; }, []);
  const series = book.seriesStatus === 'series' && book.seriesName ? `${book.seriesName}${book.seriesPosition ? ` · #${book.seriesPosition}` : ''}` : book.seriesStatus === 'standalone' ? 'Standalone' : 'Series unknown';
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Brand />
    <View style={styles.coverStage}>{book.coverUrl && !coverFailed ? <Image accessibilityLabel={`Cover of ${book.title}`} source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="contain" onError={() => setCoverFailed(true)} /> : <View accessibilityLabel="Cover unavailable" style={[styles.cover, styles.placeholder]}><Text accessibilityElementsHidden importantForAccessibility="no" style={styles.coverTitle}>▥</Text></View>}</View>
    <Text style={styles.title}>{book.title || 'Title unavailable'}</Text>
    <Text style={styles.author}>{book.authors.join(', ') || 'Author unavailable'}</Text>
    <View style={styles.rating}><Text style={styles.score}>{rating ? `★ ${rating.average!.toFixed(1)}` : 'Not rated'}</Text>{rating && <Text style={styles.source}>{rating.provider}</Text>}</View>
    <Text style={styles.series}>{series}</Text><View style={styles.rule} />
    <Action title="View on Goodreads" onPress={() => { setLinkError(false); void Linking.openURL(goodreadsSearchUrl(book)).catch(() => setLinkError(true)); }} />
    {linkError && <Text accessibilityRole="alert" style={styles.source}>Could not open link. Try again.</Text>}
    <Action quiet title="Scan another" onPress={onScanAnother} />
    {!rating && groundingEnabled && <Action quiet title={searching ? 'Searching…' : 'Search with Google'} disabled={searching} onPress={() => { setSearching(true); void groundedSearch([book.title, ...book.authors].join(' ')).then(result => { setEvidence(result); if (!result) setLinkError(true); }).finally(() => setSearching(false)); }} />}
    <GroundedEvidence evidence={evidence} close={() => setEvidence(null)} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: palette.paper }, content: { padding: 24, paddingBottom: 32, gap: 12 }, coverStage: { alignItems: 'center', paddingVertical: 20 }, cover: { width: 164, height: 236 }, placeholder: { backgroundColor: palette.forest, padding: 18, justifyContent: 'center' }, coverTitle: { fontSize: 48, textAlign: 'center', color: palette.copper }, title: { fontFamily: serif, fontSize: 32, lineHeight: 38, color: palette.ink }, author: { fontSize: 17, color: palette.muted, lineHeight: 25 }, rating: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'baseline', marginTop: 8 }, score: { fontFamily: serif, fontSize: 38, color: palette.forest }, source: { fontSize: 14, color: palette.muted }, series: { fontSize: 16, lineHeight: 24, color: palette.ink }, rule: { height: 1, backgroundColor: palette.sage, marginVertical: 12 } });
