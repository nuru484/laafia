package expo.modules.laafiasms

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat

/**
 * Facility mode only. An idle foreground service: it does no work, but a process
 * with one is the last thing aggressive battery managers stop, so the SMS
 * receiver keeps running on a phone left at the compound.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val n = Alerts.serviceNotification(this)
    if (Build.VERSION.SDK_INT >= 34) startForeground(Alerts.SERVICE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(Alerts.SERVICE_ID, n)
    return START_STICKY
  }

  companion object {
    fun start(ctx: Context): Boolean = try {
      ContextCompat.startForegroundService(ctx, Intent(ctx, KeepAliveService::class.java))
      true
    } catch (e: Exception) {
      // Android 12+ refuses a start from the background; the next foreground launch or boot retries.
      false
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, KeepAliveService::class.java))
    }
  }
}

class BootReceiver : android.content.BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (Store.mode(ctx) == "facility") KeepAliveService.start(ctx)
  }
}
