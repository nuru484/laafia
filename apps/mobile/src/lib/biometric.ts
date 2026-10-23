import { requireOptionalNativeModule } from 'expo'
import * as SecureStore from 'expo-secure-store'

/*
 * Fingerprint or face unlock in place of the PIN. The PIN stays the gate it always was (spec 18.2): biometrics only
 * stand in for typing it, and the PIN works whenever they fail or are turned off. A development build made before
 * this module was added has no native side, so it simply never offers biometrics.
 */

const inBuild = requireOptionalNativeModule('ExpoLocalAuthentication') !== null
const OFF_ITEM = 'laafia_biometric_off'

export async function biometricAvailable(): Promise<boolean> {
  if (!inBuild) return false
  const LA = await import('expo-local-authentication')
  return (await LA.hasHardwareAsync()) && (await LA.isEnrolledAsync())
}

export async function biometricOn(): Promise<boolean> {
  return (await SecureStore.getItemAsync(OFF_ITEM)) !== '1' && (await biometricAvailable())
}

export async function setBiometricOn(on: boolean): Promise<void> {
  if (on) await SecureStore.deleteItemAsync(OFF_ITEM)
  else await SecureStore.setItemAsync(OFF_ITEM, '1')
}

export async function unlockWithBiometrics(): Promise<boolean> {
  const LA = await import('expo-local-authentication')
  const r = await LA.authenticateAsync({ promptMessage: 'Unlock Laafia', cancelLabel: 'Use PIN', disableDeviceFallback: true })
  return r.success
}
