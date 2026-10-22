import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import { PermissionsAndroid, type Permission } from 'react-native'
import { LaafiaSms, type PowerStatus } from 'laafia-sms'

const P = PermissionsAndroid.PERMISSIONS
const SMS: Permission[] = [P.SEND_SMS, P.RECEIVE_SMS, P.READ_SMS, P.READ_PHONE_STATE]

export type Checks = {
  sms: boolean
  notifications: boolean
  location: boolean
  power: PowerStatus
}

export async function readChecks(): Promise<Checks> {
  const sms = (await Promise.all(SMS.map((p) => PermissionsAndroid.check(p)))).every(Boolean)
  const notifications = (await Notifications.getPermissionsAsync()).granted
  const location = (await Location.getForegroundPermissionsAsync()).granted
  return { sms, notifications, location, power: LaafiaSms.powerStatus() }
}

export async function requestSms(): Promise<boolean> {
  const r = await PermissionsAndroid.requestMultiple(SMS)
  return SMS.every((p) => r[p] === PermissionsAndroid.RESULTS.GRANTED)
}
export async function requestNotifications(): Promise<boolean> {
  return (await Notifications.requestPermissionsAsync()).granted
}
export async function requestLocation(): Promise<boolean> {
  return (await Location.requestForegroundPermissionsAsync()).granted
}
