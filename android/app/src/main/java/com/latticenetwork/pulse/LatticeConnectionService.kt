package com.latticenetwork.pulse

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Build
import android.telecom.Connection
import android.telecom.ConnectionRequest
import android.telecom.ConnectionService
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import androidx.annotation.RequiresApi

// CHIAMATE SOVRANE — v2.5.0
//
// Il problema che risolve, in una riga: prima Lattice era una app qualunque che teneva
// aperto il microfono. Se arrivava una chiamata GSM (o una di WhatsApp), il sistema
// strappava l'audio senza dire niente a nessuno: la voce spariva, la chiamata sembrava
// caduta e non c'era modo di riprenderla.
//
// Con una `ConnectionService` AUTOGESTITA (`CAPABILITY_SELF_MANAGED`) la chiamata di
// Lattice diventa una chiamata VERA per Android: entra nel registro del telecom, ha la
// priorita di una telefonata, e quando ne arriva un'altra il sistema NON ci spegne —
// ci chiama `onHold()` e lascia decidere all'utente. Noi mettiamo in pausa il microfono e
// lo riaccendiamo a `onUnhold()`, senza perdere la sessione crittografica.
//
// "Autogestita" e' la parte importante per la privacy: NON siamo un'app di telefonia di
// sistema, non chiediamo di leggere il registro chiamate, non passiamo numeri di telefono
// al telecom. L'unica cosa che il sistema vede e' che "c'e' una chiamata in corso".
@RequiresApi(Build.VERSION_CODES.O)
class LatticeConnectionService : ConnectionService() {

  override fun onCreateOutgoingConnection(
    from: PhoneAccountHandle?,
    request: ConnectionRequest?
  ): Connection = build(request, outgoing = true)

  override fun onCreateIncomingConnection(
    from: PhoneAccountHandle?,
    request: ConnectionRequest?
  ): Connection = build(request, outgoing = false)

  override fun onCreateOutgoingConnectionFailed(from: PhoneAccountHandle?, request: ConnectionRequest?) {
    CallControlModule.emit("end", "")
  }

  override fun onCreateIncomingConnectionFailed(from: PhoneAccountHandle?, request: ConnectionRequest?) {
    CallControlModule.emit("end", "")
  }

  private fun build(request: ConnectionRequest?, outgoing: Boolean): Connection {
    val conn = LatticeConnection()
    conn.setAddress(request?.address ?: Uri.fromParts("sip", "lattice", null), TelecomManager.PRESENTATION_ALLOWED)
    conn.connectionCapabilities = Connection.CAPABILITY_HOLD or Connection.CAPABILITY_SUPPORT_HOLD or
      Connection.CAPABILITY_MUTE
    conn.audioModeIsVoip = true
    conn.setCallerDisplayName("Lattice", TelecomManager.PRESENTATION_ALLOWED)
    if (outgoing) conn.setDialing() else conn.setRinging()
    current = conn
    return conn
  }

  // ── La singola connessione. Un canale, una chiamata: Lattice non ne tiene due. ──
  class LatticeConnection : Connection() {
    override fun onAnswer() { setActive(); CallControlModule.emit("answer", "") }
    override fun onReject() { setDisconnected(DisconnectCause(DisconnectCause.REJECTED)); destroy(); current = null; CallControlModule.emit("reject", "") }
    override fun onDisconnect() { setDisconnected(DisconnectCause(DisconnectCause.LOCAL)); destroy(); current = null; CallControlModule.emit("end", "") }
    override fun onAbort() { setDisconnected(DisconnectCause(DisconnectCause.CANCELED)); destroy(); current = null; CallControlModule.emit("end", "") }
    // È QUI che sta il guadagno vero: arriva una chiamata esterna, il sistema mette la
    // nostra in pausa invece di ucciderla. Il microfono si chiude, la sessione resta viva.
    override fun onHold() { setOnHold(); CallControlModule.emit("hold", "") }
    override fun onUnhold() { setActive(); CallControlModule.emit("unhold", "") }
    override fun onCallAudioStateChanged(state: android.telecom.CallAudioState?) {
      CallControlModule.emit(if (state?.isMuted == true) "muted" else "unmuted", "")
    }
    override fun onShowIncomingCallUi() { CallControlModule.emit("show-incoming", "") }
  }

  companion object {
    var current: Connection? = null

    const val ACCOUNT_ID = "lattice-voip"

    fun handle(ctx: Context): PhoneAccountHandle =
      PhoneAccountHandle(ComponentName(ctx, LatticeConnectionService::class.java), ACCOUNT_ID)

    /// Registra l'account. Idempotente: chiamarla mille volte non cambia niente.
    fun register(ctx: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
      return try {
        val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
        val acc = PhoneAccount.builder(handle(ctx), "Lattice")
          .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
          .setShortDescription("Lattice · voce cifrata")
          .build()
        tm.registerPhoneAccount(acc)
        true
      } catch (e: Throwable) { false }
    }

    /// Stato reale, per la diagnostica in-app: niente promesse, solo cio' che c'e'.
    fun state(): String = when {
      current == null -> "none"
      current?.state == Connection.STATE_HOLDING -> "hold"
      current?.state == Connection.STATE_ACTIVE -> "active"
      current?.state == Connection.STATE_RINGING -> "ringing"
      current?.state == Connection.STATE_DIALING -> "dialing"
      else -> "other"
    }
  }
}
