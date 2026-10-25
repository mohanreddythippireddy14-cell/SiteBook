import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export const initNotifications = () => {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
};

export const scheduleDailyAttendanceReminder = async () => {
  try {
    if (!Device.isDevice) return;
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📋 Mark Attendance',
        body: "Don't forget to mark today's attendance for your workers!",
        sound: true,
      },
      trigger: { hour: 10, minute: 0, repeats: true },
    });
  } catch (e) {
    console.warn('Notification scheduling error:', e);
  }
};
