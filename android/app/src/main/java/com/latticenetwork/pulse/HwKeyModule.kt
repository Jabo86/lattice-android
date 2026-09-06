package com.latticenetwork.pulse

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// BLINDATURA HARDWARE — v2.5.2
//
// IL PROBLEMA CHE RISOLVE, in una riga: fino alla v2.5.1 chi estraeva i dati dal telefono
// poteva provare i PIN sul PROPRIO computer, quanti ne voleva, e il costo dipendeva solo
// dalla lunghezza del PIN (6 cifre = 1,5 ore con 64 core).
//
// COME LO RISOLVE: si genera una chiave AES-256 DENTRO il chip di sicurezza (StrongBox se
// c'e', altrimenti l'ambiente protetto TEE). Quella chiave NON ESCE MAI dal chip: non
// esiste un'API per esportarla, nemmeno per noi, nemmeno con il telefono rootato — la
// chiave vive in un processore separato con la sua memoria.
// Con essa si sigilla un "pepe" casuale di 32 byte. La chiave che apre i dati diventa
//
//     chiaveFinale = SHA-512( pepe || derivazioneDelPin )
//
// e il pepe si puo leggere solo chiedendolo al chip. Fuori dal telefono, il pepe e' un
// blocco cifrato senza chiave: provare un PIN diventa MATEMATICAMENTE inutile, perche' non
// si arriva alla chiave finale nemmeno indovinando il PIN giusto.
// Un attacco resta possibile solo SUL telefono, dove ogni tentativo deve passare dal chip:
// non piu 64 core in parallelo, ma un chip lento, uno alla volta, con il contatore dei tre
// tentativi che intanto scorre.
//
// IL PREZZO, e va detto prima e non dopo: la chiave del chip muore con il chip. Se
// cancelli i dati dell'app, cambi telefono, fai un ripristino di fabbrica o togli il blocco
// schermo, il pepe non e' piu leggibile e i dati locali diventano illeggibili PER SEMPRE.
// Per questo il backup cifrato (esportabile, con la TUA password) non passa da qui: e'
// l'unica via per portare l'account su un altro telefono, ed e' voluto cosi.
class HwKeyModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeHwKey"

  private val ALIAS = "lattice.hw.v1"
  private val KS = "AndroidKeyStore"

  private fun store(): KeyStore = KeyStore.getInstance(KS).apply { load(null) }

  /// Crea la chiave se non c'e'. Prova prima StrongBox (chip dedicato), poi TEE.
  private fun chiave(): SecretKey? {
    try {
      val ks = store()
      (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
      for (strongbox in listOf(true, false)) {
        try {
          val b = KeyGenParameterSpec.Builder(
            ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
          )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
          // Nessuna autenticazione biometrica richiesta: il fattore umano e' gia il PIN
          // dell'app. Aggiungerne un secondo qui vorrebbe dire perdere i dati a ogni
          // cambio di impronta digitale.
          if (strongbox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) b.setIsStrongBoxBacked(true)
          val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KS)
          g.init(b.build())
          return g.generateKey()
        } catch (e: Throwable) {
          // StrongBox assente o pieno: si riprova senza. Su telefoni senza chip dedicato
          // resta il TEE, che e' comunque un mondo separato dal sistema operativo.
        }
      }
      return null
    } catch (e: Throwable) { return null }
  }

  @ReactMethod
  fun info(promise: Promise) {
    val m = Arguments.createMap()
    val k = chiave()
    m.putBoolean("presente", k != null)
    var livello = "assente"
    try {
      if (k != null) {
        val f = java.security.KeyFactory.getInstance("AES", KS)
        livello = "tee"
        try {
          val ki = javax.crypto.SecretKeyFactory.getInstance(k.algorithm, KS)
            .getKeySpec(k, android.security.keystore.KeyInfo::class.java) as android.security.keystore.KeyInfo
          livello = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            when (ki.securityLevel) {
              android.security.keystore.KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
              android.security.keystore.KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
              android.security.keystore.KeyProperties.SECURITY_LEVEL_SOFTWARE -> "software"
              else -> "tee"
            }
          } else if (ki.isInsideSecureHardware) "tee" else "software"
        } catch (e: Throwable) { /* si resta su "tee" */ }
      }
    } catch (e: Throwable) { /* niente */ }
    m.putString("livello", livello)
    promise.resolve(m)
  }

  /// Sigilla dati con la chiave del chip. Restituisce "iv:ct" in esadecimale.
  @ReactMethod
  fun seal(hex: String, promise: Promise) {
    try {
      val k = chiave() ?: run { promise.reject("hw_assente", "chip non disponibile"); return }
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.ENCRYPT_MODE, k)
      val ct = c.doFinal(dehex(hex))
      promise.resolve(enhex(c.iv) + ":" + enhex(ct))
    } catch (e: Throwable) { promise.reject("hw_seal", e.message ?: "sigillo non riuscito") }
  }

  /// Apre cio' che il chip ha sigillato. Fuori da QUESTO telefono non funziona: e' il punto.
  @ReactMethod
  fun open(blob: String, promise: Promise) {
    try {
      val k = chiave() ?: run { promise.reject("hw_assente", "chip non disponibile"); return }
      val p = blob.split(":")
      if (p.size != 2) { promise.reject("hw_formato", "formato non valido"); return }
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, dehex(p[0])))
      promise.resolve(enhex(c.doFinal(dehex(p[1]))))
    } catch (e: Throwable) { promise.reject("hw_open", e.message ?: "apertura non riuscita") }
  }

  /// Distrugge la chiave nel chip. Dopo questa, i dati locali sono illeggibili per sempre:
  /// e' la cancellazione piu definitiva che questo telefono sappia fare.
  @ReactMethod
  fun destroy(promise: Promise) {
    promise.resolve(try { store().deleteEntry(ALIAS); true } catch (e: Throwable) { false })
  }

  private fun dehex(s: String): ByteArray =
    ByteArray(s.length / 2) { ((Character.digit(s[it * 2], 16) shl 4) + Character.digit(s[it * 2 + 1], 16)).toByte() }

  private fun enhex(b: ByteArray): String {
    val sb = StringBuilder(b.size * 2)
    for (x in b) sb.append(String.format("%02x", x))
    return sb.toString()
  }
}
