import { useEffect } from 'react';
import { Redirect } from 'expo-router';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action as Button, Brand, palette, serif } from '../components/Editorial';
import { useRecognition } from '../services/RecognitionContext';
export default function Candidates() {
  const { candidates, choose, reset } = useRecognition();
  useEffect(() => { const sub = BackHandler.addEventListener('hardwareBackPress', () => { reset(); return true; }); return () => sub.remove(); }, [reset]);
  if (!candidates.length) return <Redirect href="/" />;
  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <Brand /><Text style={styles.heading}>Which book?</Text>
    {candidates.slice(0, 4).map((book, index) => <Pressable accessibilityRole="button" accessibilityLabel={`${book.title}, ${book.authors.join(', ')}`} key={`${book.workId || book.isbn}-${index}`} onPress={() => choose(book)} style={styles.row}>
      {book.coverUrl ? <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="contain" /> : <View style={styles.cover} />}
      <View style={styles.text}><Text style={styles.title}>{book.title}</Text><Text>{book.authors.join(', ') || 'Author unavailable'}</Text></View>
    </Pressable>)}
    <Button title="Correct search" onPress={reset} />
    <Button quiet title="Scan another" onPress={reset} />
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: palette.paper }, content: { padding: 24, gap: 16 }, heading: { fontSize: 32, fontFamily: serif, color: palette.ink }, row: { borderBottomWidth: 1, borderBottomColor: palette.sage, paddingVertical: 16, flexDirection: 'row', gap: 12 }, cover: { width: 60, height: 90, backgroundColor: '#e1e7df' }, text: { flex: 1, gap: 8 }, title: { fontSize: 20, fontFamily: serif, color: palette.ink } });
