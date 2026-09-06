package com.latticenetwork.pulse

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Dopo un riavvio del telefono la sveglia deve tornare in ascolto da sola. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val a = intent?.action ?: return
    if (a == Intent.ACTION_BOOT_COMPLETED || a == "android.intent.action.QUICKBOOT_POWERON" ||
        a == Intent.ACTION_MY_PACKAGE_REPLACED) {
      WakeService.start(context)
    }
  }
}
