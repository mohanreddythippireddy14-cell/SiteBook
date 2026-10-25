import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { COLORS } from '../utils/helpers';

export const FormInput = ({ label, style, ...props }) => (
  <View style={[styles.wrap, style]}>
    {label && <Text style={styles.label}>{label}</Text>}
    <TextInput
      style={styles.input}
      placeholderTextColor={COLORS.gray3}
      {...props}
    />
  </View>
);

const styles = StyleSheet.create({
  wrap:  { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.gray4, marginBottom: 6 },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.gray2,
    paddingHorizontal: 14,
    fontSize: 15,
    color: COLORS.text,
    backgroundColor: COLORS.gray0,
  },
});
