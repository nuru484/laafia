import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'

/*
 * Push over the internet (Expo's service, on Firebase Cloud Messaging). A build without Firebase configured, or a
 * phone with notifications turned off, simply has no address: everything then runs on SMS and sync as before.
 */

/** This phone's push address, or null. */
export async function pushAddress(): Promise<string | null> {
  try {
    if (!(await Notifications.getPermissionsAsync()).granted) return null
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data
  } catch {
    return null
  }
}

/** Pushes arriving while the app is open still show and sound; the alarm sound comes from the referral channel. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})
