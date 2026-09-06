package com.latticenetwork.pulse;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * INCARTAMENTO DEI PACCHETTI MESH (Java puro, nessuna dipendenza Android → testabile a parte).
 *
 * Perche' esiste: un pacchetto a cipolla e' di 8192 byte fissi. Un datagramma UDP di 8192 byte
 * viene spezzato dal livello IP e, in broadcast su Wi-Fi, i frammenti IP vengono persi quasi
 * sempre. Qui i pacchetti vengono divisi in pezzi da 1 KB con una piccola intestazione nostra
 * e ricomposti dall'altro lato: nessun frammento IP, nessuna perdita sistematica.
 *
 * Intestazione (10 byte): "LMF1" | id messaggio (4) | indice pezzo (1) | pezzi totali (1)
 * L'id e' casuale e cambia ad ogni spedizione: non e' un identificativo del dispositivo.
 */
public final class MeshFrame {
  public static final int PORT = 49999;
  public static final int PACKET = 8192;          // dimensione fissa del pacchetto a cipolla
  public static final int PROBE = 64;             // pacchetto di prova (diagnostica)
  public static final int CHUNK = 1024;           // pezzo utile per datagramma
  public static final int HDR = 10;
  public static final int MAX_DGRAM = HDR + CHUNK;
  private static final byte[] TAG = { 'L', 'M', 'F', '1' };

  public static final String PROBE_MAGIC = "LATMESHPROBE";  // 12 byte
  public static final int PROBE_ID_OFF = 20;                // magia(12) + codice(8)
  public static final int PROBE_ID_LEN = 8;

  private MeshFrame() { }

  /** Divide un pacchetto in datagrammi pronti da spedire. */
  public static byte[][] split(byte[] packet, int msgId) {
    int total = (packet.length + CHUNK - 1) / CHUNK;
    if (total < 1) total = 1;
    byte[][] out = new byte[total][];
    for (int i = 0; i < total; i++) {
      int off = i * CHUNK;
      int len = Math.min(CHUNK, packet.length - off);
      byte[] d = new byte[HDR + len];
      d[0] = TAG[0]; d[1] = TAG[1]; d[2] = TAG[2]; d[3] = TAG[3];
      d[4] = (byte) (msgId >>> 24); d[5] = (byte) (msgId >>> 16);
      d[6] = (byte) (msgId >>> 8);  d[7] = (byte) msgId;
      d[8] = (byte) i; d[9] = (byte) total;
      System.arraycopy(packet, off, d, HDR, len);
      out[i] = d;
    }
    return out;
  }

  public static boolean isFrag(byte[] b, int len) {
    if (len <= HDR || len > MAX_DGRAM) return false;
    for (int i = 0; i < 4; i++) if (b[i] != TAG[i]) return false;
    return true;
  }

  public static boolean isProbe(byte[] b, int len) {
    if (len != PROBE) return false;
    for (int i = 0; i < PROBE_MAGIC.length(); i++) if (b[i] != (byte) PROBE_MAGIC.charAt(i)) return false;
    return true;
  }

  public static String probeCode(byte[] b) {
    return new String(b, PROBE_MAGIC.length(), 8, StandardCharsets.US_ASCII);
  }

  public static String probeNode(byte[] b) {
    return new String(b, PROBE_ID_OFF, PROBE_ID_LEN, StandardCharsets.US_ASCII);
  }

  /** Il motore firma il proprio pacchetto di prova: cosi' l'eco dei propri pacchetti
   *  (che il Wi-Fi restituisce al mittente) si distingue da quelli dell'ALTRO telefono. */
  public static void stampNode(byte[] b, String id) {
    for (int i = 0; i < PROBE_ID_LEN; i++) {
      b[PROBE_ID_OFF + i] = (byte) (i < id.length() ? id.charAt(i) : '0');
    }
  }

  /** Ricompositore: tollera doppioni, ordine sparso e pezzi mai arrivati (scadenza). */
  public static final class Reassembler {
    public static final long TTL = 20000L;
    private final Map<Integer, byte[][]> parts = new HashMap<Integer, byte[][]>();
    private final Map<Integer, Long> born = new HashMap<Integer, Long>();
    private final LinkedHashMap<Integer, Long> done = new LinkedHashMap<Integer, Long>();
    /** dimensione attesa del pacchetto ricomposto (0 = qualsiasi) */
    public int expected = PACKET;

    public synchronized byte[] accept(byte[] b, int len, long now) {
      if (!isFrag(b, len)) return null;
      int id = ((b[4] & 0xff) << 24) | ((b[5] & 0xff) << 16) | ((b[6] & 0xff) << 8) | (b[7] & 0xff);
      int idx = b[8] & 0xff;
      int tot = b[9] & 0xff;
      if (tot < 1 || tot > 32 || idx >= tot) return null;
      if (done.containsKey(id)) return null;          // pacchetto gia' ricomposto: doppione
      byte[][] a = parts.get(id);
      if (a == null || a.length != tot) {
        a = new byte[tot][];
        parts.put(id, a);
        born.put(id, Long.valueOf(now));
      }
      byte[] chunk = new byte[len - HDR];
      System.arraycopy(b, HDR, chunk, 0, len - HDR);
      a[idx] = chunk;
      int size = 0;
      for (int i = 0; i < tot; i++) {
        if (a[i] == null) return null;                // manca ancora qualche pezzo
        size += a[i].length;
      }
      byte[] full = new byte[size];
      int off = 0;
      for (int i = 0; i < tot; i++) { System.arraycopy(a[i], 0, full, off, a[i].length); off += a[i].length; }
      parts.remove(Integer.valueOf(id));
      born.remove(Integer.valueOf(id));
      done.put(Integer.valueOf(id), Long.valueOf(now));
      if (done.size() > 512) { Iterator<Integer> it = done.keySet().iterator(); it.next(); it.remove(); }
      if (expected > 0 && size != expected) return null;
      return full;
    }

    public synchronized void sweep(long now) {
      for (Iterator<Map.Entry<Integer, Long>> it = born.entrySet().iterator(); it.hasNext();) {
        Map.Entry<Integer, Long> e = it.next();
        if (now - e.getValue().longValue() > TTL) { parts.remove(e.getKey()); it.remove(); }
      }
      for (Iterator<Map.Entry<Integer, Long>> it = done.entrySet().iterator(); it.hasNext();) {
        if (now - it.next().getValue().longValue() > TTL * 6) it.remove();
      }
    }

    public synchronized int pending() { return parts.size(); }
  }
}
