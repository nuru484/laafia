package expo.modules.laafiasms

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Native copy of packages/core sign.ts, so the facility alarm only rings for a
 * referral whose signature verifies, even when JavaScript is not running.
 */
object Verifier {
  private const val B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

  /** Shared with packages/core tests: sign(key 0x11 x 32, "LFS|1|F001|D001|AEBAGBAF|R|") == "7A4XD3IA". */
  private const val VECTOR_KEY = "1111111111111111111111111111111111111111111111111111111111111111"
  private const val VECTOR_CANONICAL = "LFS|1|F001|D001|AEBAGBAF|R|"
  private const val VECTOR_SIG = "7A4XD3IA"

  fun base32(bytes: ByteArray): String {
    val out = StringBuilder()
    var bits = 0
    var value = 0
    for (b in bytes) {
      value = (value shl 8) or (b.toInt() and 0xff)
      bits += 8
      while (bits >= 5) {
        out.append(B32[(value ushr (bits - 5)) and 31])
        bits -= 5
      }
    }
    if (bits > 0) out.append(B32[(value shl (5 - bits)) and 31])
    return out.toString()
  }

  private fun hexToBytes(hex: String): ByteArray =
    ByteArray(hex.length / 2) { i -> hex.substring(i * 2, i * 2 + 2).toInt(16).toByte() }

  fun sign(keyHex: String, canonical: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(hexToBytes(keyHex), "HmacSHA256"))
    return base32(mac.doFinal(canonical.toByteArray(Charsets.UTF_8))).substring(0, 8)
  }

  fun isLaafia(body: String): Boolean {
    val t = body.trim()
    return t.startsWith("LFR|") || t.startsWith("LFS|")
  }

  /** The signer device id when the body is a Laafia message signed by a known key, else null. */
  fun verifiedSigner(body: String, keys: Map<String, String>): String? {
    val text = body.trim()
    if (!isLaafia(text)) return null
    val parts = text.split("|")
    if (parts.size < 4) return null
    val sig = parts.last()
    if (sig.length != 8) return null
    val key = keys[parts[2]] ?: return null
    val canonical = text.substring(0, text.length - sig.length)
    val expected = try { sign(key, canonical) } catch (e: Exception) { return null }
    return if (MessageDigest.isEqual(expected.toByteArray(), sig.toByteArray())) parts[2] else null
  }

  fun selfTest(): Boolean = sign(VECTOR_KEY, VECTOR_CANONICAL) == VECTOR_SIG
}
