import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { getDaysInMonth, startOfMonth, getDay, format } from 'date-fns';
import { COLORS } from '../utils/helpers';

export const CalendarPicker = ({ visible, onClose, onSelect, selected }) => {
  const [viewDate, setViewDate] = useState(() => {
    if (selected) {
      const [y, m] = selected.split('-').map(Number);
      return new Date(y, m - 1, 1);
    }
    return new Date();
  });

  useEffect(() => {
    if (!visible || !selected) return;
    const [y, m] = selected.split('-').map(Number);
    if (!y || !m) return;
    // FIX P3L5: Sync the visible month when the selected prop changes before opening.
    setViewDate(new Date(y, m - 1, 1));
  }, [visible, selected]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));
  const prevYear = () => setViewDate(new Date(year - 1, month, 1));
  const nextYear = () => setViewDate(new Date(year + 1, month, 1));

  const daysInMonth = getDaysInMonth(viewDate);
  const firstDay = getDay(startOfMonth(viewDate));
  const blanks = Array.from({ length: firstDay });
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={cal.overlay} activeOpacity={1} onPress={onClose} />
      <View style={cal.container}>
        <View style={cal.yearRow}>
          <TouchableOpacity onPress={prevYear} style={cal.navBtn}>
            <Text style={cal.navArrow}>{'<<'}</Text>
          </TouchableOpacity>
          <Text style={cal.yearLabel}>{year}</Text>
          <TouchableOpacity onPress={nextYear} style={cal.navBtn}>
            <Text style={cal.navArrow}>{'>>'}</Text>
          </TouchableOpacity>
        </View>

        <View style={cal.navRow}>
          <TouchableOpacity onPress={prevMonth} style={cal.navBtn}>
            <Text style={cal.navArrow}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={cal.monthLabel}>{format(viewDate, 'MMMM')}</Text>
          <TouchableOpacity onPress={nextMonth} style={cal.navBtn}>
            <Text style={cal.navArrow}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        <View style={cal.dayHeaders}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <Text key={d} style={cal.dayHeader}>{d}</Text>
          ))}
        </View>

        <View style={cal.grid}>
          {blanks.map((_, i) => <View key={`b${i}`} style={cal.cell} />)}
          {days.map((d) => {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isSel = selected === dateStr;
            const isToday = dateStr === todayStr;
            return (
              <TouchableOpacity
                key={d}
                style={[cal.cell, isSel && cal.cellSel, isToday && !isSel && cal.cellToday]}
                onPress={() => { onSelect(dateStr); onClose(); }}
              >
                <Text style={[cal.cellText, isSel && cal.cellTextSel, isToday && !isSel && cal.cellTextToday]}>
                  {d}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={cal.cancelBtn} onPress={onClose}>
          <Text style={cal.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const cal = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, elevation: 9998 },
  container: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: COLORS.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, zIndex: 9999, elevation: 9999 },
  yearRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  navRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.gray1, alignItems: 'center', justifyContent: 'center' },
  navArrow: { fontSize: 20, color: COLORS.gray5, lineHeight: 26 },
  yearLabel: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: COLORS.gray4 },
  monthLabel: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '800', color: COLORS.text },
  dayHeaders: { flexDirection: 'row', marginBottom: 6 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: COLORS.gray4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 42, alignItems: 'center', justifyContent: 'center' },
  cellSel: { backgroundColor: COLORS.primary, borderRadius: 21 },
  cellToday: { backgroundColor: COLORS.primaryLight, borderRadius: 21 },
  cellText: { fontSize: 15, color: COLORS.text },
  cellTextSel: { color: '#fff', fontWeight: '800' },
  cellTextToday: { color: COLORS.primary, fontWeight: '700' },
  cancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontSize: 15, color: COLORS.gray4, fontWeight: '600' },
});
