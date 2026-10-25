import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Vibration, Alert, ScrollView, Image,
} from 'react-native';
import { COLORS } from '../utils/helpers';
import { useGoogleAuthRequest, completeGoogleSignIn } from '../services/googleAuth';
import { setDriveAuth, setDriveSyncEnabled, getDriveAuth, queueDriveSync } from '../services/driveSync';
import { getSecureItem, setSecureItem } from '../services/secureStorage';
import { hashPin, isHashedPin, verifyPin } from '../utils/pinHash';

const PIN_KEY = 'sitebook_pin';

export const PinScreen = ({ onUnlock, dataMismatch, oldUid, newUid }) => {
  const [pin,      setPin]      = useState('');
  const [savedPin, setSavedPin] = useState(null);
  const [mode,     setMode]     = useState('loading');
  const [tempPin,  setTempPin]  = useState('');
  const [error,    setError]    = useState('');
  const [driveConnected, setDriveConnected] = useState(false);
  const [request, response, promptAsync] = useGoogleAuthRequest();

  useEffect(() => {
    // FIX P2S2: Read the app PIN from SecureStore instead of AsyncStorage.
    getSecureItem(PIN_KEY)
      .then(p => {
        if (p) { setSavedPin(p); setMode('login'); }
        else setMode('setup1');
      })
      .catch(() => setMode('setup1'));
  }, []);

  useEffect(() => {
    const load = async () => {
      const auth = await getDriveAuth();
      setDriveConnected(!!auth?.accessToken);
    };
    load();
  }, []);

  // FIX BUG-08: show warning if UID changed (data loss scenario)
  useEffect(() => {
    if (dataMismatch && mode === 'login') {
      Alert.alert(
        '⚠️ Data Warning',
        'It looks like the app was reinstalled or app data was cleared. Your previous attendance records may be under a different account.\n\nPlease contact support or use a fresh start.',
        [
          { text: 'Continue Anyway', style: 'default' },
        ]
      );
    }
  }, [dataMismatch, mode]);

  useEffect(() => {
    if (pin.length === 4) setTimeout(() => handleSubmit(pin), 120);
  }, [pin]);

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
        await queueDriveSync(user?.uid || newUid, 'connect');
        setDriveConnected(true);
        Alert.alert(
          'Connected',
          tokens.refreshToken
            ? 'Google Drive sync is now enabled.'
            : 'Google Drive sync is enabled for this session. If Google expires access later, reconnect Drive from Settings.'
        );
      } catch (e) {
        Alert.alert('Google Sign-In Failed', e?.message || 'Please try again.');
      }
    };
    run();
  }, [response]);

  const handleSubmit = async (entered) => {
    if (mode === 'login') {
      if (verifyPin(entered, savedPin)) {
        if (!isHashedPin(savedPin)) {
          const hashed = hashPin(entered);
          await setSecureItem(PIN_KEY, hashed);
          setSavedPin(hashed);
        }
        onUnlock();
      } else {
        setError('Wrong PIN. Try again.');
        Vibration.vibrate(300);
        setPin('');
        setTimeout(() => setError(''), 2000);
      }
    } else if (mode === 'setup1') {
      setTempPin(entered);
      setMode('setup2');
      setPin('');
    } else if (mode === 'setup2') {
      if (entered === tempPin) {
        // Store a salted hash, not the raw PIN.
        const hashed = hashPin(entered);
        await setSecureItem(PIN_KEY, hashed);
        setSavedPin(hashed);
        onUnlock();
      } else {
        setError('PINs did not match. Try again.');
        Vibration.vibrate(300);
        setMode('setup1');
        setPin('');
        setTempPin('');
        setTimeout(() => setError(''), 2500);
      }
    }
  };

  const press = (d) => { if (pin.length < 4) setPin(p => p + d); };
  const del   = () => setPin(p => p.slice(0, -1));

  const connectDrive = async () => {
    try {
      await promptAsync();
    } catch (e) {
      Alert.alert('Google Sign-In Failed', e?.message || 'Please try again.');
    }
  };

  const subtitle =
    mode === 'login'  ? 'Enter your PIN to continue' :
    mode === 'setup1' ? 'Create a 4-digit PIN' :
    mode === 'setup2' ? 'Confirm your PIN' : '';

  const hint =
    mode === 'setup1' ? 'You will use this PIN every time you open SiteBook' :
    mode === 'setup2' ? 'Enter the same PIN again to confirm' : '';

  if (mode === 'loading') return <View style={s.container} />;

  return (
    <View style={s.container}>
      <View style={s.logoArea}>
        <View style={s.logoBox}>
          <Image source={require('../../assets/icon.png')} style={s.logoImg} />
        </View>
        <Text style={s.logoText}>SiteBook</Text>
        <Text style={s.logoSub}>Contractor Attendance Manager</Text>
      </View>

      <Text style={s.subtitle}>{subtitle}</Text>

      <View style={s.dots}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[s.dot, i < pin.length && s.dotFilled]} />
        ))}
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {hint && !error ? <Text style={s.hint}>{hint}</Text> : null}

      {!driveConnected ? (
        <TouchableOpacity
          style={s.cloudBtn}
          onPress={connectDrive}
          disabled={!request}
        >
          <Text style={s.cloudBtnText}>Connect Google Drive to Continue</Text>
        </TouchableOpacity>
      ) : (
        <View style={s.cloudOk}>
          <Text style={s.cloudOkText}>Google Drive Connected</Text>
        </View>
      )}

      <View style={[s.pad, !driveConnected && s.padDisabled]}>
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <TouchableOpacity
            key={i}
            style={[s.key, k === '' && s.keyEmpty]}
            onPress={() => k === '⌫' ? del() : k !== '' ? press(k) : null}
            disabled={k === ''}
          >
            <Text style={[s.keyText, k === '⌫' && s.keyDel]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  logoArea:  { alignItems: 'center', marginBottom: 36 },
  logoBox:   { width: 72, height: 72, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoImg:   { width: 46, height: 46, resizeMode: 'contain' },
  logoText:  { fontSize: 30, fontWeight: '900', color: '#fff', letterSpacing: -1 },
  logoSub:   { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
  subtitle:  { fontSize: 16, color: 'rgba(255,255,255,0.9)', marginBottom: 28, fontWeight: '500' },
  dots:      { flexDirection: 'row', gap: 16, marginBottom: 14 },
  dot:       { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.3)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  dotFilled: { backgroundColor: '#fff', borderColor: '#fff' },
  error:     { fontSize: 14, color: '#FCA5A5', marginBottom: 8, fontWeight: '500' },
  hint:      { fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginBottom: 8, paddingHorizontal: 20 },
  cloudBtn:  { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, marginTop: 6 },
  cloudBtnText: { fontSize: 13, color: '#fff', fontWeight: '700' },
  cloudOk:   { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 16, marginTop: 6 },
  cloudOkText: { fontSize: 13, color: '#EAF0FF', fontWeight: '600' },
  pad:       { flexDirection: 'row', flexWrap: 'wrap', width: 288, gap: 12, marginTop: 20 },
  padDisabled: { opacity: 0.5 },
  key:       { width: 84, height: 76, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  keyEmpty:  { backgroundColor: 'transparent' },
  keyText:   { fontSize: 28, fontWeight: '400', color: '#fff' },
  keyDel:    { fontSize: 22 },
});
