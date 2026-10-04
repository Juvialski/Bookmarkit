import { useState } from 'react';
import { Button, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BookResult } from '../models/book';
import { goodreadsSearchUrl } from '../utils/goodreads';
import { primaryRating } from '../utils/ratings';

function typeText(book: BookResult) {
  if (book.seriesStatus === 'series' && book.seriesName) {
    return `${book.seriesName}${book.seriesPosition ? ` · Book ${book.seriesPosition}` : ''}`;
  }
  if (book.seriesStatus === 'standalone') return 'Standalone';
  return 'Series status unknown';
}

export function BookResultScreen({ book, onScanAnother }: { book: BookResult; onScanAnother: () => void }) {
  const [coverFailed, setCoverFailed] = useState(false);
  const rating = primaryRating(book.ratings);

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.brand}>Bookmarkit</Text>

    {book.coverUrl && !coverFailed
      ? <Image accessibilityLabel={`Cover of ${book.title}`} source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="contain" onError={() => setCoverFailed(true)} />
      : <View style={[styles.cover, styles.placeholder]}><Text style={styles.detail}>Cover unavailable</Text></View>}

    <Text style={styles.title}>{book.title || 'Title unavailable'}</Text>
    <Text style={styles.author}>{book.authors.length ? book.authors.join(', ') : 'Author unavailable'}</Text>

    <View style={styles.infoCard}>
      <Text style={styles.label}>Type</Text>
      <Text style={styles.type}>{typeText(book)}</Text>
    </View>

    <View style={styles.ratingCard}>
      <Text style={styles.label}>Rating</Text>
      <Text style={styles.score}>{rating ? `★ ${rating.average!.toFixed(1)}` : 'Not rated'}</Text>
      {rating && <Text style={styles.detail}>
        {rating.provider}{rating.count !== undefined ? ` · ${rating.count.toLocaleString()} ratings` : ''}
        {book.source === 'offline-catalog' ? ' · stored offline' : ''}
      </Text>}
    </View>

    <View style={styles.goodreads}>
      <Text style={styles.label}>Goodreads</Text>
      <Text style={styles.detail}>Open Goodreads for its current community rating and book page.</Text>
      <Button title="View on Goodreads" onPress={() => { void Linking.openURL(goodreadsSearchUrl(book.isbn)).catch(() => {}); }} />
    </View>

    {book.source === 'offline-catalog' && <Text style={styles.detail}>Offline catalog data</Text>}
    <Text style={styles.isbn}>ISBN {book.isbn}</Text>
    <Button title="Scan Another" onPress={onScanAnother} />
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f7f5ee' },
  content: { padding: 24, gap: 14 },
  brand: { fontSize: 16, fontWeight: '700', color: '#356455' },
  cover: { width: 145, height: 205, alignSelf: 'center' },
  placeholder: { backgroundColor: '#e1e7df', justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#182a24' },
  author: { fontSize: 18, color: '#536259' },
  infoCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 5 },
  ratingCard: { backgroundColor: '#fff', borderRadius: 12, padding: 18, gap: 5 },
  goodreads: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 9 },
  label: { fontSize: 14, fontWeight: '600', color: '#536259' },
  type: { fontSize: 20, fontWeight: '700', color: '#182a24' },
  score: { fontSize: 34, fontWeight: '700', color: '#182a24' },
  detail: { color: '#536259', fontSize: 14, lineHeight: 20 },
  isbn: { color: '#536259', fontSize: 13 }
});
