package com.latticenetwork.pulse

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TUNNEL DARK MESH (XTLS-Reality) — motore lato app.
 *
 * Avvia in-process il core Xray (libv2ray) con un ingresso SOCKS5 locale su 127.0.0.1:10808
 * e un'uscita VLESS+Reality verso il nostro server. Quando è attivo, la rete dell'app
 * (configurata in MainApplication) passa da quel SOCKS: per chi osserva la rete il traffico
 * ha l'aspetto di una normale visita a un grande sito pubblico, non di un'app di messaggistica.
 *
 * Non è una VPN di sistema: nessun permesso VPN, nessuna notifica fissa, solo il traffico di
 * Lattice. Spento di default: si accende dall'interruttore in Impostazioni.
 */
class RealityTunnelModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "RealityTunnel"

  @ReactMethod
  fun start(configJson: String, promise: Promise) {
    try {
      synchronized(lock) {
        val existing = controller
        if (existing != null && existing.isRunning) { active.set(true); promise.resolve(true); return }
        val c = Libv2ray.newCoreController(cb)
        c.startLoop(configJson, 0) // tunFd = 0: nessun TUN, usiamo l'ingresso SOCKS
        controller = c
        active.set(true)
      }
      promise.resolve(true)
    } catch (e: Throwable) {
      active.set(false)
      promise.reject("tunnel_start", e.message ?: e.toString(), e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      active.set(false)
      synchronized(lock) { controller?.stopLoop(); controller = null }
      promise.resolve(true)
    } catch (e: Throwable) {
      promise.reject("tunnel_stop", e.message ?: e.toString(), e)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    val c = controller
    promise.resolve(active.get() && c != null && c.isRunning)
  }

  @ReactMethod
  fun version(promise: Promise) {
    try { promise.resolve(Libv2ray.checkVersionX()) } catch (e: Throwable) { promise.reject("v", e.message ?: "?", e) }
  }

  companion object {
    // Letto da MainApplication (ProxySelector di OkHttp): true → l'app instrada via SOCKS.
    val active = AtomicBoolean(false)
    const val SOCKS_PORT = 10808
    private val lock = Any()
    @Volatile private var controller: CoreController? = null
    private val cb = object : CoreCallbackHandler {
      override fun startup(): Long = 0
      override fun shutdown(): Long = 0
      override fun onEmitStatus(code: Long, msg: String?): Long = 0
    }
  }
}
