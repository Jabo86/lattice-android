package com.latticenetwork.pulse

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * INTERRUTTORE DEL MOTORE MESH.
 *
 * Prima della v1.6.3 il motore nel processo ":mesh" partiva SOLO in MainActivity.onCreate:
 * chi accendeva la Modalità Nodo Sovrano e provava subito la rete non aveva alcuna socket
 * aperta (zero pacchetti spediti, zero ricevuti) finché non chiudeva e riapriva l'app.
 * Da qui il JS lo accende e lo spegne nell'istante in cui l'utente sceglie.
 *
 * Espone anche la cartella reale del motore: i due processi si scambiano i pacchetti su file
 * e devono guardare LA STESSA cartella, senza dipendere da come una libreria traduce i percorsi.
 */
class MeshControlModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "MeshControl"

  private fun writeMode(sovereign: Boolean) {
    try {
      val d = File(ctx.filesDir, "mesh")
      if (!d.exists()) d.mkdirs()
      File(d, "mode").writeText(if (sovereign) "sovereign" else "standard")
    } catch (e: Throwable) { }
  }

  @ReactMethod
  fun meshDir(p: Promise) {
    try {
      val d = File(ctx.filesDir, "mesh")
      if (!d.exists()) d.mkdirs()
      p.resolve(d.absolutePath)
    } catch (e: Throwable) { p.reject("mesh", e) }
  }

  @ReactMethod
  fun start(p: Promise) {
    try {
      writeMode(true)
      MeshService.start(ctx)
      p.resolve(true)
    } catch (e: Throwable) { p.reject("mesh", e) }
  }

  @ReactMethod
  fun stop(p: Promise) {
    try {
      writeMode(false)
      MeshService.stop(ctx)
      p.resolve(true)
    } catch (e: Throwable) { p.reject("mesh", e) }
  }
}
