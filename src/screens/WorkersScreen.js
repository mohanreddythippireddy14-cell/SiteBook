import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Alert,
} from 'react-native';
import { useApp } from '../context/AppContext';
import { addSiteWithWorker, addSiteAndUpdateWorker, addWorker, updateWorker, deleteWorker } from '../services/firestore';
import { Avatar } from '../components/Avatar';
import { BottomSheet } from '../components/BottomSheet';
import { FormInput } from '../components/FormInput';
import { COLORS, sanitizeWage } from '../utils/helpers';

const NEW_SITE_ID = '__new__';

export const WorkersScreen = ({ userId }) => {
  const { siteWorkers, sites, workers, currentSite, setCurrentSite } = useApp();
  const [sheet, setSheet] = useState(null);
  const [form, setForm] = useState({});

  const roleOptions = Array.from(new Set(
    workers.map((w) => (w.role || '').trim()).filter(Boolean)
  ));

  const updateForm = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const openAdd = () => {
    setForm({
      name: '',
      role: '',
      customRole: '',
      customRoleEnabled: false,
      dailyWage: '',
      otRate: '',
      siteId: currentSite?.id || sites[0]?.id || NEW_SITE_ID,
      siteName: '',
      company: '',
    });
    setSheet('add');
  };

  const openEdit = (worker) => {
    const useCustomRole = !!(worker.role && !roleOptions.includes(worker.role));
    setForm({
      name: worker.name,
      role: useCustomRole ? '' : (worker.role || ''),
      customRole: useCustomRole ? worker.role : '',
      customRoleEnabled: useCustomRole,
      dailyWage: String(worker.dailyWage ?? ''),
      otRate: String(worker.otRate ?? ''),
      siteId: worker.siteId || sites[0]?.id || NEW_SITE_ID,
      siteName: '',
      company: '',
      editId: worker.id,
    });
    setSheet('edit');
  };

  const removeWorker = (worker) => {
    Alert.alert('Remove Worker', `Remove ${worker.name}?\n\nThis will also delete all their attendance records and advances.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => deleteWorker(userId, worker.id) },
    ]);
  };

  const saveWorker = async () => {
    if (!form.name?.trim()) return Alert.alert('Error', 'Please enter the worker name');

    const wage = parseFloat(form.dailyWage);
    const otRate = parseFloat(form.otRate);
    if (form.dailyWage && (isNaN(wage) || wage < 0)) {
      return Alert.alert('Invalid Wage', 'Daily wage must be a positive number (e.g. 500)');
    }
    if (form.otRate && (isNaN(otRate) || otRate < 0)) {
      return Alert.alert('Invalid OT Rate', 'OT rate must be a positive number (e.g. 80)');
    }

    const finalRole = form.customRoleEnabled
      ? form.customRole?.trim() || ''
      : form.role?.trim() || '';

    const data = {
      name: form.name.trim(),
      role: finalRole,
      dailyWage: sanitizeWage(form.dailyWage),
      otRate: sanitizeWage(form.otRate),
    };

    let finalSiteId = form.siteId;
    if (!finalSiteId || finalSiteId === NEW_SITE_ID) {
      if (!form.siteName?.trim()) {
        return Alert.alert('Error', 'Please enter a site name for this worker');
      }
      const siteData = {
        name: form.siteName.trim(),
        company: form.company?.trim() || '',
      };
      if (sheet === 'add') {
        try {
          // FIX P0M3: Batch new site plus first worker so a failed worker write cannot leave an empty site.
          const created = await addSiteWithWorker(userId, siteData, data);
          setCurrentSite(created.site);
          setSheet(null);
          return;
        } catch (e) {
          return Alert.alert('Error', e?.message || 'Could not save worker. Please try again.');
        }
      }
      if (sheet === 'edit') {
        try {
          const created = await addSiteAndUpdateWorker(userId, siteData, form.editId, data);
          setCurrentSite(created.site);
          setSheet(null);
          return;
        } catch (e) {
          return Alert.alert('Error', e?.message || 'Could not save worker. Please try again.');
        }
      }
      return Alert.alert('Error', 'Could not determine how to save this worker.');
    }

    if (!finalSiteId) {
      return Alert.alert('Error', 'Please select a site for this worker');
    }

    const workerData = { ...data, siteId: finalSiteId };
    if (sheet === 'add') await addWorker(userId, workerData);
    else await updateWorker(userId, form.editId, workerData);
    setSheet(null);
  };

  const customRoleSelected = !!form.customRoleEnabled || (!!form.role && !roleOptions.includes(form.role));
  const addingNewSite = !form.siteId || form.siteId === NEW_SITE_ID;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      <View style={s.header}>
        <View>
          <Text style={s.headerLabel}>WORKERS</Text>
          <Text style={s.headerSite}>{currentSite?.name || 'No site selected'}</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={openAdd}>
          <Text style={s.addBtnText}>+ Add Worker</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {siteWorkers.length > 0 && (
          <View style={s.statsRow}>
            <View style={s.statBox}>
              <Text style={s.statN}>{siteWorkers.length}</Text>
              <Text style={s.statL}>Total Workers</Text>
            </View>
            <View style={s.statBox}>
              <Text style={s.statN}>
                Rs {Math.round(siteWorkers.reduce((sum, worker) => sum + sanitizeWage(worker.dailyWage), 0) / Math.max(siteWorkers.length, 1))}
              </Text>
              <Text style={s.statL}>Avg Wage/Day</Text>
            </View>
          </View>
        )}

        {siteWorkers.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>Worker</Text>
            <Text style={s.emptyTitle}>No workers yet</Text>
            <Text style={s.emptySub}>Tap "Add Worker" to get started</Text>
            <TouchableOpacity style={s.bigAdd} onPress={openAdd}>
              <Text style={s.bigAddText}>+ Add First Worker</Text>
            </TouchableOpacity>
          </View>
        ) : siteWorkers.map((worker) => (
          <View key={worker.id} style={s.card}>
            <Avatar name={worker.name} size={50} />
            <View style={s.info}>
              <Text style={s.name}>{worker.name || '-'}</Text>
              <View style={s.rolePill}>
                <Text style={s.roleText}>{worker.role || 'Worker'}</Text>
              </View>
              <Text style={s.meta}>Rs {worker.dailyWage}/day | OT Rs {worker.otRate}/hr</Text>
            </View>
            <View style={s.actions}>
              <TouchableOpacity style={s.editBtn} onPress={() => openEdit(worker)}>
                <Text style={s.editIcon}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.delBtn} onPress={() => removeWorker(worker)}>
                <Text style={s.delIcon}>Del</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        <View style={{ height: 30 }} />
      </ScrollView>

      <BottomSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet === 'add' ? 'Add New Worker' : 'Edit Worker'}
      >
        <FormInput
          label="Full Name *"
          value={form.name || ''}
          onChangeText={(text) => updateForm({ name: text })}
          placeholder="e.g. Ramesh Kumar"
        />

        <Text style={s.formLabel}>Role / Job</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroller}>
          <View style={s.pillRow}>
            {roleOptions.map((role) => (
              <TouchableOpacity
                key={role}
                style={[s.pill, form.role === role && !customRoleSelected && s.pillActive]}
                onPress={() => updateForm({ role, customRole: '', customRoleEnabled: false })}
              >
                <Text style={[s.pillText, form.role === role && !customRoleSelected && s.pillTextActive]}>{role}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[s.pill, customRoleSelected && s.pillActive]}
              onPress={() => updateForm({ role: '', customRoleEnabled: true })}
            >
              <Text style={[s.pillText, customRoleSelected && s.pillTextActive]}>+ New Role</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {customRoleSelected ? (
          <FormInput
            label="Custom Role"
            value={form.customRole || ''}
            onChangeText={(text) => updateForm({ customRole: text, customRoleEnabled: true })}
            placeholder="e.g. Bar Bender"
          />
        ) : null}

        <View style={s.row}>
          <FormInput
            label="Daily Wage (Rs)"
            value={form.dailyWage || ''}
            onChangeText={(text) => updateForm({ dailyWage: text })}
            keyboardType="numeric"
            placeholder="500"
            style={s.halfInputLeft}
          />
          <FormInput
            label="OT Rate (Rs/hr)"
            value={form.otRate || ''}
            onChangeText={(text) => updateForm({ otRate: text })}
            keyboardType="numeric"
            placeholder="80"
            style={s.halfInputRight}
          />
        </View>

        <Text style={s.formLabel}>Assigned Site *</Text>
        <View style={s.siteWrap}>
          {sites.map((site) => (
            <TouchableOpacity
              key={site.id}
              style={[s.pill, form.siteId === site.id && s.pillActive]}
              onPress={() => updateForm({ siteId: site.id })}
            >
              <Text style={[s.pillText, form.siteId === site.id && s.pillTextActive]}>{site.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={[s.pill, addingNewSite && s.pillActive]}
            onPress={() => updateForm({ siteId: NEW_SITE_ID })}
          >
            <Text style={[s.pillText, addingNewSite && s.pillTextActive]}>+ Add New Site</Text>
          </TouchableOpacity>
        </View>

        {addingNewSite ? (
          <View>
            <FormInput
              label="New Site Name *"
              value={form.siteName || ''}
              onChangeText={(text) => updateForm({ siteName: text })}
              placeholder="e.g. Site C, Malad Project"
            />
            <FormInput
              label="Company Name (optional)"
              value={form.company || ''}
              onChangeText={(text) => updateForm({ company: text })}
              placeholder="e.g. Sharma Builders"
            />
          </View>
        ) : null}

        <View style={s.sheetActions}>
          <TouchableOpacity style={s.cancelBtn} onPress={() => setSheet(null)}>
            <Text style={s.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.confirmBtn} onPress={saveWorker}>
            <Text style={s.confirmText}>{sheet === 'add' ? 'Add Worker' : 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.primary },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.65)', letterSpacing: 1.5 },
  headerSite: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 2 },
  addBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  addBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  scroll: { paddingHorizontal: 14, paddingTop: 10, backgroundColor: COLORS.gray0 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statBox: { flex: 1, backgroundColor: COLORS.white, borderRadius: 14, padding: 14, alignItems: 'center', elevation: 2 },
  statN: { fontSize: 22, fontWeight: '800', color: COLORS.primary },
  statL: { fontSize: 11, color: COLORS.gray4, marginTop: 2, fontWeight: '500' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: { fontSize: 20, marginBottom: 14, color: COLORS.gray4 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: COLORS.gray5, marginBottom: 6 },
  emptySub: { fontSize: 14, color: COLORS.gray4, marginBottom: 24 },
  bigAdd: { backgroundColor: COLORS.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  bigAddText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  rolePill: { backgroundColor: COLORS.primaryLight, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  roleText: { fontSize: 11, color: COLORS.primary, fontWeight: '700' },
  meta: { fontSize: 12, color: COLORS.gray4 },
  actions: { flexDirection: 'row', gap: 8 },
  editBtn: { minWidth: 48, height: 38, borderRadius: 10, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  editIcon: { fontSize: 12, color: COLORS.primary, fontWeight: '700' },
  delBtn: { minWidth: 48, height: 38, borderRadius: 10, backgroundColor: COLORS.redLight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  delIcon: { fontSize: 12, color: COLORS.red, fontWeight: '700' },
  formLabel: { fontSize: 13, fontWeight: '600', color: COLORS.gray4, marginBottom: 8 },
  pillScroller: { marginBottom: 14 },
  pillRow: { flexDirection: 'row', gap: 8 },
  siteWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: COLORS.gray2, backgroundColor: COLORS.white },
  pillActive: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary },
  pillText: { fontSize: 13, color: COLORS.gray4, fontWeight: '500' },
  pillTextActive: { color: COLORS.primary, fontWeight: '700' },
  row: { flexDirection: 'row' },
  halfInputLeft: { flex: 1, marginRight: 8 },
  halfInputRight: { flex: 1 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, height: 52, borderRadius: 14, borderWidth: 1.5, borderColor: COLORS.gray2, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 15, color: COLORS.gray5, fontWeight: '600' },
  confirmBtn: { flex: 2, height: 52, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
