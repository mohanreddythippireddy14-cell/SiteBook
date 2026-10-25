import 'react-native-gesture-handler';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider }    from 'react-native-safe-area-context';
import { View, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { AppProvider }    from './src/context/AppContext';
import { MainTabs }       from './src/navigation/MainTabs';
import { PinScreen }      from './src/screens/PinScreen';
import { initAuth }       from './src/services/auth';
import { COLORS } from './src/utils/helpers';

export default function App() {
  const [userId,       setUserId]       = useState(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [unlocked,     setUnlocked]     = useState(false);
  const [dataMismatch, setDataMismatch] = useState(false);
  const [oldUid,       setOldUid]       = useState(null);
  const [newUid,       setNewUid]       = useState(null);

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  useEffect(() => {
    try {
      const { initNotifications } = require('./src/services/notifications');
      initNotifications();
    } catch (e) {
      // FIX P5L4: Use console.warn so notification init failures appear in crash-reporting tools.
      console.warn('Notification init error:', e);
    }
  }, []);

  useEffect(() => {
    // FIX BUG-08: initAuth detects UID changes after reinstall
    const unsub = initAuth(
      (user) => {
        setUserId(user.uid);
        setAuthLoading(false);
      },
      (errorType, savedUid, currentUid) => {
        if (errorType === 'DATA_MISMATCH') {
          setDataMismatch(true);
          setOldUid(savedUid);
          setNewUid(currentUid);
          setUserId(currentUid); // still proceed with new UID
        } else {
          Alert.alert('Connection Error', 'Could not connect to server. Please check your internet connection and try again.');
        }
        setAuthLoading(false);
      }
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    try {
      const { scheduleDailyAttendanceReminder } = require('./src/services/notifications');
      scheduleDailyAttendanceReminder();
    } catch (e) {
      // FIX P5L4: Use console.warn so scheduling import failures appear in crash-reporting tools.
      console.warn('Notification scheduling import error:', e);
    }
  }, [unlocked]);

  if (authLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  if (!unlocked) {
    return (
      <PinScreen
        onUnlock={() => setUnlocked(true)}
        dataMismatch={dataMismatch}
        oldUid={oldUid}
        newUid={newUid}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <AppProvider userId={userId}>
        <NavigationContainer>
          <MainTabs userId={userId} />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },
});
