package com.latticenetwork.disguise

import android.content.ComponentName
import android.content.pm.PackageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// ASPETTO DISCRETO — accende un solo `activity-alias` tra quelli dichiarati nel manifest e
// spegne gli altri. È l'unico modo previsto da Android per cambiare icona e nome nella home
// senza reinstallare l'app.
private val ALIASES = linkedMapOf(
  "default" to ".MainActivity",
  "calc" to ".AliasCalc",
  "notes" to ".AliasNotes",
  "weather" to ".AliasWeather",
  "clock" to ".AliasClock"
)

class AppDisguiseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppDisguise")

    Function("options") { ALIASES.keys.toList() }

    Function("current") {
      val ctx = appContext.reactContext ?: return@Function "default"
      val pm = ctx.packageManager
      val pkg = ctx.packageName
      for ((key, cls) in ALIASES) {
        if (key == "default") continue
        val st = try {
          pm.getComponentEnabledSetting(ComponentName(pkg, pkg + cls))
        } catch (e: Throwable) { continue }
        if (st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return@Function key
      }
      "default"
    }

    AsyncFunction("apply") { key: String ->
      val ctx = appContext.reactContext ?: throw Exception("Contesto non disponibile")
      val target = ALIASES[key] ?: throw Exception("Travestimento sconosciuto: $key")
      val pm = ctx.packageManager
      val pkg = ctx.packageName
      // Prima si ACCENDE quello nuovo: spegnendo per primo l'attuale, un'interruzione a
      // metà lascerebbe il telefono senza nessuna icona per aprire l'app.
      pm.setComponentEnabledSetting(
        ComponentName(pkg, pkg + target),
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP
      )
      for ((k, cls) in ALIASES) {
        if (k == key) continue
        pm.setComponentEnabledSetting(
          ComponentName(pkg, pkg + cls),
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP
        )
      }
      key
    }
  }
}
