package com.latticenetwork.pulse

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.File
import java.net.DatagramPacket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.security.SecureRandom

/**
 * MOTORE MESH (Nodo Sovrano) — gira in un PROCESSO NATIVO SEPARATO (":mesh").
 *
 * Perché un processo a parte: la radio e il ciclo di rete non devono mai rubare tempo al
 * thread dell'interfaccia. Qui dentro può bloccarsi una socket senza che l'app perda un
 * fotogramma.
 *
 * v1.6.3 — tre guasti reali corretti (due telefoni sulla stessa Wi-Fi non si vedevano):
 *  1. il servizio non veniva mai avviato accendendo la modalità (vedi MeshControlModule);
 *  2. si spediva SOLO a 255.255.255.255 e senza MulticastLock: Android scarta i pacchetti
 *     broadcast/multicast in risparmio energetico e molti router non inoltrano l'indirizzo
 *     "limitato". Ora: lock di rete + broadcast di OGNI sottorete + gruppo multicast;
 *  3. i pacchetti da 8192 byte venivano frammentati dal livello IP e persi: ora viaggiano
 *     in pezzi da 1 KB ricomposti da MeshFrame.
 *
 * Scambio col processo dell'app tramite cartelle di posta nella sandbox dell'app (i due
 * processi condividono i file, non serve IPC fragile). I pacchetti sono cipolle già cifrate:
 * qui non si vede nulla di leggibile, e questo processo NON sa chi è il mittente.
 *   files/mesh/out (file .bin) → da spedire      files/mesh/in (file .bin) → arrivati
 *   files/mesh/stat.json → soli CONTEGGI anonimi + diagnostica di rete (nessun indirizzo altrui)
 */
class MeshService : Service() {
  @Volatile private var running = false
  private var rx: Thread? = null
  private var tx: Thread? = null
  private var keeper: Thread? = null
  private var sock: MulticastSocket? = null
  private var mcLock: WifiManager.MulticastLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private val asm = MeshFrame.Reassembler()
  private val rand = SecureRandom()
  private var selfId = "00000000"
  private var radio: MeshRadio? = null

  // Contatori tenuti in memoria: il file è solo una fotografia periodica (nessuna corsa).
  @Volatile private var cSeen = 0L        // pacchetti a cipolla ricomposti e consegnati all'app
  @Volatile private var cProbes = 0L      // prove arrivate da UN ALTRO telefono
  @Volatile private var cLoops = 0L       // eco: le MIE prove che il Wi-Fi mi restituisce
  @Volatile private var cTx = 0L          // datagrammi spediti
  @Volatile private var cTxErr = 0L
  @Volatile private var cRx = 0L          // datagrammi ricevuti (qualsiasi, prima dei controlli)
  @Volatile private var probeCode = ""
  @Volatile private var probeAt = 0L
  @Volatile private var lastErr = ""
  @Volatile private var myIp = ""
  @Volatile private var targetsTxt = ""
  private var targets: List<InetAddress> = emptyList()
  private var targetsAt = 0L
  private var lastJoin = 0L
  private val startedAt = System.currentTimeMillis()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    foreground()
    if (!running) {
      running = true
      selfId = loadSelfId()
      locks(true)
      // FASE 2: Wi-Fi Direct (trasporto vero senza router) e BLE (scoperta/sveglia).
      // Un guasto della radio non deve mai fermare il trasporto UDP che funziona.
      try { radio = MeshRadio(applicationContext).also { it.start() } } catch (e: Throwable) { lastErr = "radio: " + (e.message ?: "?") }
      cSeen = loadCounter("seen")
      rx = Thread { rxLoop() }.also { it.isDaemon = true; it.start() }
      tx = Thread { txLoop() }.also { it.isDaemon = true; it.start() }
      keeper = Thread { keepLoop() }.also { it.isDaemon = true; it.start() }
    }
    return START_STICKY
  }

  // ── Notifica fissa: senza di essa Android uccide il motore appena esci dall'app ──────
  private fun foreground() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val nm = getSystemService(NotificationManager::class.java)
        val ch = NotificationChannel(CH, "Nodo Sovrano", NotificationManager.IMPORTANCE_MIN)
        ch.setShowBadge(false)
        ch.lockscreenVisibility = Notification.VISIBILITY_SECRET
        nm.createNotificationChannel(ch)
      }
      val i = Intent(this, MainActivity::class.java)
      i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
      val fl = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
      val n = NotificationCompat.Builder(this, CH)
        .setContentTitle("Nodo Sovrano attivo")
        .setContentText("Rete locale in ascolto")
        .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
        .setOngoing(true)
        .setShowWhen(false)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setContentIntent(PendingIntent.getActivity(this, 0, i, fl))
        .build()
      startForeground(FG_ID, n)
    } catch (e: Throwable) { lastErr = "fg: " + (e.message ?: "?") }
  }

  // Il chip Wi-Fi scarta broadcast e multicast in risparmio energetico: questi due lock
  // sono la differenza fra "ricevo" e "non ricevo niente".
  private fun locks(on: Boolean) {
    try {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      if (on) {
        if (mcLock == null) mcLock = wm.createMulticastLock("lattice-mesh").also { it.setReferenceCounted(false) }
        if (mcLock?.isHeld != true) mcLock?.acquire()
        if (wifiLock == null) {
          val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                     else WifiManager.WIFI_MODE_FULL_HIGH_PERF
          wifiLock = wm.createWifiLock(mode, "lattice-mesh").also { it.setReferenceCounted(false) }
        }
        if (wifiLock?.isHeld != true) wifiLock?.acquire()
      } else {
        try { if (mcLock?.isHeld == true) mcLock?.release() } catch (e: Exception) { }
        try { if (wifiLock?.isHeld == true) wifiLock?.release() } catch (e: Exception) { }
      }
    } catch (e: Throwable) { lastErr = "lock: " + (e.message ?: "?") }
  }

  private fun dir(name: String): File {
    val d = File(filesDir, "mesh/$name")
    if (!d.exists()) d.mkdirs()
    return d
  }

  // Firma del motore (8 esadecimali casuali, stabile su questo telefono): serve SOLO a
  // distinguere l'eco dei propri pacchetti da quelli dell'altro telefono nella diagnostica.
  private fun loadSelfId(): String {
    return try {
      val f = File(File(filesDir, "mesh").also { if (!it.exists()) it.mkdirs() }, "selfid")
      if (f.exists()) {
        val v = f.readText().trim()
        if (v.length == 8) v else newSelfId(f)
      } else newSelfId(f)
    } catch (e: Exception) { "00000000" }
  }

  private fun newSelfId(f: File): String {
    val b = ByteArray(4)
    rand.nextBytes(b)
    val s = b.joinToString("") { String.format("%02x", it) }
    try { f.writeText(s) } catch (e: Exception) { }
    return s
  }

  private fun loadCounter(key: String): Long {
    return try {
      val f = File(File(filesDir, "mesh"), "stat.json")
      if (!f.exists()) 0L else JSONObject(f.readText()).optLong(key, 0L)
    } catch (e: Exception) { 0L }
  }

  private fun socket(): MulticastSocket {
    val s = sock
    if (s != null && !s.isClosed) return s
    val n = MulticastSocket(null as java.net.SocketAddress?)
    n.reuseAddress = true
    n.broadcast = true
    n.soTimeout = 1500
    n.timeToLive = 4
    n.bind(InetSocketAddress(MeshFrame.PORT))
    // Ci si iscrive al gruppo multicast su OGNI interfaccia utile: alcuni router
    // inoltrano il multicast e buttano via il broadcast, altri fanno l'opposto.
    joinAll(n)
    sock = n
    return n
  }

  // Iscrizione al gruppo multicast su OGNI interfaccia utile. Va RIFATTA: quando il gruppo
  // Wi-Fi Direct si forma nasce un'interfaccia nuova (p2p-wlan0), che alla creazione della
  // socket non esisteva.
  private fun joinAll(n: MulticastSocket) {
    try {
      val g = InetSocketAddress(InetAddress.getByName(GROUP), MeshFrame.PORT)
      for (ni in NetworkInterface.getNetworkInterfaces()) {
        try {
          if (!ni.isUp || ni.isLoopback || !ni.supportsMulticast()) continue
          n.joinGroup(g, ni)
        } catch (e: Exception) { /* già iscritti o interfaccia che non ci interessa */ }
      }
    } catch (e: Exception) { lastErr = "join: " + (e.message ?: "?") }
  }

  // Tutti gli indirizzi su cui vale la pena spedire: il broadcast di OGNI sottorete
  // (192.168.x.255 e simili), il broadcast limitato e il gruppo multicast.
  private fun targets(): List<InetAddress> {
    val now = System.currentTimeMillis()
    if (targets.isNotEmpty() && now - targetsAt < 5000) return targets
    val l = ArrayList<InetAddress>()
    var ip = ""
    try {
      for (ni in NetworkInterface.getNetworkInterfaces()) {
        if (!ni.isUp || ni.isLoopback) continue
        for (ia in ni.interfaceAddresses) {
          val a = ia.address
          if (a !is Inet4Address) continue
          if (ip.isEmpty()) ip = a.hostAddress ?: ""
          val b = ia.broadcast
          if (b != null && !l.contains(b)) l.add(b)
        }
      }
    } catch (e: Exception) { lastErr = "iface: " + (e.message ?: "?") }
    try { l.add(InetAddress.getByName("255.255.255.255")) } catch (e: Exception) { }
    try { l.add(InetAddress.getByName(GROUP)) } catch (e: Exception) { }
    myIp = ip
    targetsTxt = l.joinToString(" ") { it.hostAddress ?: "?" }
    targets = l
    targetsAt = now
    return l
  }

  // Ascolto: ogni pacchetto valido finisce nella posta in arrivo e alza il contatore.
  private fun rxLoop() {
    val buf = ByteArray(2048)
    while (running) {
      try {
        val s = socket()
        val p = DatagramPacket(buf, buf.size)
        s.receive(p)
        cRx++
        val len = p.length
        if (MeshFrame.isProbe(buf, len)) {
          // Pacchetto di PROVA (solo diagnostica, non fa parte del protocollo anonimo):
          // serve all'utente per vedere con i propri occhi se i due telefoni si parlano.
          noteProbe(buf)
        } else {
          val full = asm.accept(buf, len, System.currentTimeMillis())
          if (full != null && full.size == MeshFrame.PACKET) {
            val f = File(dir("in"), System.currentTimeMillis().toString() + "-" + (Math.random() * 1e9).toInt() + ".bin")
            f.writeBytes(full)
            cSeen++
          }
        }
      } catch (e: Exception) {
        // timeout di ascolto: normale, si ricicla
        if (!running) return
        try { Thread.sleep(60) } catch (i: InterruptedException) { return }
      }
    }
  }

  // Spedizione: quello che l'app mette in posta in uscita parte su tutti gli indirizzi utili.
  private fun txLoop() {
    while (running) {
      try {
        val out = dir("out").listFiles { f -> f.name.endsWith(".bin") }
        if (out != null && out.isNotEmpty()) {
          val s = socket()
          val dst = targets()
          for (f in out) {
            try {
              val b = f.readBytes()
              if (MeshFrame.isProbe(b, b.size)) {
                MeshFrame.stampNode(b, selfId)      // così l'eco si riconosce
                blast(s, arrayOf(b), dst)
              } else if (b.size == MeshFrame.PACKET) {
                val id = rand.nextInt()
                blast(s, MeshFrame.split(b, id), dst)
              }
            } catch (e: Exception) {
              cTxErr++
              lastErr = "tx: " + (e.message ?: "?")
            } finally { try { f.delete() } catch (e: Exception) { } }
          }
        }
        Thread.sleep(200)
      } catch (e: InterruptedException) { return } catch (e: Exception) {
        lastErr = "txloop: " + (e.message ?: "?")
        try { Thread.sleep(500) } catch (i: InterruptedException) { return }
      }
    }
  }

  private fun blast(s: MulticastSocket, dgs: Array<ByteArray>, dst: List<InetAddress>) {
    for (d in dgs) {
      for (a in dst) {
        try {
          s.send(DatagramPacket(d, d.size, a, MeshFrame.PORT))
          cTx++
        } catch (e: Exception) {
          cTxErr++
          lastErr = "send " + (a.hostAddress ?: "?") + ": " + (e.message ?: "?")
        }
      }
      // un respiro fra i pezzi: 8 datagrammi di seguito in broadcast su Wi-Fi si perdono
      try { Thread.sleep(6) } catch (i: InterruptedException) { return }
    }
  }

  // Esito della PROVA: la firma del nodo dice se è la nostra eco o l'altro telefono.
  private fun noteProbe(b: ByteArray) {
    try {
      val who = MeshFrame.probeNode(b)
      if (who == selfId) { cLoops++; return }
      cProbes++
      probeCode = MeshFrame.probeCode(b)
      probeAt = System.currentTimeMillis()
    } catch (e: Exception) { }
  }

  // Manutenzione + fotografia periodica dello stato (il barometro non deve mai disturbare).
  private fun keepLoop() {
    while (running) {
      try {
        val now = System.currentTimeMillis()
        asm.sweep(now)
        locks(true)          // se il sistema li ha rilasciati, si riprendono
        targets()
        try { radio?.tick(now) } catch (e: Throwable) { }
        if (now - lastJoin > 5000) { lastJoin = now; try { sock?.let { joinAll(it) } } catch (e: Exception) { } }
        flush()
        Thread.sleep(900)
      } catch (e: InterruptedException) { return } catch (e: Exception) {
        try { Thread.sleep(900) } catch (i: InterruptedException) { return }
      }
    }
  }

  // Barometro: SOLO conteggi e diagnostica del PROPRIO telefono. Nessun indirizzo altrui,
  // nessun identificativo di chi c'è intorno.
  private fun flush() {
    try {
      val o = JSONObject()
      o.put("seen", cSeen)
      o.put("probes", cProbes)
      o.put("loops", cLoops)
      o.put("probeCode", probeCode)
      o.put("probeAt", probeAt)
      o.put("tx", cTx); o.put("txErr", cTxErr); o.put("rx", cRx)
      o.put("ip", myIp); o.put("targets", targetsTxt)
      o.put("err", lastErr)
      val r = radio
      o.put("p2p", r?.p2p ?: "off")
      o.put("p2pPeers", r?.p2pPeers ?: 0)
      o.put("ble", r?.ble ?: "off")
      o.put("bleSeen", r?.bleSeen ?: 0)
      o.put("bleAt", r?.bleAt ?: 0L)
      o.put("p2pFound", r?.p2pFound ?: 0)
      o.put("p2pClients", r?.p2pClients ?: 0)
      if (r != null && r.err.isNotEmpty()) o.put("radioErr", r.err)
      o.put("running", running)
      o.put("since", startedAt)
      o.put("at", System.currentTimeMillis())
      File(File(filesDir, "mesh"), "stat.json").writeText(o.toString())
    } catch (e: Exception) { }
  }

  override fun onDestroy() {
    running = false
    rx?.interrupt(); tx?.interrupt(); keeper?.interrupt()
    try { sock?.close() } catch (e: Exception) { }
    sock = null
    try { radio?.stop() } catch (e: Throwable) { }
    radio = null
    locks(false)
    flush()
    super.onDestroy()
  }

  companion object {
    const val CH = "lattice-mesh"
    const val FG_ID = 4713
    private const val GROUP = "239.255.42.99"

    /// Acceso solo in Modalità Nodo Sovrano (il flag lo scrive l'app in mesh/mode).
    fun sovereign(ctx: Context): Boolean {
      return try { File(File(ctx.filesDir, "mesh"), "mode").readText().trim() == "sovereign" } catch (e: Exception) { false }
    }

    fun start(ctx: Context) {
      if (!sovereign(ctx)) return
      try {
        val i = Intent(ctx, MeshService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      } catch (e: Throwable) { /* il sistema può rifiutare da background: si riprova al rientro */ }
    }

    fun stop(ctx: Context) {
      try { ctx.stopService(Intent(ctx, MeshService::class.java)) } catch (e: Throwable) { }
    }
  }
}
