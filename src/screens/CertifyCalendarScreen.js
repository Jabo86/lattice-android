import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const MONTHS = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const WD = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];

export default function CertifyCalendarScreen() {
  const { t } = useI18n();
  const [data, setData] = useState({ notes: [], mails: [] });
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("month");
  const [cursor, setCursor] = useState(new Date());
  const [selDate, setSelDate] = useState(ymd(new Date()));
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.certifyNotes().then((d) => setData({ notes: d.notes || [], mails: d.mails || [] })).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const map = {};
    const push = (k, item) => { if (k) (map[k] = map[k] || []).push(item); };
    (data.notes || []).forEach((n) => push(n.date, { ...n, kind: "note" }));
    (data.mails || []).forEach((m) => push((m.date || "").slice(0, 10), { ...m, kind: "mail" }));
    return map;
  }, [data]);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { await api.certifyAddNote({ date: selDate, title, text }); setTitle(""); setText(""); setShowAdd(false); load(); }
    catch (e) { Alert.alert("Certify", api.apiErr(e)); } finally { setBusy(false); }
  };
  const remove = async (id) => { try { await api.certifyDelNote(id); load(); } catch {} };

  const nav = (dir) => {
    const c = new Date(cursor);
    if (view === "month") c.setMonth(c.getMonth() + dir);
    else if (view === "week") c.setDate(c.getDate() + dir * 7);
    else c.setDate(c.getDate() + dir);
    setCursor(c);
    if (view !== "month") setSelDate(ymd(c));
  };
  const goToday = () => { const d = new Date(); setCursor(d); setSelDate(ymd(d)); };

  const monthCells = useMemo(() => {
    const start = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [cursor]);
  const weekCells = useMemo(() => { const s = startOfWeek(cursor); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }, [cursor]);
  const todayStr = ymd(new Date());

  const label = view === "month" ? `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`
    : view === "week" ? (() => { const s = startOfWeek(cursor), e = addDays(s, 6); return `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)}`; })()
    : `${cursor.getDate()} ${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const mailLabel = (it) => (it.direction === "sent" ? `${t("certify.certTo")} ${it.counterparty || ""}` : `${t("certify.certFrom")} ${it.counterparty || ""}`);
  const dayItems = (byDate[selDate] || []).slice().sort((a, b) => ((a.sealed_at || "") > (b.sealed_at || "") ? 1 : -1));

  return (
    <View style={styles.root}>
      <View style={styles.topBar}>
        <View style={styles.navGroup}>
          <TouchableOpacity onPress={() => nav(-1)} style={styles.navBtn} testID="cal-prev"><Ionicons name="chevron-back-outline" size={18} color={theme.textDim} /></TouchableOpacity>
          <TouchableOpacity onPress={goToday} style={styles.todayBtn} testID="cal-today"><Text style={styles.todayTxt}>{t("certify.today")}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => nav(1)} style={styles.navBtn} testID="cal-next"><Ionicons name="chevron-forward-outline" size={18} color={theme.textDim} /></TouchableOpacity>
        </View>
        <Text style={styles.label} numberOfLines={1}>{label}</Text>
      </View>

      <View style={styles.viewToggle}>
        {[["month", t("certify.viewMonth")], ["week", t("certify.viewWeek")], ["day", t("certify.viewDay")]].map(([v, l]) => (
          <TouchableOpacity key={v} style={[styles.viewBtn, view === v && styles.viewBtnActive]} onPress={() => setView(v)} testID={`cal-view-${v}`}>
            <Text style={[styles.viewTxt, view === v && { color: "#fff" }]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator color={theme.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          {view === "month" && (
            <View>
              <View style={styles.wdRow}>{WD.map((w) => <Text key={w} style={styles.wd}>{w}</Text>)}</View>
              <View style={styles.grid}>
                {monthCells.map((d) => {
                  const key = ymd(d);
                  const items = byDate[key] || [];
                  const dim = d.getMonth() !== cursor.getMonth();
                  return (
                    <TouchableOpacity key={key} style={[styles.cell, key === selDate && styles.cellSel]} onPress={() => { setSelDate(key); setView("day"); }} testID={`cal-day-${key}`}>
                      <Text style={[styles.cellNum, key === todayStr && styles.cellToday, dim && { opacity: 0.35 }]}>{d.getDate()}</Text>
                      <View style={styles.dots}>
                        {items.slice(0, 3).map((it, i) => <View key={i} style={[styles.dot, { backgroundColor: it.kind === "mail" ? "#ff9100" : theme.primary }]} />)}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {view === "week" && weekCells.map((d) => {
            const key = ymd(d); const items = byDate[key] || [];
            return (
              <TouchableOpacity key={key} style={[styles.weekRow, key === selDate && { borderColor: theme.primary }]} onPress={() => { setSelDate(key); setView("day"); }} testID={`cal-week-${key}`}>
                <View style={styles.weekDate}><Text style={styles.weekWd}>{WD[(d.getDay() + 6) % 7]}</Text><Text style={[styles.weekNum, key === todayStr && styles.cellToday]}>{d.getDate()}</Text></View>
                <View style={{ flex: 1 }}>
                  {items.length === 0 ? <Text style={styles.weekEmpty}>—</Text> : items.map((it, i) => (
                    <Text key={i} style={[styles.weekItem, { color: it.kind === "mail" ? "#ffb958" : theme.primary }]} numberOfLines={1}>{it.kind === "mail" ? mailLabel(it) : it.title}</Text>
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}

          {view === "day" && (
            <View>
              <Text style={styles.dayTitle}>{new Date(selDate + "T00:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</Text>
              {dayItems.length === 0 && <Text style={styles.noApp}>{t("certify.noAppointments")}</Text>}
              {dayItems.map((it, i) => (
                <View key={i} style={styles.agenda} testID={`cal-agenda-${it.kind}`}>
                  <Ionicons name={it.kind === "mail" ? "shield-checkmark" : "calendar"} size={16} color={it.kind === "mail" ? "#ff9100" : theme.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.agendaTitle}>{it.kind === "mail" ? mailLabel(it) : it.title}</Text>
                    {it.kind === "mail" ? <Text style={styles.agendaSub}>{it.subject || "—"}</Text> : it.text ? <Text style={styles.agendaSub}>{it.text}</Text> : null}
                  </View>
                  {it.kind === "note" && <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8}><Ionicons name="trash-outline" size={16} color={theme.textFaint} /></TouchableOpacity>}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {showAdd ? (
        <View style={styles.addPanel}>
          <TextInput style={styles.addInput} placeholder={t("certify.noteTitle")} placeholderTextColor={theme.textFaint} value={title} onChangeText={setTitle} testID="cal-note-title" />
          <TextInput style={styles.addInput} placeholder={t("certify.notesPlaceholder")} placeholderTextColor={theme.textFaint} value={text} onChangeText={setText} testID="cal-note-text" />
          <View style={styles.addBtns}>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}><Text style={styles.cancelTxt}>{t("cancel")}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={create} disabled={busy} testID="cal-note-save">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.saveTxt}>{t("certify.add")}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.fab} onPress={() => setShowAdd(true)} testID="cal-new-note"><Ionicons name="add-outline" size={26} color="#fff" /></TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, gap: 10 },
  navGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  navBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  todayBtn: { paddingHorizontal: 12, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  todayTxt: { color: theme.textDim, fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  label: { color: theme.text, fontSize: 16, fontWeight: "800", flex: 1, textAlign: "right", textTransform: "capitalize" },
  viewToggle: { flexDirection: "row", margin: 14, backgroundColor: theme.surface, borderRadius: 10, padding: 4 },
  viewBtn: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: "center" },
  viewBtnActive: { backgroundColor: theme.primary },
  viewTxt: { color: theme.textDim, fontWeight: "700", fontSize: 13 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wdRow: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: theme.textFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase", paddingBottom: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, aspectRatio: 0.85, borderWidth: 0.5, borderColor: theme.border, padding: 4 },
  cellSel: { backgroundColor: "rgba(80,200,120,0.12)" },
  cellNum: { color: theme.textDim, fontSize: 12 },
  cellToday: { color: "#fff", backgroundColor: theme.primary, borderRadius: 10, width: 20, height: 20, textAlign: "center", overflow: "hidden", lineHeight: 20 },
  dots: { flexDirection: "row", gap: 2, marginTop: 3, flexWrap: "wrap" },
  dot: { width: 5, height: 5, borderRadius: 3 },
  weekRow: { flexDirection: "row", gap: 12, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, marginBottom: 8 },
  weekDate: { alignItems: "center", width: 40 },
  weekWd: { color: theme.textFaint, fontSize: 10, textTransform: "uppercase" },
  weekNum: { color: theme.text, fontSize: 18, fontWeight: "800", marginTop: 2 },
  weekEmpty: { color: theme.textFaint },
  weekItem: { fontSize: 12, fontWeight: "600", marginBottom: 2 },
  dayTitle: { color: theme.text, fontSize: 18, fontWeight: "800", marginBottom: 12, textTransform: "capitalize" },
  noApp: { color: theme.textFaint, textAlign: "center", paddingVertical: 30 },
  agenda: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: theme.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  agendaTitle: { color: theme.text, fontSize: 14, fontWeight: "600" },
  agendaSub: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  addPanel: { position: "absolute", left: 12, right: 12, bottom: 20, backgroundColor: theme.surfaceAlt, borderRadius: 14, borderWidth: 1, borderColor: theme.border, padding: 14, gap: 10 },
  addInput: { backgroundColor: "transparent", borderRadius: 8, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, color: theme.text },
  addBtns: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 10 },
  cancelTxt: { color: theme.textDim, fontWeight: "700" },
  saveBtn: { backgroundColor: theme.primary, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, minWidth: 80, alignItems: "center" },
  saveTxt: { color: "#fff", fontWeight: "800" },
  fab: { position: "absolute", right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", elevation: 6 },
});
