package com.latticenetwork.pulse

import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import android.os.Build
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * FASE 2 — RADIO: la mesh anche SENZA router.
 *
 * Wi-Fi Direct è il trasporto vero: appena il gruppo si forma, Android crea una sottorete
 * (192.168.49.x) su un'interfaccia nuova. Il trasporto UDP già validato **non cambia di una
 * riga**: `MeshService.targets()` enumera TUTTE le interfacce, quindi spedisce anche là.
 *
 * Bluetooth LE è la SCOPERTA e la SVEGLIA: annuncia e cerca un solo UUID di servizio (zero
 * dati, zero nomi, consumo minimo) e, quando sente un nodo vicino, innesca subito la
 * ricerca Wi-Fi Direct. Portare 8 KB per pacchetto su BLE costerebbe decine di secondi e
 * batteria: scelta consapevole, scritta anche nell'audit dell'app.
 *
 * Si collega SOLO a chi annuncia il nostro servizio (`_latticemesh._udp`): nessun tentativo
 * verso televisori o stampanti. Ogni singola chiamata è protetta: un guasto della radio non
 * deve mai fermare il trasporto UDP che funziona.
 */
class MeshRadio(private val ctx: Context) {
  @Volatile var p2p = "off"        // off | perm | on | group
  @Volatile var p2pPeers = 0
  @Volatile var ble = "off"        // off | perm | bt-off | adv+scan | near
  @Volatile var bleSeen = 0        // quanti annunci Lattice sentiti via Bluetooth
  @Volatile var bleAt = 0L         // ultimo annuncio sentito
  @Volatile var p2pFound = 0       // quanti nodi Lattice trovati col servizio Wi-Fi Direct
  @Volatile var p2pClients = 0     // dispositivi dentro il nostro gruppo
  @Volatile private var owner = false
  @Volatile private var mineAt = 0L
  @Volatile private var bleUp = 0L
  private val bornAt = System.currentTimeMillis()
  @Volatile var err = ""

  private var mgr: WifiP2pManager? = null
  private var ch: WifiP2pManager.Channel? = null
  private var rx: BroadcastReceiver? = null
  private var adv: AdvertiseCallback? = null
  private var scan: ScanCallback? = null
  private var myAddr = ""
  private val found = ConcurrentHashMap<String, Long>()
  @Volatile private var groupFormed = false
  @Volatile private var lastConnect = 0L
  @Volatile private var lastDiscover = 0L

  private fun granted(p: String): Boolean =
    ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

  private fun nearbyOk(): Boolean =
    if (Build.VERSION.SDK_INT >= 33) granted("android.permission.NEARBY_WIFI_DEVICES")
    else granted("android.permission.ACCESS_FINE_LOCATION")

  fun start() {
    try { if (!nearbyOk()) p2p = "perm" else startP2p() } catch (e: Throwable) { err = "p2p: " + (e.message ?: "?") }
    try { startBle() } catch (e: Throwable) { err = "ble: " + (e.message ?: "?") }
  }

  // ── Wi-Fi Direct ─────────────────────────────────────────────────────────────────────
  private fun startP2p() {
    val m = ctx.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager? ?: return
    mgr = m
    ch = m.initialize(ctx, Looper.getMainLooper(), null)
    val c = ch ?: return
    val f = IntentFilter()
    f.addAction(WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION)
    f.addAction(WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION)
    f.addAction(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION)
    f.addAction(WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION)
    val r = object : BroadcastReceiver() {
      override fun onReceive(c2: Context?, i: Intent?) {
        try { onP2p(i) } catch (e: Throwable) { err = "rx: " + (e.message ?: "?") }
      }
    }
    rx = r
    ContextCompat.registerReceiver(ctx, r, f, ContextCompat.RECEIVER_NOT_EXPORTED)
    // Ci si annuncia con un servizio nostro: solo chi lo espone è un nodo Lattice.
    try {
      val rec = HashMap<String, String>()
      rec["v"] = "1"
      m.addLocalService(c, WifiP2pDnsSdServiceInfo.newInstance(SVC_NAME, SVC_TYPE, rec), null)
    } catch (e: Throwable) { err = "svc: " + (e.message ?: "?") }
    try {
      m.setDnsSdResponseListeners(c,
        WifiP2pManager.DnsSdServiceResponseListener { instance: String?, _: String?, dev: WifiP2pDevice? ->
          if (instance == SVC_NAME && dev != null && !dev.deviceAddress.isNullOrEmpty()) {
            found[dev.deviceAddress] = System.currentTimeMillis()
          }
        }, null)
      m.addServiceRequest(c, WifiP2pDnsSdServiceRequest.newInstance(SVC_TYPE), null)
    } catch (e: Throwable) { err = "nsd: " + (e.message ?: "?") }
    p2p = "on"
  }

  private fun onP2p(i: Intent?) {
    val a = i?.action ?: return
    val m = mgr ?: return
    val c = ch ?: return
    when (a) {
      WifiP2pManager.WIFI_P2P_STATE_CHANGED_ACTION -> {
        val on = i.getIntExtra(WifiP2pManager.EXTRA_WIFI_STATE, 0) == WifiP2pManager.WIFI_P2P_STATE_ENABLED
        if (!on) { p2p = "off"; groupFormed = false } else if (p2p == "off") p2p = "on"
      }
      WifiP2pManager.WIFI_P2P_THIS_DEVICE_CHANGED_ACTION -> {
        val d: WifiP2pDevice? = i.getParcelableExtra(WifiP2pManager.EXTRA_WIFI_P2P_DEVICE)
        if (d != null && !d.deviceAddress.isNullOrEmpty()) myAddr = d.deviceAddress
      }
      WifiP2pManager.WIFI_P2P_PEERS_CHANGED_ACTION -> {
        if (!nearbyOk()) return
        try { m.requestPeers(c) { list -> p2pPeers = list?.deviceList?.size ?: 0 } } catch (e: Throwable) { }
      }
      WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION -> {
        try {
          val g: android.net.wifi.p2p.WifiP2pGroup? = i.getParcelableExtra(WifiP2pManager.EXTRA_WIFI_P2P_GROUP)
          p2pClients = g?.clientList?.size ?: 0
          owner = g?.isGroupOwner == true
          m.requestConnectionInfo(c) { info: WifiP2pInfo? ->
            groupFormed = info?.groupFormed == true
            // Padrone di un gruppo VUOTO non è "collegato": si continua a cercare, altrimenti
            // due telefoni che creano ognuno il proprio gruppo restano soli per sempre.
            p2p = if (groupFormed && (!owner || p2pClients > 0)) "group"
                  else if (groupFormed) "attesa" else "on"
          }
        } catch (e: Throwable) { }
      }
    }
  }

  /// Chiamata circa una volta al secondo dal motore: ricerca a intervalli e un solo
  /// tentativo di collegamento alla volta (i tentativi a raffica fanno fallire il P2P).
  fun tick(now: Long) {
    val m = mgr ?: return
    val c = ch ?: return
    if (!nearbyOk()) { p2p = "perm"; return }
    bleTick(now)
    p2pFound = found.size
    if (groupFormed && (!owner || p2pClients > 0)) { p2p = "group"; return }
    // Nessuno con cui collegarsi da un po': si prova a fare da padrone di un gruppo
    // (con una moneta, per non diventarlo entrambi). Se in un minuto non entra nessuno,
    // si smonta e si torna a cercare.
    if (!groupFormed && found.isEmpty() && now - bornAt > 30000 && mineAt == 0L && Math.random() < 0.5) {
      mineAt = now
      try { m.createGroup(c, null) } catch (e: Throwable) { err = "grp: " + (e.message ?: "?") }
    } else if (mineAt > 0L && now - mineAt > 60000 && p2pClients == 0) {
      mineAt = 0L
      try { m.removeGroup(c, null) } catch (e: Throwable) { }
    }
    if (now - lastDiscover > 6000) {
      lastDiscover = now
      try { m.discoverServices(c, null) } catch (e: Throwable) { }
      try { m.discoverPeers(c, null) } catch (e: Throwable) { }
    }
    if (now - lastConnect > 10000) {
      val cand = found.entries.filter { now - it.value < 60000 }.map { it.key }.sorted().firstOrNull()
      if (cand != null) {
        lastConnect = now
        try {
          val cfg = WifiP2pConfig()
          cfg.deviceAddress = cand
          // Chi ha l'indirizzo "minore" si candida a padrone del gruppo: senza una regola
          // deterministica i due telefoni si invitano a vicenda e nessun gruppo si forma.
          cfg.groupOwnerIntent = if (myAddr.isNotEmpty() && myAddr < cand) 15 else 0
          m.connect(c, cfg, null)
        } catch (e: Throwable) { err = "conn: " + (e.message ?: "?") }
      }
    }
  }

  // ── Bluetooth LE: scoperta e sveglia ────────────────────────────────────────────────
  private fun startBle() {
    if (Build.VERSION.SDK_INT >= 31 &&
        (!granted("android.permission.BLUETOOTH_ADVERTISE") || !granted("android.permission.BLUETOOTH_SCAN"))) {
      ble = "perm"; return
    }
    val bm = ctx.getSystemService(BluetoothManager::class.java) ?: return
    val ad = bm.adapter ?: return
    if (!ad.isEnabled) { ble = "bt-off"; return }
    val uuid = ParcelUuid(UUID.fromString(BLE_UUID))
    try {
      val a = ad.bluetoothLeAdvertiser
      if (a != null) {
        val cb = object : AdvertiseCallback() {
          override fun onStartFailure(errorCode: Int) { err = "adv:" + errorCode }
        }
        adv = cb
        a.startAdvertising(
          AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false).build(),
          AdvertiseData.Builder().setIncludeDeviceName(false).addServiceUuid(uuid).build(),
          cb)
      }
    } catch (e: Throwable) { err = "adv: " + (e.message ?: "?") }
    try {
      val s = ad.bluetoothLeScanner
      if (s != null) {
        val cb = object : ScanCallback() {
          override fun onScanResult(type: Int, result: ScanResult?) {
            ble = "near"
            bleSeen++
            bleAt = System.currentTimeMillis()
            lastDiscover = 0L         // un nodo vicino: si cerca subito col Wi-Fi Direct
          }
          override fun onScanFailed(errorCode: Int) { err = "scan:" + errorCode; ble = "scan-err" }
        }
        scan = cb
        s.startScan(listOf(ScanFilter.Builder().setServiceUuid(uuid).build()),
          ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_BALANCED)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES).build(), cb)
      }
    } catch (e: Throwable) { err = "scan: " + (e.message ?: "?") }
    if (ble != "near") ble = "adv+scan"
    bleUp = System.currentTimeMillis()
  }

  // Alcuni telefoni fermano annuncio e scansione dopo qualche minuto senza dire nulla:
  // ogni 60 s si rifanno partire, e dopo 90 s senza sentire nessuno lo stato torna onesto.
  private fun bleTick(now: Long) {
    if (bleUp > 0L && now - bleUp > 60000) {
      try {
        val bm = ctx.getSystemService(BluetoothManager::class.java)
        val ad = bm?.adapter
        adv?.let { ad?.bluetoothLeAdvertiser?.stopAdvertising(it) }
        scan?.let { ad?.bluetoothLeScanner?.stopScan(it) }
      } catch (e: Throwable) { }
      adv = null; scan = null; bleUp = 0L
      try { startBle() } catch (e: Throwable) { err = "ble: " + (e.message ?: "?") }
    }
    if (ble == "near" && bleAt > 0L && now - bleAt > 90000) ble = "adv+scan"
  }

  fun stop() {
    try { rx?.let { ctx.unregisterReceiver(it) } } catch (e: Throwable) { }
    rx = null
    try { val m = mgr; val c = ch; if (m != null && c != null) m.clearLocalServices(c, null) } catch (e: Throwable) { }
    try {
      val bm = ctx.getSystemService(BluetoothManager::class.java)
      val ad = bm?.adapter
      adv?.let { ad?.bluetoothLeAdvertiser?.stopAdvertising(it) }
      scan?.let { ad?.bluetoothLeScanner?.stopScan(it) }
    } catch (e: Throwable) { }
    adv = null; scan = null
    found.clear()
    p2p = "off"; ble = "off"; groupFormed = false; p2pPeers = 0
  }

  companion object {
    private const val SVC_NAME = "lattice"
    private const val SVC_TYPE = "_latticemesh._udp"
    private const val BLE_UUID = "6c617474-6963-656d-6573-680000000001"
  }
}
