package expo.modules.laafiasms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Runs for every incoming SMS, also when the app is closed. Laafia messages, and
 * on a CHO phone texts from registered clients or starting with BOOK, are queued
 * for the app; the alert is raised here so it does not wait for JavaScript.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    val first = parts.firstOrNull() ?: return
    val from = first.originatingAddress ?: return
    val body = parts.joinToString("") { it.messageBody ?: "" }
    val booking = Store.mode(ctx) == "cho" && (Store.isWatched(ctx, from) || body.trim().startsWith("BOOK", ignoreCase = true))
    if (!Verifier.isLaafia(body) && !booking) return

    Store.queueReceived(ctx, from, body, first.timestampMillis)
    val signer = Verifier.verifiedSigner(body, Store.keys(ctx))
    when {
      signer != null && body.trim().startsWith("LFR|") && Store.mode(ctx) == "facility" -> Alerts.referral(ctx, body)
      signer != null && body.trim().startsWith("LFS|") -> Alerts.status(ctx, body)
      booking -> Alerts.clientMessage(ctx, from, body)
    }
    LaafiaSmsModule.poke(LaafiaSmsModule.EVENT_RECEIVED)
  }
}
