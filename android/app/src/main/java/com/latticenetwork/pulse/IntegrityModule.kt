package com.latticenetwork.pulse

import android.os.Build
import android.os.Debug
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

// SENSORE DI INTEGRITA — v2.5.2
//
// Cosa guarda, e perche ognuna di queste cose conta:
//  · binari di root (su, magisk, busybox) → qualcuno puo leggere la memoria dell'app
//  · build con chiavi di test / ro.debuggable → sistema non di produzione
//  · ADB attivo → il canale classico per estrarre i dati dell'app
//  · debugger attaccato → qualcuno sta ispezionando il processo mentre gira
//  · percorsi di Magisk / cartelle di sistema scrivibili → root nascosto o parziale
//
// ONESTA, PRIMA DI TUTTO: **questa e' una difesa che si puo battere.** Magisk sa nascondersi
// (DenyList), e chi controlla il sistema controlla anche cio' che l'app riesce a vedere. Un
// sensore di integrita non rende un telefono rootato sicuro: serve a far scattare un
// AVVISO quando la manomissione e' visibile, cioe' nella maggior parte dei casi reali, non
// in tutti. Chi promette il contrario sta vendendo.
// La difesa che NON si batte e' un'altra, e sta in HwKeyModule: la chiave nel chip. Anche
// con root pieno, il pepe si puo solo CHIEDERE al chip su QUESTO telefono, non portare via.
class IntegrityModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeIntegrity"

  private val binariRoot = arrayOf(
    "/system/bin/su", "/system/xbin/su", "/sbin/su", "/su/bin/su", "/system/sd/xbin/su",
    "/system/bin/failsafe/su", "/data/local/su", "/data/local/xbin/su", "/data/local/bin/su",
    "/system/app/Superuser.apk", "/system/bin/magisk", "/sbin/magisk", "/data/adb/magisk",
    "/data/adb/modules", "/system/xbin/busybox", "/system/bin/busybox"
  )

  private val cartelleScrivibili = arrayOf("/system", "/system/bin", "/system/sbin", "/vendor/bin", "/etc")

  @ReactMethod
  fun check(promise: Promise) {
    val motivi = Arguments.createArray()
    var root = false
    var debug = false

    for (p in binariRoot) {
      try { if (File(p).exists()) { root = true; motivi.pushString("presenza di " + p) } } catch (e: Throwable) { }
    }
    try {
      if (Build.TAGS != null && Build.TAGS.contains("test-keys")) { root = true; motivi.pushString("sistema firmato con chiavi di test") }
    } catch (e: Throwable) { }
    for (d in cartelleScrivibili) {
      try { if (File(d).canWrite()) { root = true; motivi.pushString("cartella di sistema scrivibile: " + d) } } catch (e: Throwable) { }
    }
    try {
      if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) { debug = true; motivi.pushString("debugger collegato al processo") }
    } catch (e: Throwable) { }
    try {
      val adb = Settings.Global.getInt(ctx.contentResolver, Settings.Global.ADB_ENABLED, 0)
      if (adb == 1) { debug = true; motivi.pushString("debug USB (ADB) attivo") }
    } catch (e: Throwable) { }
    try {
      val flags = ctx.applicationInfo.flags
      if ((flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) { debug = true; motivi.pushString("applicazione compilata come debuggabile") }
    } catch (e: Throwable) { }
    // Emulatore: non e' manomissione, ma non e' un telefono. Va detto, non allarmato.
    var emulatore = false
    try {
      emulatore = Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator") ||
        Build.MODEL.contains("sdk_gphone") || Build.HARDWARE == "goldfish" || Build.HARDWARE == "ranchu"
    } catch (e: Throwable) { }

    val m = Arguments.createMap()
    m.putBoolean("root", root)
    m.putBoolean("debug", debug)
    m.putBoolean("emulatore", emulatore)
    m.putBoolean("allarme", root || debug)
    m.putArray("motivi", motivi)
    promise.resolve(m)
  }
}
