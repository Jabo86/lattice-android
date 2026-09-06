package com.latticenetwork.pulse

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.telecom.Connection
import android.telecom.DisconnectCause
import android.telecom.TelecomManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Ponte fra il telecom di Android e il JS della schermata di chiamata.
// Ogni chiamata nativa e' in try/catch: se il telecom rifiuta (produttori che lo hanno
// mutilato, Android < 8, permesso negato) la chiamata di Lattice continua a funzionare
// come nella v2.3.3 — si perde la priorita di sistema, non la telefonata.
class CallControlModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeCallControl"

  init { react = ctx }

  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasPerm())
  }

  private fun hasPerm(): Boolean =
    ctx.checkSelfPermission(Manifest.permission.MANAGE_OWN_CALLS) == PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun register(promise: Promise) {
    promise.resolve(LatticeConnectionService.register(ctx))
  }

  /// Chiamata in USCITA: la dichiariamo al sistema PRIMA di aprire il microfono.
  @ReactMethod
  fun startOutgoing(label: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !hasPerm()) { promise.resolve(false); return }
    try {
      LatticeConnectionService.register(ctx)
      val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val extras = Bundle()
      extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, LatticeConnectionService.handle(ctx))
      extras.putBoolean(TelecomManager.EXTRA_START_CALL_WITH_VIDEO_STATE, false)
      tm.placeCall(uriFor(label), extras)
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  /// Chiamata in ARRIVO. Autogestita: la finestra di risposta resta la nostra
  /// (`onShowIncomingCallUi`), il sistema sa soltanto che il telefono sta squillando.
  @ReactMethod
  fun reportIncoming(label: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !hasPerm()) { promise.resolve(false); return }
    try {
      LatticeConnectionService.register(ctx)
      val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val extras = Bundle()
      extras.putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, uriFor(label))
      tm.addNewIncomingCall(LatticeConnectionService.handle(ctx), extras)
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun setActive(promise: Promise) {
    try { LatticeConnectionService.current?.setActive(); promise.resolve(true) }
    catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun end(promise: Promise) {
    try {
      val c = LatticeConnectionService.current
      c?.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
      c?.destroy()
      LatticeConnectionService.current = null
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun state(promise: Promise) {
    promise.resolve(try { LatticeConnectionService.state() } catch (e: Throwable) { "none" })
  }

  // Gli eventi arrivano dal thread del telecom: `addListener`/`removeListeners` servono
  // solo a zittire l'avviso di RN sul NativeEventEmitter.
  @ReactMethod fun addListener(name: String) { }
  @ReactMethod fun removeListeners(n: Int) { }

  private fun uriFor(label: String): Uri {
    val safe = label.ifBlank { "lattice" }.replace(Regex("[^A-Za-z0-9._@-]"), "")
    return Uri.fromParts("sip", safe.ifBlank { "lattice" }, null)
  }

  companion object {
    private var react: ReactApplicationContext? = null

    fun emit(action: String, detail: String) {
      val c = react ?: return
      try {
        if (!c.hasActiveReactInstance()) return
        val m = Arguments.createMap()
        m.putString("action", action)
        m.putString("detail", detail)
        c.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("LatticeCallAction", m)
      } catch (e: Throwable) { /* la schermata di chiamata continua senza il telecom */ }
    }
  }
}
