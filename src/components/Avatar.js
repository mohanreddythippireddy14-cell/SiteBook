import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { initials, COLORS } from '../utils/helpers';

// FIX BUG-19: initials() is now crash-safe, Avatar handles empty name
export const Avatar = ({
  name = '',
  size = 44,
  bg   = COLORS.primaryLight,
  color = COLORS.primary,
}) => (
  <View style={[
    styles.avatar,
    { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
  ]}>
    <Text style={[styles.text, { fontSize: size * 0.36, color }]}>
      {initials(name)}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
  text:   { fontWeight: '800' },
});
