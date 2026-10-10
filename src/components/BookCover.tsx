import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { BookResult } from '../models/book';
import { coverCandidates, nextCover } from '../utils/covers';
import { palette } from './Editorial';

// The caller keys this component by book identity. Failures belong to that book,
// while newly arriving URLs remain eligible without resetting a loaded cover.
export function BookCover({ book, compact }: { book: BookResult; compact: boolean }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [loaded, setLoaded] = useState<string>();
  const urls = coverCandidates(book), uri = nextCover(urls, failed, loaded);
  const current = useRef(uri);
  useLayoutEffect(() => { current.current = uri; return () => { current.current = undefined; }; }, [uri]);
  const fail = () => { if (uri && current.current === uri) setFailed(previous => new Set([...previous, uri])); };
  useEffect(() => {
    if (!uri || uri === loaded) return;
    const timer = setTimeout(() => setFailed(previous => new Set([...previous, uri])), 8000);
    return () => clearTimeout(timer);
  }, [uri, loaded]);
  return <View style={[styles.stage, compact && styles.compact]}>
    {loaded !== uri || !uri ? <View accessibilityLabel={uri ? 'Loading book cover' : 'Cover unavailable'} style={[StyleSheet.absoluteFill, styles.placeholder]}>
      {uri ? <ActivityIndicator color={palette.forest} /> : <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.mark}>▥</Text>}
    </View> : null}
    {uri && <Image key={uri} accessibilityLabel={loaded === uri ? `Cover of ${book.title}` : 'Loading book cover'} source={{ uri }} style={[StyleSheet.absoluteFill, { opacity: loaded === uri ? 1 : 0 }]} resizeMode="contain" fadeDuration={180} onError={fail} onLoad={event => {
      if (current.current !== uri) return;
      const { width, height } = event.nativeEvent.source;
      // Open Library's default blank image is 1×1; also reject tiny placeholders.
      if (width < 40 || height < 40) fail(); else setLoaded(uri);
    }} />}
  </View>;
}
const styles = StyleSheet.create({ stage: { width: 184, height: 264, alignSelf: 'center', marginVertical: 8 }, compact: { width: 148, height: 212, marginVertical: 2 }, placeholder: { backgroundColor: '#EDE9DF', justifyContent: 'center', alignItems: 'center' }, mark: { fontSize: 48, color: palette.sage } });
