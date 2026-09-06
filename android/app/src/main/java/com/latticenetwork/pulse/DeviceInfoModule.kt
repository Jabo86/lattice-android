package com.latticenetwork.pulse

import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

// Frequenza dello schermo, letta dal sistema.
//
// Serve a dire la verita invece di una promessa: "120 fps" non e' una cosa che un'app
// puo decidere. Il pannello ha una frequenza massima, il produttore decide quali modalita
// esporre, e il sistema puo abbassarla per la batteria o per il calore. `MainActivity`
// chiede da sempre la modalita piu veloce con la stessa risoluzione; qui si LEGGE cosa
// e' stato concesso, e l'app lo mostra a schermo: fotogrammi possibili, non sperati.
class DeviceInfoModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeDeviceInfo"

  @ReactMethod
  fun display(promise: Promise) {
    val m = Arguments.createMap()
    try {
      // Il tipo va dichiarato per forza: senza, Kotlin inferisce
      // Any? e tutti i campi della modalita diventano irrisolvibili (BUILD FAILED).
      @Suppress("DEPRECATION")
      val disp: android.view.Display? = ctx.currentActivity?.windowManager?.defaultDisplay
      val cur: android.view.Display.Mode? = disp?.mode
      var max: Float = cur?.refreshRate ?: 0f
      if (disp != null && cur != null) {
        for (mode in disp.supportedModes) {
          if (mode.physicalWidth == cur.physicalWidth &&
              mode.physicalHeight == cur.physicalHeight &&
              mode.refreshRate > max) max = mode.refreshRate
        }
      }
      m.putDouble("hz", ((cur?.refreshRate ?: 0f) * 10f).toInt() / 10.0)
      m.putDouble("maxHz", (max * 10f).toInt() / 10.0)
      m.putInt("modes", disp?.supportedModes?.size ?: 0)
    } catch (e: Throwable) {
      m.putDouble("hz", 0.0); m.putDouble("maxHz", 0.0); m.putInt("modes", 0)
    }
    promise.resolve(m)
  }
}
