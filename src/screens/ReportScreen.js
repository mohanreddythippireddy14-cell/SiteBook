import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, ActivityIndicator, Share, Alert,
} from 'react-native';
import { format, subMonths } from 'date-fns';
import { useApp } from '../context/AppContext';
// FIX P5L1: Removed unused import getAllAttendancePaginated (All Time export removed).
import { getMonthAttendance, getMonthAttendanceOnce } from '../services/firestore';
import { generateAndSharePDF } from '../services/pdf';
import { exportAttendanceXLSX } from '../services/xlsx';
import { Avatar } from '../components/Avatar';
import { COLORS, liveMonthKey, monthKey, calcWorkerMonth, rupees, lastDayOfMonth, buildHolidayDateSet } from '../utils/helpers';

export const ReportScreen = ({ userId }) => {
  const { siteWorkers, currentSite, advances, sites, holidays } = useApp();

  // FIX BUG-20: use ref + interval to keep ym live, not stale from render
  const [ym,          setYm]          = useState(liveMonthKey());
  const [attendance,  setAttendance]  = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [xlsLoading,  setXlsLoading]  = useState(false);
  const [waLoading,   setWaLoading]   = useState(false);
  const [reportError, setReportError] = useState('');
  const [tab,         setTab]         = useState('salary');
  const [exportMode,  setExportMode]  = useState('tillNow');
  const [exportYm,    setExportYm]    = useState(liveMonthKey());
  const siteWorkerIds = useMemo(() => siteWorkers.map(w => w.id), [siteWorkers]);
  const exportOptions = useMemo(() => {
    const now = new Date();
    const completedMonths = Array.from({ length: 24 }, (_, i) => {
      const date = subMonths(now, i + 1);
      const ymKey = monthKey(date);
      return {
        key: ymKey,
        mode: 'month',
        ym: ymKey,
        title: format(date, 'MMM yyyy'),
        subtitle: 'Finished month',
      };
    });

    return [
      {
        key: 'tillNow',
        mode: 'tillNow',
        ym: monthKey(now),
        title: 'Till Now',
        subtitle: format(now, 'MMM yyyy'),
      },
      ...completedMonths,
    ];
  }, [ym]);

  // FIX BUG-20: refresh ym every minute so it updates at midnight
  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = liveMonthKey();
      setYm(prev => prev !== fresh ? fresh : prev);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const monthLabel = format(new Date(ym + '-01'), 'MMMM yyyy');
  const exportLabel = exportMode === 'tillNow'
    ? `Till Now (${format(new Date(exportYm + '-01'), 'MMMM yyyy')})`
    : format(new Date(exportYm + '-01'), 'MMMM yyyy');

  useEffect(() => {
    if (exportMode === 'tillNow' && exportYm !== ym) setExportYm(ym);
  }, [exportMode, exportYm, ym]);

  useEffect(() => {
    if (!currentSite?.id) {
      setAttendance([]);
      return;
    }
    setReportError('');
    const unsub = getMonthAttendance(
      userId,
      currentSite.id,
      ym,
      (data) => { setReportError(''); setAttendance(data); },
      siteWorkerIds,
      (error) => setReportError(error?.message || 'Could not load report data.')
    );
    return unsub;
  }, [currentSite?.id, ym, userId, siteWorkerIds]);

  const holidayDates = buildHolidayDateSet(holidays, currentSite?.id);
  const attendanceByWorkerDate = useMemo(() => {
    const map = new Map();
    attendance.forEach((a) => {
      if (a.workerId && a.date) map.set(`${a.workerId}_${a.date}`, a);
    });
    return map;
  }, [attendance]);
  const results    = siteWorkers.map(w => ({ w, r: calcWorkerMonth(w, attendance, advances, ym, holidayDates) }));
  const totalGross = results.reduce((s, { r }) => s + r.gross, 0);
  const totalNet   = results.reduce((s, { r }) => s + r.net, 0);
  const hasWarning = results.some(({ r }) => r.overAdvanced);

  const selectExportOption = (option) => {
    setExportMode(option.mode);
    setExportYm(option.ym);
  };

  const ensureReportReady = () => {
    if (!currentSite?.id) {
      Alert.alert('Select Site', 'Please select or create a site before printing a report.');
      return false;
    }
    return true;
  };

  const getExportAttendance = async () => {
    if (!currentSite?.id) throw new Error('Please select or create a site before printing a report.');
    if (exportYm === ym) return attendance;
    return getMonthAttendanceOnce(userId, currentSite.id, exportYm, siteWorkerIds);
  };

  // FIX BUG-11 & BUG-12: export uses correct month and real company name
  const exportPDF = async () => {
    if (!ensureReportReady()) return;
    setLoading(true);
    try {
      const attData = await getExportAttendance();
      const success = await generateAndSharePDF({
        site: currentSite, // FIX BUG-12: site.company used inside pdf.js
        workers: siteWorkers,
        attendance: attData,
        advances,
        holidays,
        yearMonth: exportYm,
      });
      if (success) Alert.alert('✓ Done', 'PDF report shared successfully.');
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not generate PDF');
    } finally {
      setLoading(false);
    }
  };

  const exportXLS = async () => {
    if (!ensureReportReady()) return;
    setXlsLoading(true);
    try {
      const attData = await getExportAttendance();
      // FIX BUG-13: xlsx.js now filters OT by month, attData is already month-filtered
      const success = await exportAttendanceXLSX({
        workers: siteWorkers,
        attendance: attData,
        advances,
        holidays,
        yearMonth: exportYm,
        siteName: currentSite?.name || 'Site',
        siteId: currentSite?.id,
      });
      if (success) Alert.alert('✓ Done', 'Excel sheet shared successfully.');
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not export Excel file');
    } finally {
      setXlsLoading(false);
    }
  };

  const shareWhatsApp = async () => {
    if (waLoading) return;
    if (!ensureReportReady()) return;
    setWaLoading(true);
    try {
      const attData = await getExportAttendance();

      // FIX P1H3: Recompute WhatsApp export from exportYm so Last Month does not share current-month data.
      const results = siteWorkers.map(w => ({ w, r: calcWorkerMonth(w, attData, advances, exportYm, holidayDates) }));
      const totalGross = results.reduce((s, { r }) => s + r.gross, 0);
      const totalNet = results.reduce((s, { r }) => s + r.net, 0);
      const hasWarning = results.some(({ r }) => r.overAdvanced);

    const lines = [
      `*SiteBook Salary Report*`,
      `Site: ${currentSite?.name}`,
      `Period: ${exportLabel}`,
      ``,
    ];
    results.forEach(({ w, r }) => {
      const warn = r.overAdvanced ? ' ⚠️' : '';
      lines.push(`• ${w.name}: ${r.days}d + ${r.half} half + ${r.otHrs.toFixed(1)}h OT = ₹${Math.round(r.net).toLocaleString('en-IN')}${warn}`);
    });
    lines.push(``, `*Total Gross: ₹${Math.round(totalGross).toLocaleString('en-IN')}*`);
    lines.push(`*Net Payable: ₹${Math.round(totalNet).toLocaleString('en-IN')}*`);
    if (hasWarning) lines.push(`⚠️ Some workers have advances exceeding their salary.`);
    lines.push(``, `_Sent via SiteBook_`);
    await Share.share({ message: lines.join('\n') });
    } catch (e) {
      Alert.alert('Error', e?.message || 'Could not share WhatsApp report');
    } finally {
      setWaLoading(false);
    }
  };

  // ─── Attendance grid (FIX BUG-15: use a single horizontal ScrollView properly) ─
  const daysInMonth = lastDayOfMonth(ym);
  const dayNums     = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const today = new Date();
  const currentMonth = ym === monthKey(today);
  const todayDay = today.getDate();
  const totalPresent = results.reduce((sum, { r }) => sum + r.days, 0);
  const totalHalf = results.reduce((sum, { r }) => sum + r.half, 0);
  // FIX P1M6: Count absences only through today for the current month so future days are not marked absent.
  const countedDays = currentMonth ? todayDay : daysInMonth;
  const totalAbsent = Math.max(0, siteWorkers.length * countedDays - totalPresent - totalHalf);
  const totalBasicPay = results.reduce((sum, { r }) => sum + r.basicPay, 0);
  const totalOtHours = results.reduce((sum, { r }) => sum + r.otHrs, 0);
  const totalOtPay = results.reduce((sum, { r }) => sum + r.otPay, 0);
  const totalAdvance = results.reduce((sum, { r }) => sum + r.advances, 0);
  const totalPayable = results.reduce((sum, { r }) => sum + r.net, 0);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      <View style={s.header}>
        <View>
          <Text style={s.headerLabel}>REPORT</Text>
          <Text style={s.headerSite}>{monthLabel}</Text>
        </View>
        {hasWarning && (
          <View style={s.warnBadge}>
            <Text style={s.warnBadgeText}>⚠️ Check advances</Text>
          </View>
        )}
      </View>
      {reportError ? (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{reportError}</Text>
        </View>
      ) : null}

      {/* Tabs */}
      <View style={s.tabBar}>
        {[['salary','💰 Salary'],['attendance','📋 Attendance']].map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.tabBtn, tab === key && s.tabBtnActive]} onPress={() => setTab(key)}>
            <Text style={[s.tabText, tab === key && s.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'salary' ? (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

          {/* Summary */}
          <View style={s.summaryRow}>
            <View style={[s.summaryBox, { backgroundColor: COLORS.primaryLight }]}>
              <Text style={s.summaryLabel}>Total Gross</Text>
              <Text style={[s.summaryValue, { color: COLORS.primary }]}>{rupees(totalGross)}</Text>
            </View>
            <View style={[s.summaryBox, { backgroundColor: COLORS.greenLight }]}>
              <Text style={[s.summaryLabel, { color: COLORS.green }]}>Net Payable</Text>
              <Text style={[s.summaryValue, { color: COLORS.green }]}>{rupees(totalNet)}</Text>
            </View>
          </View>

          {/* FIX BUG-11: Export period actually changes the data fetched */}
          <View style={s.rangeSection}>
            <View style={s.exportHeader}>
              <Text style={s.sectionTitle}>Print Receipt</Text>
              <Text style={s.exportSelected}>{exportLabel}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {exportOptions.map((option) => {
                  const active = exportMode === option.mode && exportYm === option.ym;
                  return (
                  <TouchableOpacity
                    key={option.key}
                    style={[s.rangePill, active && s.rangePillActive]}
                    onPress={() => selectExportOption(option)}
                  >
                    <Text style={[s.rangePillText, active && s.rangePillTextActive]}>
                      {option.title}
                    </Text>
                    <Text style={[s.rangePillSub, active && s.rangePillSubActive]}>{option.subtitle}</Text>
                  </TouchableOpacity>
                );})}
              </View>
            </ScrollView>
          </View>

          {/* Action buttons */}
          <View style={s.shareRow}>
            <TouchableOpacity style={[s.shareBtn, s.pdfBtn]} onPress={exportPDF} disabled={loading}>
              {loading ? <ActivityIndicator color={COLORS.red} size="small" />
                : <Text style={[s.shareBtnText, { color: COLORS.red }]}>📄 PDF</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.shareBtn, s.xlsBtn]} onPress={exportXLS} disabled={xlsLoading}>
              {xlsLoading ? <ActivityIndicator color={COLORS.green} size="small" />
                : <Text style={[s.shareBtnText, { color: COLORS.green }]}>📊 Excel</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[s.shareBtn, s.waBtn]} onPress={shareWhatsApp} disabled={waLoading}>
              <Text style={[s.shareBtnText, { color: '#fff' }]}>💬 WhatsApp</Text>
            </TouchableOpacity>
          </View>

          {/* Worker table */}
          <View style={s.card}>
            <View style={s.tableHeader}>
              <Text style={[s.th, { flex: 1 }]}>Worker</Text>
              <Text style={s.th}>Days</Text>
              <Text style={s.th}>Gross</Text>
              <Text style={s.th}>Net</Text>
            </View>
            {results.length === 0
              ? <Text style={s.noData}>No workers on this site</Text>
              : results.map(({ w, r }) => (
                <View key={w.id} style={s.tableRow}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Avatar name={w.name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.workerName} numberOfLines={1}>{w.name}</Text>
                      <Text style={s.workerDetail}>
                        {r.days}d · {r.half}½ · {r.otHrs.toFixed(1)}h OT
                        {r.advances > 0 ? ` · Adv ${rupees(r.advances)}` : ''}
                        {r.overAdvanced ? ' ⚠️' : ''}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.tdCenter}>{r.days}{r.half > 0 ? `+${r.half}½` : ''}</Text>
                  <Text style={s.tdRight}>{rupees(r.gross)}</Text>
                  <Text style={[s.tdRight, s.netPay, r.overAdvanced && { color: COLORS.red }]}>
                    {rupees(r.net)}
                  </Text>
                </View>
              ))
            }
          </View>
          <View style={{ height: 30 }} />
        </ScrollView>
      ) : (
        /* FIX BUG-15: attendance grid uses a proper layout — no nested conflicting ScrollViews */
        <View style={{ flex: 1, backgroundColor: COLORS.gray0 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 }}>
            <Text style={s.sectionTitle}>📋 {monthLabel}</Text>
            <TouchableOpacity style={s.excelBtn} onPress={exportXLS} disabled={xlsLoading}>
              <Text style={s.excelBtnText}>{xlsLoading ? '...' : '⬇ Excel'}</Text>
            </TouchableOpacity>
          </View>

          {/* FIX BUG-15: outer is vertical ScrollView, inner grid uses horizontal ScrollView with nestedScrollEnabled */}
          <ScrollView showsVerticalScrollIndicator={false}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true} nestedScrollEnabled={true}>
              <View>
                {/* Header */}
                <View style={{ flexDirection: 'row', backgroundColor: COLORS.primary }}>
                  <Text style={[g.cell, g.nameCell, g.hdr]}>Worker</Text>
                  {dayNums.map(d => <Text key={d} style={[g.cell, g.dayCell, g.hdr]}>{d}</Text>)}
                  <Text style={[g.cell, g.sumCell, g.hdr]}>P</Text>
                  <Text style={[g.cell, g.sumCell, g.hdr]}>H</Text>
                  <Text style={[g.cell, g.sumCell, g.hdr]}>A</Text>
                  <Text style={[g.cell, g.moneyCell, g.hdr]}>Basic</Text>
                  <Text style={[g.cell, g.moneyCell, g.hdr]}>OT Hrs</Text>
                  <Text style={[g.cell, g.moneyCell, g.hdr]}>OT Pay</Text>
                  <Text style={[g.cell, g.moneyCell, g.hdr]}>Advance</Text>
                  <Text style={[g.cell, g.moneyCell, g.hdr]}>Total Pay</Text>
                </View>
                {/* Rows */}
                {siteWorkers.map(w => {
                  const days = dayNums.map(d => {
                    const dateStr = `${ym}-${String(d).padStart(2,'0')}`;
                    if (currentMonth && d > todayDay) return '';
                    return attendanceByWorkerDate.get(`${w.id}_${dateStr}`)?.status || 'A';
                  });
                  const P = days.filter(x => x === 'P').length;
                  const H = days.filter(x => x === 'H').length;
                  const A = days.filter(x => x === 'A').length;
                  const workerResult = calcWorkerMonth(w, attendance, advances, ym, holidayDates);
                  return (
                    <View key={w.id} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: COLORS.gray1, backgroundColor: COLORS.white }}>
                      <Text style={[g.cell, g.nameCell]} numberOfLines={1}>{w.name}</Text>
                      {days.map((st, i) => (
                        <View key={i} style={[g.cell, g.dayCell, g.dayBox,
                          st === 'P' && { backgroundColor: COLORS.greenLight },
                          st === 'H' && { backgroundColor: COLORS.accentLight },
                        ]}>
                          <Text style={[g.dayTxt,
                            st === 'P' && { color: COLORS.green },
                            st === 'H' && { color: COLORS.accent },
                            st === 'A' && { color: COLORS.gray3 },
                            !st && { color: COLORS.gray3 },
                          ]}>{st || '-'}</Text>
                        </View>
                      ))}
                      <Text style={[g.cell, g.sumCell, { color: COLORS.green, fontWeight: '700' }]}>{P}</Text>
                      <Text style={[g.cell, g.sumCell, { color: COLORS.accent, fontWeight: '700' }]}>{H}</Text>
                      <Text style={[g.cell, g.sumCell, { color: COLORS.gray3 }]}>{A}</Text>
                      <Text style={[g.cell, g.moneyCell]}>{rupees(workerResult.basicPay)}</Text>
                      <Text style={[g.cell, g.moneyCell]}>{workerResult.otHrs.toFixed(1)}</Text>
                      <Text style={[g.cell, g.moneyCell]}>{rupees(workerResult.otPay)}</Text>
                      <Text style={[g.cell, g.moneyCell]}>{rupees(workerResult.advances)}</Text>
                      <Text style={[g.cell, g.moneyCell, { fontWeight: '700', color: workerResult.net < 0 ? COLORS.red : COLORS.green }]}>{rupees(workerResult.net)}</Text>
                    </View>
                  );
                })}
                <View style={[g.totalRow, { flexDirection: 'row' }]}>
                  <Text style={[g.cell, g.nameCell, g.totalText]}>TOTAL</Text>
                  {dayNums.map((d) => <Text key={d} style={[g.cell, g.dayCell, g.totalText]}>-</Text>)}
                  <Text style={[g.cell, g.sumCell, g.totalText]}>{totalPresent}</Text>
                  <Text style={[g.cell, g.sumCell, g.totalText]}>{totalHalf}</Text>
                  <Text style={[g.cell, g.sumCell, g.totalText]}>{totalAbsent}</Text>
                  <Text style={[g.cell, g.moneyCell, g.totalText]}>{rupees(totalBasicPay)}</Text>
                  <Text style={[g.cell, g.moneyCell, g.totalText]}>{totalOtHours.toFixed(1)}</Text>
                  <Text style={[g.cell, g.moneyCell, g.totalText]}>{rupees(totalOtPay)}</Text>
                  <Text style={[g.cell, g.moneyCell, g.totalText]}>{rupees(totalAdvance)}</Text>
                  <Text style={[g.cell, g.moneyCell, g.totalText, { color: totalPayable < 0 ? COLORS.red : COLORS.green }]}>{rupees(totalPayable)}</Text>
                </View>
              </View>
            </ScrollView>
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: COLORS.primary },
  header:        { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLabel:   { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 1.5 },
  headerSite:    { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  warnBadge:     { backgroundColor: '#FEF9C3', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  warnBadgeText: { fontSize: 11, color: '#92400E', fontWeight: '700' },
  errorBanner:   { backgroundColor: COLORS.redLight, paddingHorizontal: 14, paddingVertical: 8 },
  errorText:     { color: COLORS.red, fontSize: 12, fontWeight: '700' },
  tabBar:        { flexDirection: 'row', marginHorizontal: 14, marginBottom: 0, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 4, gap: 4 },
  tabBtn:        { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  tabBtnActive:  { backgroundColor: '#fff' },
  tabText:       { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  tabTextActive: { color: COLORS.primary },
  scroll:        { paddingHorizontal: 14, paddingTop: 14, backgroundColor: COLORS.gray0 },
  summaryRow:    { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryBox:    { flex: 1, borderRadius: 16, padding: 16 },
  summaryLabel:  { fontSize: 11, color: COLORS.primary, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue:  { fontSize: 24, fontWeight: '800', marginTop: 4 },
  rangeSection:  { marginBottom: 12 },
  exportHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 },
  exportSelected:{ flex: 1, textAlign: 'right', fontSize: 12, color: COLORS.gray4, fontWeight: '600' },
  sectionTitle:  { fontSize: 13, fontWeight: '700', color: COLORS.gray5, marginBottom: 8 },
  rangePill:     { minWidth: 104, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray2, backgroundColor: COLORS.white },
  rangePillActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  rangePillText:   { fontSize: 13, color: COLORS.gray4, fontWeight: '500' },
  rangePillTextActive: { color: COLORS.primary, fontWeight: '700' },
  rangePillSub: { fontSize: 10, color: COLORS.gray3, fontWeight: '600', marginTop: 2 },
  rangePillSubActive: { color: COLORS.primary },
  shareRow:      { flexDirection: 'row', gap: 8, marginBottom: 14 },
  shareBtn:      { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pdfBtn:        { backgroundColor: COLORS.redLight, borderWidth: 1, borderColor: '#FCA5A5' },
  xlsBtn:        { backgroundColor: COLORS.greenLight, borderWidth: 1, borderColor: '#86EFAC' },
  waBtn:         { backgroundColor: '#25D366' },
  shareBtnText:  { fontSize: 13, fontWeight: '700' },
  card:          { backgroundColor: COLORS.white, borderRadius: 16, padding: 14, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  tableHeader:   { flexDirection: 'row', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.gray1 },
  th:            { fontSize: 11, color: COLORS.gray4, fontWeight: '700', textTransform: 'uppercase', width: 60, textAlign: 'right' },
  tableRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.gray1 },
  workerName:    { fontSize: 13, fontWeight: '700', color: COLORS.text },
  workerDetail:  { fontSize: 11, color: COLORS.gray4, marginTop: 2 },
  tdCenter:      { width: 60, textAlign: 'center', fontSize: 13, color: COLORS.gray5 },
  tdRight:       { width: 60, textAlign: 'right', fontSize: 13, color: COLORS.gray5 },
  netPay:        { fontWeight: '800', color: COLORS.green },
  noData:        { textAlign: 'center', color: COLORS.gray4, paddingVertical: 20, fontSize: 14 },
  excelBtn:      { backgroundColor: COLORS.greenLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  excelBtnText:  { fontSize: 12, fontWeight: '700', color: COLORS.green },
});

const g = StyleSheet.create({
  cell:     { height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  nameCell: { width: 100, paddingHorizontal: 8, alignItems: 'flex-start', justifyContent: 'center' },
  dayCell:  { width: 28 },
  sumCell:  { width: 30, textAlign: 'center', fontSize: 12 },
  moneyCell:{ width: 86, textAlign: 'center', fontSize: 11 },
  hdr:      { color: '#fff', fontSize: 10, fontWeight: '700' },
  dayBox:   { margin: 1, borderRadius: 4, width: 26, height: 26 },
  dayTxt:   { fontSize: 9, fontWeight: '700' },
  totalRow: { backgroundColor: COLORS.primaryLight, borderTopWidth: 2, borderTopColor: COLORS.primary },
  totalText:{ fontSize: 10, fontWeight: '700', color: COLORS.primary },
});
