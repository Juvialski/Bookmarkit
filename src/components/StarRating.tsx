import { useId } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';
import { starFills } from '../utils/starRating';

const path = 'M12 2.5 14.94 8.46 21.52 9.42 16.76 14.06 17.88 20.61 12 17.52 6.12 20.61 7.24 14.06 2.48 9.42 9.06 8.46Z';
export function StarRating({ average }: { average: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    {starFills(average).map((fill, i) => <Svg key={i} width={27} height={27} viewBox="0 0 24 24">
      <Defs><ClipPath id={`${id}${i}`}><Rect x="2.48" y="0" width={19.04 * fill} height="24" /></ClipPath></Defs>
      <Path d={path} fill="#E4E1D8" />
      <Path d={path} fill="#E8AD28" clipPath={`url(#${id}${i})`} />
      <Path d={path} fill="none" stroke="#BDAE8B" strokeWidth="0.7" strokeLinejoin="round" />
    </Svg>)}
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 5 } });
