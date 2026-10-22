package expo.modules.laafiasms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Alerts {
  const val REFERRALS = "laafia_referrals"
  const val UPDATES = "laafia_updates"
  const val SERVICE = "laafia_service"
  const val SERVICE_ID = 7001

  private val TYPE_LABEL = mapOf("PW" to "Pregnant woman", "PP" to "Mother after delivery", "NB" to "Newborn", "CH" to "Child")
  private val STATUS_LABEL = mapOf("R" to "received", "A" to "arrived", "T" to "treated", "C" to "closed")

  fun ensureChannels(ctx: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = ctx.getSystemService(NotificationManager::class.java)
    val alarm = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
    nm.createNotificationChannel(NotificationChannel(REFERRALS, "Incoming referrals", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "Rings for an emergency referral sent to this facility"
      setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarm)
      enableVibration(true)
      vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    })
    nm.createNotificationChannel(NotificationChannel(UPDATES, "Referral and transport updates", NotificationManager.IMPORTANCE_HIGH))
    nm.createNotificationChannel(NotificationChannel(SERVICE, "Listening for referrals", NotificationManager.IMPORTANCE_MIN))
  }

  private fun openApp(ctx: Context, requestCode: Int): PendingIntent? {
    val intent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(ctx, requestCode, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun post(ctx: Context, id: Int, n: Notification) {
    // Missing POST_NOTIFICATIONS permission must not crash the receiver; the message is still queued for the app.
    try { NotificationManagerCompat.from(ctx).notify(id, n) } catch (e: SecurityException) { }
  }

  fun referral(ctx: Context, body: String) {
    ensureChannels(ctx)
    val p = body.trim().split("|")
    val urgency = p.getOrNull(5) ?: "?"
    val who = TYPE_LABEL[p.getOrNull(6)] ?: "Client"
    val id = (p.getOrNull(2) + p.getOrNull(3)).hashCode()
    val pi = openApp(ctx, id)
    val n = NotificationCompat.Builder(ctx, REFERRALS)
      .setSmallIcon(android.R.drawable.ic_dialog_alert)
      .setContentTitle(if (urgency == "3") "EMERGENCY referral coming" else "Referral coming (urgency $urgency)")
      .setContentText("$who ${p.getOrNull(4) ?: ""}. Open Laafia to see the assessment and acknowledge.")
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(pi)
      .setFullScreenIntent(pi, true)
      .setAutoCancel(true)
      .build()
    // Urgency 3 keeps ringing until someone opens or dismisses it.
    if (urgency == "3") n.flags = n.flags or Notification.FLAG_INSISTENT
    post(ctx, id, n)
  }

  fun status(ctx: Context, body: String) {
    ensureChannels(ctx)
    val p = body.trim().split("|")
    val id = (p.getOrNull(3) + p.getOrNull(4)).hashCode()
    post(ctx, id, NotificationCompat.Builder(ctx, UPDATES)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Referral ${STATUS_LABEL[p.getOrNull(5)] ?: "updated"}")
      .setContentText("Referral ${p.getOrNull(4) ?: ""} is now ${STATUS_LABEL[p.getOrNull(5)] ?: "updated"} at the facility.")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openApp(ctx, id))
      .setAutoCancel(true)
      .build())
  }

  fun clientMessage(ctx: Context, from: String, body: String) {
    ensureChannels(ctx)
    val id = from.hashCode()
    post(ctx, id, NotificationCompat.Builder(ctx, UPDATES)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Visit request by text")
      .setContentText("$from: ${body.take(80)}")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openApp(ctx, id))
      .setAutoCancel(true)
      .build())
  }

  fun serviceNotification(ctx: Context): Notification {
    ensureChannels(ctx)
    return NotificationCompat.Builder(ctx, SERVICE)
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Laafia is listening for referrals")
      .setContentText("Keep this phone charged and on.")
      .setOngoing(true)
      .setContentIntent(openApp(ctx, SERVICE_ID))
      .build()
  }
}
