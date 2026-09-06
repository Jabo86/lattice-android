package com.latticenetwork.pulse

import android.app.Application
import android.content.Context
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(RealityTunnelPackage())
        }
    )
  }

  // DIAGNOSTICA: registrato in attachBaseContext, cioe' PRIMA dei ContentProvider delle
  // librerie (che partono prima di Application.onCreate). E' la classe di arresto che ha
  // reso invisibile il crash della 1.2.8.
  override fun attachBaseContext(base: Context?) {
    super.attachBaseContext(base)
    installCrashHandler()
  }

  private fun installCrashHandler() {
    if (handlerInstalled) return
    handlerInstalled = true
    try {
      val prev = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { t, e ->
        val trace = (e.message ?: e.toString()) + "\n" + e.stackTraceToString().take(5000)
        try {
          java.io.File(filesDir, "nativecrash.txt").writeText(trace.take(6000))
        } catch (x: Throwable) { }
        // Invio della sola traccia tecnica: serve a capire gli arresti che avvengono prima
        // che l'app riesca a mostrare qualsiasi cosa. Nessun indirizzo, nessuna chiave.
        try {
          val body = org.json.JSONObject()
            .put("v", BuildConfig.VERSION_NAME)
            .put("android", android.os.Build.MODEL + " / API " + android.os.Build.VERSION.SDK_INT)
            .put("trace", trace)
            .toString()
          val c = (java.net.URL("https://lattice-network.it/api/public/crash").openConnection() as java.net.HttpURLConnection)
          c.requestMethod = "POST"
          c.connectTimeout = 4000
          c.readTimeout = 4000
          c.doOutput = true
          c.setRequestProperty("Content-Type", "application/json")
          c.outputStream.use { it.write(body.toByteArray()) }
          c.responseCode
          c.disconnect()
        } catch (x: Throwable) { }
        prev?.uncaughtException(t, e)
      }
    } catch (e: Throwable) { }
  }

  override fun onCreate() {
    super.onCreate()
    installCrashHandler()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    installTunnelProxy()
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  // DARK MESH: quando il tunnel è attivo, TUTTA la rete dell'app (fetch/XHR/axios via OkHttp)
  // passa dal SOCKS locale 127.0.0.1:10808 → Reality → internet. Quando è spento, connessione
  // diretta come sempre. Il ProxySelector legge il flag a ogni richiesta, così l'interruttore
  // ha effetto immediato senza ricreare il client di rete.
  private fun installTunnelProxy() {
    try {
      OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
        override fun createNewNetworkModuleClient(): OkHttpClient {
          return OkHttpClientProvider.createClientBuilder(this@MainApplication)
            .proxySelector(object : java.net.ProxySelector() {
              override fun select(uri: java.net.URI?): MutableList<java.net.Proxy> {
                return if (RealityTunnelModule.active.get())
                  mutableListOf(java.net.Proxy(java.net.Proxy.Type.SOCKS,
                    java.net.InetSocketAddress("127.0.0.1", RealityTunnelModule.SOCKS_PORT)))
                else mutableListOf(java.net.Proxy.NO_PROXY)
              }
              override fun connectFailed(uri: java.net.URI?, sa: java.net.SocketAddress?, e: java.io.IOException?) { }
            })
            .build()
        }
      })
    } catch (e: Throwable) { /* in caso di API diversa, si resta senza tunnel: l'app funziona */ }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  private companion object {
    @Volatile var handlerInstalled = false
  }
}
