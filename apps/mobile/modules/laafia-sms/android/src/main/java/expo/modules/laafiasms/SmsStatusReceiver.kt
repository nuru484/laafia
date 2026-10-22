package expo.modules.laafiasms

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager

/** Records SENT and DELIVERED results natively, so a result is not lost if the app dies mid-send. */
class SmsStatusReceiver : BroadcastReceiver() {
  companion object {
    const val ACTION_SENT = "org.laafia.SMS_SENT"
    const val ACTION_DELIVERED = "org.laafia.SMS_DELIVERED"
    const val EXTRA_ID = "id"
    const val EXTRA_PARTS = "parts"

    fun errorName(code: Int): String = when (code) {
      SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
      SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
      SmsManager.RESULT_ERROR_NULL_PDU -> "null_pdu"
      SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "generic_failure"
      else -> "error_$code"
    }
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    when (intent.action) {
      ACTION_SENT -> {
        if (resultCode == Activity.RESULT_OK) {
          if (Store.partSent(ctx, id, intent.getIntExtra(EXTRA_PARTS, 1))) Store.queueResult(ctx, id, "sent", null)
        } else {
          Store.clearParts(ctx, id)
          Store.queueResult(ctx, id, "failed", errorName(resultCode))
        }
      }
      ACTION_DELIVERED -> if (resultCode == Activity.RESULT_OK) Store.queueResult(ctx, id, "delivered", null)
      else -> return
    }
    LaafiaSmsModule.poke(LaafiaSmsModule.EVENT_STATUS)
  }
}
