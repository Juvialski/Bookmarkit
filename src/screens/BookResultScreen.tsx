import { useState } from 'react';
import { Button, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookResult } from '../models/book';
import { goodreadsSearchUrl } from '../utils/goodreads';
import { visibleRatings } from '../utils/ratings';
export function BookResultScreen({ book, onScanAnother }: { book: BookResult; onScanAnother: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false);
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Bookmarkit</Text>
    {book.coverUrl && !coverFailed ? <Image accessibilityLabel={`Cover of ${book.title}`} source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="contain" onError={() => setCoverFailed(true)} /> : <View style={[styles.cover, styles.placeholder]}><Text>Cover unavailable</Text></View>}
    <Text style={styles.title}>{book.title || 'Title unavailable'}</Text>
    <Text style={styles.author}>{book.authors.length ? book.authors.join(', ') : 'Author unavailable'}</Text>
    {book.source === 'offline-catalog' && <Text style={styles.detail}>Offline catalog · Stored Open Library ratings, not live</Text>}
    <Text style={styles.series}>{book.seriesStatus === 'series' && book.seriesName ? `${book.seriesName}${book.seriesPosition ? ` · Book ${book.seriesPosition}` : ''}` : book.seriesStatus === 'standalone' ? 'Standalone book' : 'Series information unavailable'}</Text>
    {visibleRatings(book.ratings).map(r => <View key={r.provider} style={styles.rating}><Text style={styles.provider}>{r.provider}</Text><Text style={styles.score}>★ {r.average!.toFixed(1)}</Text>{r.count !== undefined && <Text style={styles.detail}>{r.count.toLocaleString()} ratings</Text>}{book.source === 'offline-catalog' && <Text style={styles.detail}>Stored offline</Text>}</View>)}
    {book.warnings.map(warning => <Text key={warning} style={styles.detail}>{warning}</Text>)}
    <Button title="Search on Goodreads" onPress={() => { void Linking.openURL(goodreadsSearchUrl(book.isbn)).catch(() => {}); }} />
    <Text style={styles.detail}>ISBN {book.isbn}</Text><Button title="Scan Another" onPress={onScanAnother} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f7f5ee' }, content: { padding: 24, gap: 16 }, brand: { fontSize: 16, fontWeight: '700', color: '#356455' }, cover: { width: 170, height: 240, alignSelf: 'center' }, placeholder: { backgroundColor: '#e1e7df', justifyContent: 'center', alignItems: 'center', borderRadius: 8 }, title: { fontSize: 28, fontWeight: '700', color: '#182a24' }, author: { fontSize: 19, color: '#536259' }, series: { fontSize: 16, color: '#356455' }, rating: { backgroundColor: '#fff', borderRadius: 12, padding: 18, gap: 7 }, provider: { fontSize: 16, fontWeight: '600' }, score: { fontSize: 23, color: '#182a24' }, detail: { color: '#536259', fontSize: 14, lineHeight: 20 } });
