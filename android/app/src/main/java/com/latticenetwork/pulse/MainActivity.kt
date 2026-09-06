package com.latticenetwork.pulse
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
    // Riservatezza totale: blocca screenshot e registrazione schermo su tutta lapp
    window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    // FLUIDITA (v1.5.0): molti telefoni con pannello a 90/120/144 Hz tengono le app a
    // 60 Hz se la finestra non chiede espressamente la modalita piu veloce. Qui si
    // sceglie, tra le modalita con la STESSA risoluzione di quella attuale, quella con
    // il refresh piu alto. Nessuna libreria nuova; ogni errore viene ignorato perche
    // l'avvio dell'app non deve mai dipendere da questa ottimizzazione.
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        @Suppress("DEPRECATION")
        val disp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay
        val cur = disp?.mode
        if (disp != null && cur != null) {
          // `cur` qui è già stato verificato non nullo: senza `!!` Kotlin lo tratta come
          // nullable e la compilazione si ferma (era il motivo del BUILD FAILED).
          var best = cur!!
          for (m in disp.supportedModes) {
            if (m.physicalWidth == cur.physicalWidth &&
                m.physicalHeight == cur.physicalHeight &&
                m.refreshRate > best.refreshRate) {
              best = m
            }
          }
          if (best.modeId != cur.modeId) {
            val attrs = window.attributes
            attrs.preferredDisplayModeId = best.modeId
            window.attributes = attrs
          }
        }
      }
    } catch (e: Throwable) { }
    // DIAGNOSTICA: un arresto nativo non deve più sparire senza lasciare traccia.
    try {
      val prev = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { t, e ->
        try {
          java.io.File(filesDir, "nativecrash.txt").writeText(
            (e.message ?: e.toString()) + "\n\n" + e.stackTraceToString().take(6000)
          )
        } catch (x: Throwable) { }
        prev?.uncaughtException(t, e)
      }
    } catch (e: Throwable) { }

    // SVEGLIA SENZA GOOGLE: se attiva, torna in ascolto sul nostro server.
    // Qualsiasi problema qui NON deve impedire l'avvio dell'app.
    try { WakeService.start(this) } catch (e: Throwable) { }
    // Il motore mesh si accende da solo SOLO in Modalità Nodo Sovrano.
    try { if (MeshService.sovereign(this)) MeshService.start(this) else MeshService.stop(this) } catch (e: Throwable) { }
  }

  // Ogni volta che si torna nell'app: (ri)avvia il servizio in background se serve — così
  // l'interruttore "Traffico invisibile" ha effetto senza aspettare un riavvio del telefono.
  override fun onResume() {
    super.onResume()
    try { WakeService.start(this) } catch (e: Throwable) { }
    // Rete di sicurezza: se il motore mesh e' stato ucciso dal sistema, al rientro riparte.
    try { if (MeshService.sovereign(this)) MeshService.start(this) } catch (e: Throwable) { }
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
