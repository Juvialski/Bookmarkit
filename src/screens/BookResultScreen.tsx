import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookResult } from '../models/book';
import { goodreadsSearchUrl } from '../utils/goodreads';
import { primaryRating } from '../utils/ratings';
import { Action, Brand, palette, serif } from '../components/Editorial';
import { groundedSearch, groundingAvailable, SearchEvidence } from '../services/groundedSearch';
import { GroundedEvidence } from '../components/GroundedEvidence';
import { BookCover } from '../components/BookCover';
import { StarRating } from '../components/StarRating';
import { ratingLabel, ratingSource } from '../utils/starRating';
import { coverIdentity } from '../utils/covers';
export function BookResultScreen({ book, onScanAnother }: { book: BookResult; onScanAnother: () => void }) {
  const [linkError, setLinkError] = useState(false);
  const { height } = useWindowDimensions();
  const rating = primaryRating(book.ratings);
  const [evidence, setEvidence] = useState<SearchEvidence | null>(null), [searching, setSearching] = useState(false);
  const [groundingEnabled, setGroundingEnabled] = useState(false);
  useEffect(() => { let active = true; void groundingAvailable().then(enabled => { if (active) setGroundingEnabled(enabled); }); return () => { active = false; }; }, []);
  const series = book.seriesStatus === 'series' && book.seriesName ? `${book.seriesName}${book.seriesPosition ? ` · #${book.seriesPosition}` : ''}` : book.seriesStatus === 'standalone' ? 'Standalone' : 'Series unknown';
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Brand />
    <BookCover key={coverIdentity(book)} book={book} compact={height <= 700} />
    <Text style={styles.title}>{book.title || 'Title unavailable'}</Text>
    <Text style={styles.author}>{book.authors.join(', ') || 'Author unavailable'}</Text>
    <View style={styles.rating} accessible accessibilityLabel={rating ? ratingLabel(rating) : 'Not rated'}>
      <Text style={styles.score}>{rating ? rating.average!.toFixed(1) : 'Not rated'}{rating && <Text style={styles.scale}> / 5</Text>}</Text>
      {rating && <><StarRating average={rating.average!} /><Text style={styles.source}>{ratingSource(rating)}</Text></>}
    </View>
    <Text style={styles.series}>{series}</Text><View style={styles.rule} />
    <Action title="View on Goodreads" onPress={() => { setLinkError(false); void Linking.openURL(goodreadsSearchUrl(book)).catch(() => setLinkError(true)); }} />
    {linkError && <Text accessibilityRole="alert" style={styles.source}>Could not open link. Try again.</Text>}
    <Action quiet title="Scan another" onPress={onScanAnother} />
    {!rating && groundingEnabled && <Action quiet title={searching ? 'Searching…' : 'Search with Google'} disabled={searching} onPress={() => { setSearching(true); void groundedSearch([book.title, ...book.authors].join(' ')).then(result => { setEvidence(result); if (!result) setLinkError(true); }).finally(() => setSearching(false)); }} />}
    <GroundedEvidence evidence={evidence} close={() => setEvidence(null)} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: palette.paper }, content: { padding: 24, paddingBottom: 32, gap: 10 }, title: { fontFamily: serif, fontSize: 30, lineHeight: 37, color: palette.ink }, author: { fontSize: 17, color: palette.muted, lineHeight: 25 }, rating: { gap: 7, marginTop: 4 }, score: { fontFamily: serif, fontSize: 40, color: palette.forest }, scale: { fontSize: 18, color: palette.muted }, source: { fontSize: 14, lineHeight: 21, color: palette.muted }, series: { fontSize: 16, lineHeight: 24, color: palette.ink }, rule: { height: 1, backgroundColor: palette.sage, marginVertical: 4 } });
