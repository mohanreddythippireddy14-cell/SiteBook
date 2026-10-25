import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { AttendanceScreen } from '../screens/AttendanceScreen';
import { WorkersScreen }   from '../screens/WorkersScreen';
import { ReportScreen }    from '../screens/ReportScreen';
import { MoreScreen }      from '../screens/MoreScreen';
import { useApp } from '../context/AppContext';
import { COLORS } from '../utils/helpers';

const Tab = createBottomTabNavigator();

const TabIcon = ({ emoji, label, focused }) => (
  <View style={{ alignItems: 'center', gap: 2, paddingTop: 4 }}>
    <Text style={{ fontSize: 22 }}>{emoji}</Text>
    <Text style={{
      fontSize: 10,
      color: focused ? COLORS.primary : COLORS.gray4,
      fontWeight: focused ? '700' : '500',
    }}>
      {label}
    </Text>
  </View>
);

const ScreenShell = ({ children }) => {
  const { dataError } = useApp();
  return (
    <View style={{ flex: 1 }}>
      {dataError ? (
        <View style={{ backgroundColor: COLORS.redLight, paddingHorizontal: 14, paddingVertical: 8 }}>
          <Text style={{ color: COLORS.red, fontSize: 12, fontWeight: '700' }}>
            Data sync issue: {dataError.message}
          </Text>
        </View>
      ) : null}
      {children}
    </View>
  );
};

export const MainTabs = ({ userId }) => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarShowLabel: false,
      tabBarStyle: {
        height: 68,
        borderTopWidth: 0.5,
        borderTopColor: COLORS.gray2,
        backgroundColor: COLORS.white,
        elevation: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
    }}
  >
    <Tab.Screen
      name="Attendance"
      options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📋" label="Attendance" focused={focused} /> }}
    >
      {() => <ScreenShell><AttendanceScreen userId={userId} /></ScreenShell>}
    </Tab.Screen>
    <Tab.Screen
      name="Workers"
      options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="👷" label="Workers" focused={focused} /> }}
    >
      {() => <ScreenShell><WorkersScreen userId={userId} /></ScreenShell>}
    </Tab.Screen>
    <Tab.Screen
      name="Report"
      options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📊" label="Report" focused={focused} /> }}
    >
      {() => <ScreenShell><ReportScreen userId={userId} /></ScreenShell>}
    </Tab.Screen>
    <Tab.Screen
      name="More"
      options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" label="More" focused={focused} /> }}
    >
      {() => <ScreenShell><MoreScreen userId={userId} /></ScreenShell>}
    </Tab.Screen>
  </Tab.Navigator>
);
