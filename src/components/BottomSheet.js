import React from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  ScrollView, StyleSheet, Dimensions,
} from 'react-native';
import { COLORS } from '../utils/helpers';

const { height } = Dimensions.get('window');

export const BottomSheet = ({ visible, onClose, title, children }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose} />
    <View style={styles.sheet}>
      <View style={styles.handle} />
      {title && <Text style={styles.title}>{title}</Text>}
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
    maxHeight: height * 0.92,
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: COLORS.gray2,
    borderRadius: 4,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 19, fontWeight: '800', color: COLORS.text, marginBottom: 20 },
});
