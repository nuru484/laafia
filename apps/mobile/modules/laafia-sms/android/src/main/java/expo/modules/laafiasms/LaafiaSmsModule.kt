package expo.modules.laafiasms

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LaafiaSmsModule : Module() {
  companion object {
    const val EVENT_RECEIVED = "onSmsReceived"
    const val EVENT_STATUS = "onSmsStatus"

    @Volatile private var instance: LaafiaSmsModule? = null

    /** Tells live JavaScript to drain a native queue. If JS is not running, the queue waits for the next launch. */
    fun poke(event: String) {
      try { instance?.sendEvent(event, mapOf<String, Any?>()) } catch (e: Exception) { }
    }

    private val AUTOSTART = listOf(
      ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
      ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
      ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"),
    )
  }

  private val ctx: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun smsManager(subscriptionId: Int?): SmsManager =
    if (Build.VERSION.SDK_INT >= 31) {
      val base = ctx.getSystemService(SmsManager::class.java)
      if (subscriptionId != null) base.createForSubscriptionId(subscriptionId) else base
    } else {
      @Suppress("DEPRECATION")
      if (subscriptionId != null) SmsManager.getSmsManagerForSubscriptionId(subscriptionId) else SmsManager.getDefault()
    }

  private fun statusIntent(action: String, id: String, part: Int, parts: Int): PendingIntent {
    val intent = Intent(ctx, SmsStatusReceiver::class.java)
      .setAction(action)
      .setData(Uri.parse("laafia-sms://$id/$part"))
      .putExtra(SmsStatusReceiver.EXTRA_ID, id)
      .putExtra(SmsStatusReceiver.EXTRA_PARTS, parts)
    return PendingIntent.getBroadcast(ctx, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun startSettings(intent: Intent): Boolean = try {
    ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (e: Exception) {
    false
  }

  override fun definition() = ModuleDefinition {
    Name("LaafiaSms")
    Events(EVENT_RECEIVED, EVENT_STATUS)

    OnCreate {
      instance = this@LaafiaSmsModule
      appContext.reactContext?.let { Alerts.ensureChannels(it) }
    }
    OnDestroy {
      if (instance === this@LaafiaSmsModule) instance = null
    }

    Function("setMode") { mode: String ->
      Store.setMode(ctx, mode)
      if (mode == "facility") KeepAliveService.start(ctx) else { KeepAliveService.stop(ctx); true }
    }

    Function("setKeys") { keys: Map<String, String> -> Store.setKeys(ctx, keys) }
    Function("setWatchedNumbers") { numbers: List<String> -> Store.setWatched(ctx, numbers) }

    Function("getSims") {
      try {
        val sm = ctx.getSystemService(SubscriptionManager::class.java)
        (sm.activeSubscriptionInfoList ?: emptyList()).map {
          mapOf("subscriptionId" to it.subscriptionId, "slot" to it.simSlotIndex, "carrier" to it.carrierName?.toString())
        }
      } catch (e: SecurityException) {
        emptyList<Map<String, Any?>>()
      }
    }

    /** Returns the number of segments handed to the radio. Results arrive later through drainResults. */
    Function("send") { to: String, body: String, id: String, subscriptionId: Int? ->
      val manager = smsManager(subscriptionId)
      val parts = manager.divideMessage(body)
      if (parts.size <= 1) {
        manager.sendTextMessage(to, null, body, statusIntent(SmsStatusReceiver.ACTION_SENT, id, 0, 1), statusIntent(SmsStatusReceiver.ACTION_DELIVERED, id, 0, 1))
      } else {
        val sent = ArrayList((0 until parts.size).map { statusIntent(SmsStatusReceiver.ACTION_SENT, id, it, parts.size) })
        // One delivery report is enough to know the message reached the handset.
        val delivered = ArrayList((0 until parts.size).map { if (it == parts.size - 1) statusIntent(SmsStatusReceiver.ACTION_DELIVERED, id, it, parts.size) else null })
        manager.sendMultipartTextMessage(to, null, parts, sent, delivered)
      }
      parts.size
    }

    Function("drainReceived") { Store.drainReceived(ctx) }
    Function("drainResults") { Store.drainResults(ctx) }

    /** Catch-up for messages that arrived while the app was force-stopped and the receiver could not run. */
    AsyncFunction("readInbox") { sinceMs: Double ->
      val out = mutableListOf<Map<String, Any?>>()
      ctx.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
        "${Telephony.Sms.DATE} > ?",
        arrayOf(sinceMs.toLong().toString()),
        "${Telephony.Sms.DATE} ASC",
      )?.use { c ->
        while (c.moveToNext() && out.size < 500) {
          out.add(mapOf("from" to c.getString(0), "body" to c.getString(1), "receivedAt" to c.getLong(2).toDouble()))
        }
      }
      out
    }

    Function("powerStatus") {
      val pm = ctx.getSystemService(PowerManager::class.java)
      val nm = ctx.getSystemService(NotificationManager::class.java)
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "sdk" to Build.VERSION.SDK_INT,
        "ignoringBatteryOptimizations" to pm.isIgnoringBatteryOptimizations(ctx.packageName),
        "canUseFullScreenIntent" to (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()),
        "notificationsEnabled" to nm.areNotificationsEnabled(),
        "verifierOk" to Verifier.selfTest(),
      )
    }

    Function("requestIgnoreBatteryOptimizations") {
      startSettings(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")))
    }

    Function("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= 34) startSettings(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${ctx.packageName}")))
      else true
    }

    /** Opens the maker's autostart or app-sleep screen; falls back to the app's own settings page. */
    Function("openAutostartSettings") {
      for (component in AUTOSTART) {
        if (startSettings(Intent().setComponent(component))) return@Function component.packageName
      }
      startSettings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}")))
      "app_settings"
    }
  }
}
