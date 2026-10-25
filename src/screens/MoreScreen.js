import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Alert, Platform,
} from 'react-native';
import { format } from 'date-fns';
import { useApp } from '../context/AppContext';
import {
  addSite, deleteSite,
  addAdvance, deleteAdvance,
  addHoliday, deleteHoliday,
} from '../services/firestore';
import { useGoogleAuthRequest, completeGoogleSignIn } from '../services/googleAuth';
import {
  setDriveAuth,
  setDriveSyncEnabled, getDriveSyncEnabled,
  getDriveAuth, getDriveSyncMeta,
  syncToDriveNow, queueDriveSync,
} from '../services/driveSync';
import { BottomSheet }    from '../components/BottomSheet';
import { FormInput }      from '../components/FormInput';
import { CalendarPicker } from '../components/CalendarPicker';
import { COLORS, sanitizeWage } from '../utils/helpers';

export const MoreScreen = ({ userId }) => {
  const { sites, workers, advances, holidays, currentSite, setCurrentSite, siteWorkers } = useApp();
  const [sheet,    setSheet]    = useState(null);
  const [form,     setForm]     = useState({});
  const [showCal,  setShowCal]  = useState(false);
  const [calTarget, setCalTarget] = useState(null);
  const [driveConnected, setDriveConnected] = useState(false);
  const [driveEnabled, setDriveEnabled] = useState(false);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveLastSync, setDriveLastSync] = useState(null);
  const [driveLastError, setDriveLastError] = useState('');
  const [driveEmail, setDriveEmail] = useState('');

  const [request, response, promptAsync] = useGoogleAuthRequest();

  const siteAdvances = advances.filter(a => siteWorkers.some(w => w.id === a.workerId));
  const siteHolidays = holidays.filter(h => h.siteId === currentSite?.id);

  const formatDisplayDate = (dateStr) => {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const [year, month, day] = dateStr.split('-');
    if (!year || !month || !day) return dateStr;
    return `${day}-${month}-${year}`;
  };

  const parseMoneyInput = (value) => {
    const cleaned = String(value || '').replace(/[^\d.]/g, '');
    if (!cleaned) return NaN;

    const parts = cleaned.split('.');
    const normalized = parts.length > 1
      ? `${parts[0]}.${parts.slice(1).join('')}`
      : cleaned;

    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : NaN;
  };

  const confirmLargeAdvance = async (amt, approxMonthly) => {
    const message =
      `This advance (Rs ${amt.toLocaleString('en-IN')}) is more than the estimated monthly salary ` +
      `(Rs ${Math.round(approxMonthly).toLocaleString('en-IN')}). The net pay will be negative.\n\nContinue?`;

    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }

    return new Promise((resolve) => {
      Alert.alert(
        'Large Advance',
        message,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Yes, Record It', onPress: () => resolve(true) },
        ]
      );
    });
  };

  const openCal = (target) => { setCalTarget(target); setShowCal(true); };
  const onCalSelect = (dateStr) => {
    if (calTarget === 'holiday') setForm(f => ({ ...f, holDate: dateStr }));
    if (calTarget === 'advance') setForm(f => ({ ...f, advDate: dateStr }));
  };

  const refreshDriveStatus = async () => {
    const auth = await getDriveAuth();
    const enabled = await getDriveSyncEnabled();
    const meta = await getDriveSyncMeta();
    setDriveConnected(!!auth?.accessToken);
    setDriveEmail(auth?.email || '');
    setDriveEnabled(enabled);
    setDriveLastSync(meta.lastSyncAt || null);
    setDriveLastError(meta.lastError || '');
  };

  useEffect(() => {
    refreshDriveStatus();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!response || response.type !== 'success') return;
      try {
        const { user, tokens } = await completeGoogleSignIn(response);
        if (!tokens?.accessToken) throw new Error('No Google Drive token received.');

        await setDriveAuth({
          accessToken: tokens.accessToken,
          idToken: tokens.idToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          email: user?.email || '',
          firebaseUid: user?.uid || '',
        });
        await setDriveSyncEnabled(true);
        await queueDriveSync(user?.uid || userId, 'connect');
        await refreshDriveStatus();
        Alert.alert(
          'Connected',
          tokens.refreshToken
            ? 'Google Drive sync is now enabled.'
            : 'Google Drive sync is enabled for this session. If Google expires access later, reconnect Drive from this screen.'
        );
      } catch (e) {
        Alert.alert('Google Sign-In Failed', e?.message || 'Please try again.');
      }
    };
    run();
  }, [response]);

  // ── Sites ──────────────────────────────────────────────────────────────────
  const doAddSite = async () => {
    if (!form.siteName?.trim()) return Alert.alert('Error', 'Please enter a site name');
    await addSite(userId, { name: form.siteName.trim(), company: form.company?.trim() || '' });
    setSheet(null);
  };

  // FIX BUG-16: confirm before cascading delete
  const doDeleteSite = (site) => {
    const workerCount = workers.filter(w => w.siteId === site.id).length;
    Alert.alert(
      'Delete Site',
      `Delete "${site.name}"?\n\nThis will permanently delete ${workerCount} worker(s), all their attendance records, advances, and holidays.\n\nThis cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSite(userId, site.id); // cascading delete
            } catch (e) {
              Alert.alert('Error', 'Could not delete site. Please try again.');
            }
          },
        },
      ]
    );
  };

  // ── Advances ───────────────────────────────────────────────────────────────
  const doAddAdvance = async () => {
    if (!form.advWorker) return Alert.alert('Error', 'Please select a worker');
    const amt = parseMoneyInput(form.advAmt);
    if (!form.advAmt || isNaN(amt) || amt <= 0) {
      return Alert.alert('Invalid Amount', 'Please enter a valid advance amount greater than 0');
    }
    if (amt > Number.MAX_SAFE_INTEGER) {
      return Alert.alert('Invalid Amount', 'That amount is too large to store safely.');
    }

    // FIX BUG-03: warn if advance seems very large
    const worker = siteWorkers.find(w => w.id === form.advWorker);
    const approxMonthly = sanitizeWage(worker?.dailyWage) * 26;
    if (amt > approxMonthly && approxMonthly > 0) {
      const confirmed = await confirmLargeAdvance(amt, approxMonthly);
      if (!confirmed) return;
    }
    await saveAdvance(amt);
  };

  const saveAdvance = async (amt) => {
    const date = form.advDate || format(new Date(), 'yyyy-MM-dd');
    await addAdvance(userId, {
      workerId:  form.advWorker,
      amount:    amt,
      date,
      yearMonth: date.slice(0, 7),
      note:      form.advNote?.trim() || '',
    });
    setSheet(null);
  };

  // ── Holidays ───────────────────────────────────────────────────────────────
  const doAddHoliday = async () => {
    if (!form.holDate) return Alert.alert('Error', 'Please pick a date from the calendar');
    if (!currentSite?.id) {
      // FIX P1M5: Block holiday saves without a selected site so siteId is never undefined.
      return Alert.alert('Error', 'Please add or select a site before declaring a holiday.');
    }
    // Check for duplicate
    const exists = siteHolidays.some(h => h.date === form.holDate);
    if (exists) return Alert.alert('Duplicate', 'A holiday is already declared for this date.');
    await addHoliday(userId, {
      date:   form.holDate,
      name:   form.holName?.trim() || 'Holiday',
      siteId: currentSite.id,
    });
    setSheet(null);
  };

  const Section = ({ title, children }) => (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );

  const connectDrive = async () => {
    try {
      await promptAsync();
    } catch (e) {
      Alert.alert('Google Sign-In Failed', e?.message || 'Please try again.');
    }
  };

  // FIX P5L2: Removed dead functions disconnectDrive and toggleAutoSync (UI buttons removed).

  const manualSync = async () => {
    setDriveBusy(true);
    try {
      await syncToDriveNow(userId);
      await refreshDriveStatus();
      Alert.alert('Sync Complete', 'Your data is backed up to Google Drive.');
    } catch (e) {
      await refreshDriveStatus();
      Alert.alert('Sync Failed', e?.message || 'Please try again.');
    } finally {
      setDriveBusy(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <View style={s.header}>
        <Text style={s.headerLabel}>MORE</Text>
        <Text style={s.headerSite}>Settings & Tools</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* CLOUD SYNC */}
        <Section title="Cloud Sync">
          <View style={[s.card, s.syncCard]}>
            <Text style={s.syncTitle}>Google Drive Backup</Text>
            <Text style={s.syncSub}>
              {driveConnected
                ? `Connected${driveEmail ? ` as ${driveEmail}` : ''}`
                : 'Not connected'}
            </Text>
            {driveLastSync ? (
              <Text style={s.syncMeta}>
                Last sync: {format(new Date(driveLastSync), 'dd MMM, hh:mm a')}
              </Text>
            ) : null}
            {driveLastError ? <Text style={s.syncError}>{driveLastError}</Text> : null}

            <View style={s.syncActions}>
              {!driveConnected ? (
                <TouchableOpacity style={s.confirmBtn} onPress={connectDrive} disabled={!request}>
                  <Text style={s.confirmText}>Connect Google Drive</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={s.confirmBtn} onPress={manualSync} disabled={driveBusy}>
                  <Text style={s.confirmText}>{driveBusy ? 'Syncing...' : 'Sync Now'}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Section>

        {/* SITES */}
        <Section title="🏗 Sites">
          <View style={s.card}>
            {sites.length === 0 && (
              <Text style={s.emptyMsg}>No sites yet. Add your first site below.</Text>
            )}
            {sites.map((site, i) => (
              <View key={site.id} style={[s.siteRow, i < sites.length - 1 && s.borderB]}>
                <View style={[s.siteDot, site.id === currentSite?.id && s.siteDotActive]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.siteName}>{site.name}</Text>
                  {site.company ? <Text style={s.siteCompany}>{site.company}</Text> : null}
                </View>
                {site.id === currentSite?.id
                  ? <View style={s.activePill}><Text style={s.activePillText}>Active</Text></View>
                  : <TouchableOpacity onPress={() => setCurrentSite(site)} style={s.switchBtn}>
                      <Text style={s.switchBtnText}>Switch</Text>
                    </TouchableOpacity>
                }
                <TouchableOpacity onPress={() => doDeleteSite(site)} style={s.delBtn}>
                  <Text style={s.delIcon}>🗑</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={s.addRowBtn} onPress={() => { setForm({}); setSheet('site'); }}>
              <Text style={s.addRowBtnText}>+ Add New Site</Text>
            </TouchableOpacity>
          </View>
        </Section>

        {/* ADVANCES */}
        <Section title="💵 Advances & Loans">
          <TouchableOpacity
            style={s.addBannerBtn}
            onPress={() => { setForm({ advDate: format(new Date(), 'yyyy-MM-dd') }); setSheet('advance'); }}
          >
            <Text style={s.addBannerText}>+ Record an Advance</Text>
          </TouchableOpacity>
          {siteAdvances.length > 0 && (
            <View style={[s.card, { marginTop: 10 }]}>
              {siteAdvances.map((a, i) => {
                const w = workers.find(x => x.id === a.workerId);
                return (
                  <View key={a.id} style={[s.listRow, i < siteAdvances.length - 1 && s.borderB]}>
                    <View style={s.listInfo}>
                      <Text style={s.listName}>{w?.name || '?'}</Text>
                      <Text style={s.listMeta}>{formatDisplayDate(a.date)}{a.note ? ` · ${a.note}` : ''}</Text>
                    </View>
                    <Text style={s.advAmt}>₹{(a.amount || 0).toLocaleString('en-IN')}</Text>
                    <TouchableOpacity onPress={() => deleteAdvance(userId, a.id)} style={s.delBtn}>
                      <Text style={s.delIcon}>✕</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </Section>

                {/* HOLIDAYS */}
        <Section title="Holidays">
          <TouchableOpacity
            style={s.addBannerBtn}
            onPress={() => { setForm({ holDate: format(new Date(), 'yyyy-MM-dd') }); setSheet('holiday'); }}
          >
            <Text style={s.addBannerText}>+ Declare a Holiday</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.addBannerBtn, { marginTop: 10, backgroundColor: COLORS.white, borderWidth: 1.5, borderColor: COLORS.gray2 }]}
            onPress={() => setSheet('holidayList')}
          >
            <Text style={[s.addBannerText, { color: COLORS.gray5 }]}>
              {siteHolidays.length > 0 ? 'View Declared Holidays (' + siteHolidays.length + ')' : 'View Declared Holidays'}
            </Text>
          </TouchableOpacity>
        </Section>

        <View style={{ height: 30 }} />
      </ScrollView>


      {/* ADD SITE */}
      <BottomSheet visible={sheet === 'site'} onClose={() => setSheet(null)} title="🏗 Add New Site">
        <FormInput label="Site Name *" value={form.siteName || ''} onChangeText={t => setForm({ ...form, siteName: t })} placeholder="e.g. Site C, Malad Project" />
        <FormInput label="Company Name (optional)" value={form.company || ''} onChangeText={t => setForm({ ...form, company: t })} placeholder="e.g. Sharma Builders" />
        <View style={s.sheetActions}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setSheet(null)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={doAddSite}><Text style={s.confirmText}>Add Site</Text></TouchableOpacity>
        </View>
      </BottomSheet>

      {/* ADD ADVANCE */}
      <BottomSheet visible={sheet === 'advance'} onClose={() => setSheet(null)} title="💵 Record Advance">
        <Text style={s.formLabel}>Select Worker *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {siteWorkers.map(w => (
              <TouchableOpacity key={w.id}
                style={[s.pill, form.advWorker === w.id && s.pillActive]}
                onPress={() => setForm({ ...form, advWorker: w.id })}
              >
                <Text style={[s.pillText, form.advWorker === w.id && s.pillTextActive]}>{w.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        <FormInput label="Advance Amount (₹) *" value={form.advAmt || ''} onChangeText={t => setForm({ ...form, advAmt: t })} keyboardType="numeric" placeholder="e.g. 2000 or 1,00,000" />
        <Text style={s.formLabel}>Date *</Text>
        <TouchableOpacity style={s.datePicker} onPress={() => openCal('advance')}>
          <Text style={s.datePickerText}>{form.advDate ? formatDisplayDate(form.advDate) : 'Tap to pick date'}</Text>
          <Text style={s.datePickerIcon}>📅</Text>
        </TouchableOpacity>
        <FormInput label="Reason (optional)" value={form.advNote || ''} onChangeText={t => setForm({ ...form, advNote: t })} placeholder="e.g. Medical emergency" />
        <View style={s.sheetActions}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setSheet(null)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={doAddAdvance}><Text style={s.confirmText}>Record</Text></TouchableOpacity>
        </View>
      </BottomSheet>

      {/* ADD HOLIDAY */}
      <BottomSheet visible={sheet === 'holiday'} onClose={() => setSheet(null)} title="🎉 Declare Holiday">
        <Text style={s.formLabel}>Pick Date *</Text>
        <TouchableOpacity style={s.datePicker} onPress={() => openCal('holiday')}>
          <Text style={s.datePickerText}>{form.holDate ? formatDisplayDate(form.holDate) : 'Tap to open calendar'}</Text>
          <Text style={s.datePickerIcon}>📅</Text>
        </TouchableOpacity>
        <FormInput label="Holiday Name" value={form.holName || ''} onChangeText={t => setForm({ ...form, holName: t })} placeholder="e.g. Diwali, Republic Day" />
        <View style={s.sheetActions}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setSheet(null)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={doAddHoliday}><Text style={s.confirmText}>Declare Holiday</Text></TouchableOpacity>
        </View>
      </BottomSheet>

      <BottomSheet visible={sheet === 'holidayList'} onClose={() => setSheet(null)} title="Declared Holidays">
        {siteHolidays.length === 0 ? (
          <Text style={s.emptyMsg}>No declared holidays for this site yet.</Text>
        ) : (
          <View style={s.card}>
            {siteHolidays.map((h, i) => (
              <View key={h.id} style={[s.listRow, i < siteHolidays.length - 1 && s.borderB]}>
                <View style={s.holDateBox}>
                  <Text style={s.holDateText}>{formatDisplayDate(h.date)}</Text>
                </View>
                <View style={s.listInfo}>
                  <Text style={s.listName}>{h.name}</Text>
                  <Text style={s.listMeta}>{sites.find(st => st.id === h.siteId)?.name || 'All Sites'}</Text>
                </View>
                <TouchableOpacity onPress={() => deleteHoliday(userId, h.id)} style={s.delBtn}>
                  <Text style={s.delIcon}>X</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </BottomSheet>
      {/* FIX BUG-14: keep calendar mounted last so it overlays bottom sheets on web */}
      <CalendarPicker
        visible={showCal}
        onClose={() => setShowCal(false)}
        onSelect={onCalSelect}
        selected={calTarget === 'holiday' ? form.holDate : form.advDate}
      />
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: COLORS.primary },
  header:         { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 },
  headerLabel:    { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 1.5 },
  headerSite:     { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  scroll:         { paddingHorizontal: 14, paddingTop: 10, backgroundColor: COLORS.gray0 },
  section:        { marginBottom: 20 },
  sectionTitle:   { fontSize: 15, fontWeight: '700', color: COLORS.gray5, marginBottom: 10 },
  card:           { backgroundColor: COLORS.white, borderRadius: 16, paddingHorizontal: 14, elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
  syncCard:       { paddingVertical: 14 },
  syncTitle:      { fontSize: 15, fontWeight: '800', color: COLORS.text, marginTop: 14 },
  syncSub:        { fontSize: 12, color: COLORS.gray4, marginTop: 6 },
  syncMeta:       { fontSize: 12, color: COLORS.gray4, marginTop: 6 },
  syncError:      { fontSize: 12, color: COLORS.red, marginTop: 6 },
  syncActions:    { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 12 },
  emptyMsg:       { paddingVertical: 16, fontSize: 13, color: COLORS.gray4, textAlign: 'center' },
  siteRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 },
  siteDot:        { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.gray2 },
  siteDotActive:  { backgroundColor: COLORS.green },
  siteName:       { fontSize: 15, fontWeight: '600', color: COLORS.text },
  siteCompany:    { fontSize: 12, color: COLORS.gray4, marginTop: 2 },
  activePill:     { backgroundColor: COLORS.greenLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  activePillText: { fontSize: 11, color: COLORS.green, fontWeight: '700' },
  switchBtn:      { borderWidth: 1.5, borderColor: COLORS.gray2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  switchBtnText:  { fontSize: 11, color: COLORS.gray5, fontWeight: '600' },
  borderB:        { borderBottomWidth: 1, borderBottomColor: COLORS.gray1 },
  addRowBtn:      { paddingVertical: 14, alignItems: 'center' },
  addRowBtnText:  { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  addBannerBtn:   { backgroundColor: COLORS.primaryLight, borderRadius: 14, padding: 16, alignItems: 'center' },
  addBannerText:  { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  listRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 },
  listInfo:       { flex: 1 },
  listName:       { fontSize: 14, fontWeight: '700', color: COLORS.text },
  listMeta:       { fontSize: 12, color: COLORS.gray4, marginTop: 2 },
  advAmt:         { fontSize: 15, fontWeight: '800', color: COLORS.red },
  delBtn:         { width: 32, height: 32, borderRadius: 8, backgroundColor: COLORS.redLight, alignItems: 'center', justifyContent: 'center' },
  delIcon:        { fontSize: 13, color: COLORS.red },
  holDateBox:     { backgroundColor: COLORS.primaryLight, borderRadius: 10, padding: 8, minWidth: 46, alignItems: 'center' },
  holDateText:    { fontSize: 12, fontWeight: '800', color: COLORS.primary },
  formLabel:      { fontSize: 13, fontWeight: '600', color: COLORS.gray4, marginBottom: 8 },
  pill:           { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: COLORS.gray2, backgroundColor: COLORS.white },
  pillActive:     { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  pillText:       { fontSize: 13, color: COLORS.gray4, fontWeight: '500' },
  pillTextActive: { color: COLORS.primary, fontWeight: '700' },
  datePicker:     { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.gray2, borderRadius: 12, padding: 14, marginBottom: 14, backgroundColor: COLORS.gray0 },
  datePickerText: { flex: 1, fontSize: 15, color: COLORS.text, fontWeight: '500' },
  datePickerIcon: { fontSize: 20 },
  sheetActions:   { flexDirection: 'row', gap: 10, marginTop: 10 },
  cancelBtn:      { flex: 1, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.gray2, alignItems: 'center', justifyContent: 'center' },
  cancelText:     { fontSize: 15, color: COLORS.gray5, fontWeight: '600' },
  confirmBtn:     { flex: 2, height: 52, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText:    { fontSize: 15, color: '#fff', fontWeight: '700' },
});








