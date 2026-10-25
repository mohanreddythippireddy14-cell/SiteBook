import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, Alert,
} from 'react-native';
import { format, addDays, subDays } from 'date-fns';
import { useApp } from '../context/AppContext';
import { getAttendance, setAttendance } from '../services/firestore';
import { Avatar } from '../components/Avatar';
import { COLORS, dateKey, buildHolidayDateSet, isHolidayLikeDate, isSundayKey } from '../utils/helpers';

export const AttendanceScreen = ({ userId }) => {
  const { siteWorkers, currentSite, holidays } = useApp();
  const [date, setDate] = useState(new Date());
  const [attData, setAttData] = useState([]);
  const [savingWorkerId, setSavingWorkerId] = useState(null);
  const [loadError, setLoadError] = useState('');

  const dk = dateKey(date);
  const isToday = dk === dateKey(new Date());
  const holidayDates = buildHolidayDateSet(holidays, currentSite?.id);
  const isSunday = isSundayKey(dk);
  const isHoliday = isHolidayLikeDate(dk, holidayDates);

  useEffect(() => {
    if (!currentSite) return;
    setLoadError('');
    const unsub = getAttendance(
      userId,
      currentSite.id,
      dk,
      (data) => { setLoadError(''); setAttData(data); },
      (error) => setLoadError(error?.message || 'Could not load attendance.')
    );
    return unsub;
  }, [currentSite?.id, dk, userId]);

  const getAtt = useCallback(
    (wid) => attData.find(a => a.workerId === wid) || { status: 'A', otHours: 0 },
    [attData]
  );

  const getHolidayBaseOt = (status) => {
    if (status === 'P') return 8;
    if (status === 'H') return 4;
    return 0;
  };

  const markAtt = async (wid, status) => {
    if (!currentSite || savingWorkerId === wid) return;
    const curr = getAtt(wid);
    const nextOt = isHoliday
      ? (status === 'A' ? 0 : getHolidayBaseOt(status))
      : (curr.otHours || 0);

    // FIX P3M8: Guard each worker row while its attendance write is in flight.
    setSavingWorkerId(wid);
    try {
      await setAttendance(userId, currentSite.id, wid, dk, status, nextOt);
    } catch (e) {
      Alert.alert('Could Not Save', e?.message || 'Please check your connection and try again.');
    } finally {
      setSavingWorkerId(null);
    }
  };

  const adjustOT = async (wid, delta) => {
    if (!currentSite || savingWorkerId === wid) return;
    const curr = getAtt(wid);
    if (isHoliday && curr.status !== 'A') return;

    const newOT = Math.max(0, Math.min(24, (Number(curr.otHours) || 0) + delta));
    // FIX P3M8: Guard each worker row while its OT write is in flight.
    setSavingWorkerId(wid);
    try {
      await setAttendance(userId, currentSite.id, wid, dk, curr.status || 'A', newOT);
    } catch (e) {
      Alert.alert('Could Not Save', e?.message || 'Please check your connection and try again.');
    } finally {
      setSavingWorkerId(null);
    }
  };

  const presentCount = attData.filter(a => a.status === 'P').length;
  const halfCount = attData.filter(a => a.status === 'H').length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={s.header}>
        <View>
          <Text style={s.headerLabel}>ATTENDANCE</Text>
          <Text style={s.headerSite}>{currentSite?.name || 'No site selected'}</Text>
        </View>
        <View style={s.headerStats}>
          <View style={s.statPill}>
            <Text style={s.statNum}>{presentCount}</Text>
            <Text style={s.statLbl}>Present</Text>
          </View>
          <View style={[s.statPill, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
            <Text style={s.statNum}>{halfCount}</Text>
            <Text style={s.statLbl}>Half</Text>
          </View>
        </View>
      </View>

      <View style={s.dateNav}>
        <TouchableOpacity style={s.arrow} onPress={() => setDate(subDays(date, 1))}>
          <Text style={s.arrowText}>{'<'}</Text>
        </TouchableOpacity>
        <View style={s.dateCenter}>
          <Text style={s.dateMain}>{format(date, 'EEEE, d MMMM')}</Text>
          <Text style={s.dateSub}>{format(date, 'yyyy')}{isToday ? ' | Today' : ''}</Text>
        </View>
        <TouchableOpacity style={s.arrow} onPress={() => setDate(addDays(date, 1))}>
          <Text style={s.arrowText}>{'>'}</Text>
        </TouchableOpacity>
      </View>
      {loadError ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{loadError}</Text>
        </View>
      ) : null}

      {isHoliday && (
        <View style={s.holidayBanner}>
          <Text style={s.holidayText}>
            {isSunday
              ? 'Sunday is auto-marked as a holiday. Present = 8h OT, Half Day = 4h OT, or use Absent with OT only.'
              : 'Holiday declared for this day. Present = 8h OT, Half Day = 4h OT, or use Absent with OT only.'}
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {siteWorkers.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>W</Text>
            <Text style={s.emptyTitle}>No workers on this site</Text>
            <Text style={s.emptySub}>Go to the Workers tab to add workers</Text>
          </View>
        ) : siteWorkers.map(worker => {
          const a = getAtt(worker.id);
          const isSaving = savingWorkerId === worker.id;
          return (
            <View key={worker.id} style={s.workerCard}>
              <View style={s.workerTop}>
                <Avatar name={worker.name} size={46} />
                <View style={s.workerInfo}>
                  <Text style={s.workerName}>{worker.name || '-'}</Text>
                  <Text style={s.workerMeta}>{worker.role || 'Worker'} | Rs {worker.dailyWage}/day</Text>
                </View>
                <View style={[
                  s.badge,
                  a.status === 'P' && { backgroundColor: COLORS.greenLight },
                  a.status === 'H' && { backgroundColor: COLORS.accentLight },
                  a.status === 'A' && { backgroundColor: COLORS.redLight },
                ]}>
                  <Text style={[
                    s.badgeText,
                    a.status === 'P' && { color: COLORS.green },
                    a.status === 'H' && { color: COLORS.accent },
                    a.status === 'A' && { color: COLORS.red },
                  ]}>
                    {a.status === 'P' ? 'Present' : a.status === 'H' ? 'Half Day' : 'Absent'}
                  </Text>
                </View>
              </View>

              <View style={s.statusRow}>
                {[
                  ['P', 'P Present', COLORS.green, COLORS.greenLight],
                  ['H', '1/2 Half Day', COLORS.accent, COLORS.accentLight],
                  ['A', 'X Absent', COLORS.red, COLORS.redLight],
                ].map(([st, label, c, bg]) => (
                  <TouchableOpacity
                    key={st}
                    style={[s.statusBtn, a.status === st && { backgroundColor: bg, borderColor: c }]}
                    onPress={() => markAtt(worker.id, st)}
                    disabled={isSaving}
                  >
                    <Text style={[s.statusText, a.status === st && { color: c, fontWeight: '700' }]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={s.otRow}>
                <Text style={s.otLabel}>
                  {isHoliday
                    ? (a.status === 'A' ? 'Holiday Overtime Hours' : `Holiday OT fixed at ${getHolidayBaseOt(a.status)}h`)
                    : 'Overtime Hours'}
                </Text>
                <View style={s.otCtrl}>
                  <TouchableOpacity
                    style={[s.otBtn, isHoliday && a.status !== 'A' && s.otBtnDisabled]}
                    onPress={() => adjustOT(worker.id, -0.5)}
                    disabled={isSaving || (isHoliday && a.status !== 'A')}
                  >
                    <Text style={s.otBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={s.otVal}>{Number(a.otHours) || 0}</Text>
                  <TouchableOpacity
                    style={[s.otBtn, isHoliday && a.status !== 'A' && s.otBtnDisabled]}
                    onPress={() => adjustOT(worker.id, 0.5)}
                    disabled={isSaving || (isHoliday && a.status !== 'A')}
                  >
                    <Text style={s.otBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.primary },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 1.5 },
  headerSite: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  headerStats: { flexDirection: 'row', gap: 8 },
  statPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', color: '#fff' },
  statLbl: { fontSize: 10, color: 'rgba(255,255,255,0.75)', fontWeight: '500' },
  dateNav: { backgroundColor: COLORS.white, marginHorizontal: 14, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.gray1, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 26, color: COLORS.gray5, lineHeight: 32 },
  dateCenter: { flex: 1, alignItems: 'center' },
  dateMain: { fontSize: 16, fontWeight: '700', color: COLORS.text },
  dateSub: { fontSize: 12, color: COLORS.gray4, marginTop: 2 },
  holidayBanner: { backgroundColor: '#FEF9C3', marginHorizontal: 14, marginTop: 10, borderRadius: 12, padding: 12 },
  holidayText: { fontSize: 13, color: '#92400E', fontWeight: '600' },
  errorBanner: { backgroundColor: COLORS.redLight, marginHorizontal: 14, marginTop: 10, borderRadius: 12, padding: 10 },
  errorText: { fontSize: 12, color: COLORS.red, fontWeight: '700' },
  scroll: { paddingHorizontal: 14, paddingTop: 12, backgroundColor: COLORS.gray0 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 28, marginBottom: 14, fontWeight: '800', color: COLORS.gray4 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: COLORS.gray5, marginBottom: 6 },
  emptySub: { fontSize: 13, color: COLORS.gray4, textAlign: 'center' },
  workerCard: { backgroundColor: COLORS.white, borderRadius: 16, padding: 16, marginBottom: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
  workerTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  workerMeta: { fontSize: 12, color: COLORS.gray4, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  statusRow: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  statusBtn: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray2, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gray0 },
  statusText: { fontSize: 12, fontWeight: '600', color: COLORS.gray4 },
  otRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.gray1 },
  otLabel: { flex: 1, fontSize: 13, color: COLORS.gray4, fontWeight: '500' },
  otCtrl: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  otBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  otBtnDisabled: { opacity: 0.35 },
  otBtnText: { fontSize: 20, color: COLORS.primary, fontWeight: '700', lineHeight: 24 },
  otVal: { fontSize: 17, fontWeight: '800', color: COLORS.text, minWidth: 30, textAlign: 'center' },
});
