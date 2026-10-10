import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { BackHandler, Button, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRecognition } from '../services/RecognitionContext';
export default function Candidates() {
  const { candidates, choose, reset } = useRecognition();
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { reset(); return true; }); return () => sub.remove(); }, [reset]);
  if (!candidates.length) return <Redirect href="/" />;
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.heading}>Which book?</Text>
    {candidates.slice(0, 4).map((book, index) => <Pressable accessibilityRole="button" accessibilityLabel={`${book.title}, ${book.authors.join(', ')}`} key={`${book.workId || book.isbn}-${index}`} onPress={() => choose(book)} style={styles.row}>
      {book.coverUrl ? <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="contain" /> : <View style={styles.cover} />}
      <View style={styles.text}><Text style={styles.title}>{book.title}</Text><Text>{book.authors.join(', ') || 'Author unavailable'}</Text></View>
    </Pressable>)}
    <Button title="Correct search" onPress={reset} />
    <Button title="Scan Another" onPress={reset} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#f7f5ee' }, content: { padding: 24, gap: 16 }, heading: { fontSize: 28, fontWeight: '700' }, row: { backgroundColor: '#fff', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 12 }, cover: { width: 60, height: 90, backgroundColor: '#e1e7df' }, text: { flex: 1, gap: 8 }, title: { fontSize: 18, fontWeight: '600' } });
