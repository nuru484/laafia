/** The API URL comes from the environment: .env locally (see .env.example), eas.json per build profile. */

export default () => ({
  name: 'Laafia',
  slug: 'laafia',
  owner: 'manuru',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'laafia',
  userInterfaceStyle: 'light',
  android: {
    package: 'org.laafia.app',
    adaptiveIcon: {
      backgroundColor: '#FFFFFF',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    /**
     * Requested by code in this app: SMS send/receive/read (modules/laafia-sms),
     * phone state (choosing the SIM), fine location (house GPS),
     * notifications
     * (referral alarms), internet and network state (sync).
     */
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE',
    ],
    blockedPermissions: ['android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#FFFFFF', image: './assets/images/splash-icon.png', imageWidth: 96 }],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-location', { locationWhenInUsePermission: 'Laafia records where each house is so the visit route can be planned.' }],
    'expo-notifications',
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 24,
          // Old and low-cost phones in the field are ARM; dropping x86 roughly halves the APK.
          buildArchs: ['armeabi-v7a', 'arm64-v8a'],
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: { eas: { projectId: '26f46790-c99e-425f-b8ab-cb6fbf098a52' } },
})
