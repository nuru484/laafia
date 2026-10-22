package expo.modules.laafiasms

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * App-private native state that must outlive the JavaScript runtime: the mode,
 * the key directory for verification, numbers whose texts are bookings (registered clients),
 * and queues of received messages and send results waiting for JS to consume.
 */
object Store {
  private const val MAX_QUEUE = 500

  private fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("laafia_sms", Context.MODE_PRIVATE)

  fun mode(ctx: Context): String = prefs(ctx).getString("mode", "cho") ?: "cho"
  fun setMode(ctx: Context, mode: String) = prefs(ctx).edit().putString("mode", mode).apply()

  fun keys(ctx: Context): Map<String, String> {
    val json = JSONObject(prefs(ctx).getString("keys", "{}") ?: "{}")
    return json.keys().asSequence().associateWith { json.getString(it) }
  }
  fun setKeys(ctx: Context, keys: Map<String, String>) = prefs(ctx).edit().putString("keys", JSONObject(keys).toString()).apply()

  fun setWatched(ctx: Context, numbers: List<String>) =
    prefs(ctx).edit().putString("watched", JSONArray(numbers.map(::normalize)).toString()).apply()
  fun isWatched(ctx: Context, number: String): Boolean {
    val arr = JSONArray(prefs(ctx).getString("watched", "[]") ?: "[]")
    val n = normalize(number)
    return (0 until arr.length()).any { arr.getString(it) == n }
  }

  /** Same rule as packages/core normalizePhone. */
  fun normalize(raw: String): String {
    val d = raw.filter { it.isDigit() }
    return when {
      d.startsWith("233") && d.length == 12 -> "0" + d.substring(3)
      d.length == 9 -> "0$d"
      else -> d
    }
  }

  @Synchronized
  private fun append(ctx: Context, key: String, item: JSONObject) {
    val arr = JSONArray(prefs(ctx).getString(key, "[]") ?: "[]")
    arr.put(item)
    val trimmed = JSONArray()
    for (i in maxOf(0, arr.length() - MAX_QUEUE) until arr.length()) trimmed.put(arr.get(i))
    prefs(ctx).edit().putString(key, trimmed.toString()).commit()
  }

  @Synchronized
  private fun drain(ctx: Context, key: String): List<Map<String, Any?>> {
    val arr = JSONArray(prefs(ctx).getString(key, "[]") ?: "[]")
    prefs(ctx).edit().putString(key, "[]").commit()
    return (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      o.keys().asSequence().associateWith { k -> if (o.isNull(k)) null else o.get(k) }
    }
  }

  fun queueReceived(ctx: Context, from: String, body: String, at: Long) =
    append(ctx, "inbox", JSONObject().put("from", from).put("body", body).put("receivedAt", at.toDouble()))
  fun drainReceived(ctx: Context) = drain(ctx, "inbox")

  fun queueResult(ctx: Context, id: String, status: String, error: String?) =
    append(ctx, "results", JSONObject().put("id", id).put("status", status).put("error", error ?: JSONObject.NULL).put("at", System.currentTimeMillis().toDouble()))
  fun drainResults(ctx: Context) = drain(ctx, "results")

  /** Multipart bookkeeping: returns true once every part of `id` has reported success. */
  @Synchronized
  fun partSent(ctx: Context, id: String, total: Int): Boolean {
    val p = prefs(ctx)
    val done = p.getInt("parts_$id", 0) + 1
    return if (done >= total) {
      p.edit().remove("parts_$id").commit()
      true
    } else {
      p.edit().putInt("parts_$id", done).commit()
      false
    }
  }
  fun clearParts(ctx: Context, id: String) = prefs(ctx).edit().remove("parts_$id").commit()
}
