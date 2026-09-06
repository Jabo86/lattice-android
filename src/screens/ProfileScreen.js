import React, { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator, Alert, Share, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pickAvatarDataUrl } from "../lib/avatar";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { UI_LANGS } from "../lib/locales";
import * as api from "../lib/api";
import { theme } from "../theme";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { api.myProfile().then(setP).catch(() => {}); }, []);

  // La foto viene salvata SUBITO dopo la scelta: se l'app si riblocca o si chiude prima
  // che l'utente prema SALVA, la foto non va persa.
  const pickAvatar = async () => {
    const { denied, dataUrl, error } = await pickAvatarDataUrl();
    if (denied) { Alert.alert(t("profile.avatar.denied"), t("profile.avatar.deniedText")); return; }
    if (error) { Alert.alert(t("att.error"), lang === "en" ? "Could not read the photo." : "Non riesco a leggere la foto."); return; }
    if (!dataUrl) return;
    setP((x) => ({ ...x, avatar: dataUrl }));
    await save({ avatar: dataUrl });
  };

  const save = async (over) => {
    setBusy(true);
    try {
      await api.saveProfile({ headline: p.headline || "", bio: p.bio || "", avatar: p.avatar || "", is_public: !!p.is_public, ...(over || {}) });
      if (p.personal) { try { await api.personalDiscoverable(!!p.discoverable); } catch { /* opzionale */ } }
      setSaved(true); setTimeout(() => setSaved(false), 1800);
    } catch (e) { Alert.alert(t("att.error"), api.apiErr(e)); }
    finally { setBusy(false); }
  };

  // Condivide il biglietto da visita pubblico (card.html): chi lo apre può scriverti.
  const shareProfile = async () => {
    const me = String(p?.lns || "");
    const url = `${api.getServerUrl()}/card.html?u=${encodeURIComponent(me)}`;
    try {
      await Share.share({
        message: (lang === "en" ? "Contact me in end-to-end encrypted chat on Lattice Network:\n" : "Contattami in chat cifrata end-to-end su Lattice Network:\n") + url,
        url,
      });
    } catch (e) { /* annullato */ }
  };

  if (!p) return <View style={s.loading}><ActivityIndicator color={theme.primary} /></View>;
  const roleLabel = t(`role.${p.role || "member"}`);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "transparent" }} contentContainerStyle={{ padding: 20, paddingTop: 16, paddingBottom: 40 }}>
      <View style={s.headRow}>
        <TouchableOpacity onPress={pickAvatar} style={s.avatarBtn} testID="profile-avatar-btn">
          {p.avatar ? <Image source={{ uri: p.avatar }} style={s.avatarImg} /> : <Text style={s.avatarLetter}>{(p.display_name?.[0] || "?").toUpperCase()}</Text>}
          <Text style={s.avatarEdit}>{lang === "en" ? "CHANGE" : "CAMBIA"}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{p.display_name}</Text>
          <Text style={s.lns}>{p.lns}</Text>
          <Text style={s.role}>{roleLabel}</Text>
        </View>
      </View>

      <Text style={s.label}>{t("profile.language")}</Text>
      <View style={s.langRow}>
        {UI_LANGS.map((l) => (
          <TouchableOpacity key={l.code} onPress={() => setLang(l.code)} style={[s.langBtn, lang === l.code && s.langBtnActive]} testID={`lang-${l.code}`}>
            <Text style={[s.langText, lang === l.code && s.langTextActive]}>{l.flag + "  " + l.native}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>{t("profile.headline")}</Text>
      <TextInput value={p.headline || ""} onChangeText={(v) => setP({ ...p, headline: v })} placeholder={t("profile.headline.ph")} placeholderTextColor={theme.textFaint} style={s.input} testID="profile-headline" />

      <Text style={s.label}>{t("profile.bio")}</Text>
      <TextInput value={p.bio || ""} onChangeText={(v) => setP({ ...p, bio: v })} placeholder={t("profile.bio.ph")} placeholderTextColor={theme.textFaint} style={[s.input, { height: 100, textAlignVertical: "top" }]} multiline testID="profile-bio" />

      <TouchableOpacity onPress={() => setP({ ...p, is_public: !p.is_public })} style={[s.visBtn, { borderColor: p.is_public ? "#50C878" : "#ff9100" }]} testID="profile-visibility">
        <Text style={{ color: p.is_public ? "#50C878" : "#ffb958", fontWeight: "700", fontSize: 13 }}>
          {p.is_public ? t("profile.visible") : t("profile.hidden")}
        </Text>
      </TouchableOpacity>
      <Text style={s.hint}>{p.is_public ? t("profile.visible.hint") : t("profile.hidden.hint")}</Text>

      {!!p.personal && (
        <>
          <Text style={s.label}>{lang === "en" ? "PUBLIC DIRECTORY" : "DIRECTORY PUBBLICA"}</Text>
          <TouchableOpacity onPress={() => setP({ ...p, discoverable: !p.discoverable })}
            style={[s.visBtn, { borderColor: p.discoverable ? "#50C878" : "#ff9100" }]} testID="profile-discoverable">
            <Text style={{ color: p.discoverable ? "#50C878" : "#ffb958", fontWeight: "700", fontSize: 13 }}>
              {p.discoverable
                ? (lang === "en" ? "FINDABLE BY USERNAME" : "TROVABILE DAL NOME UTENTE")
                : (lang === "en" ? "HIDDEN FROM SEARCH" : "NASCOSTO DALLE RICERCHE")}
            </Text>
          </TouchableOpacity>
          <Text style={s.hint}>
            {p.discoverable
              ? (lang === "en" ? "Others can find you in the Lattice directory and add you as a contact." : "Gli altri possono trovarti nella directory Lattice e aggiungerti ai contatti.")
              : (lang === "en" ? "You can only be contacted by those who already know your Lattice address." : "Puoi essere contattato solo da chi conosce già il tuo indirizzo Lattice.")}
          </Text>
        </>
      )}

      <TouchableOpacity onPress={() => save()} disabled={busy} style={[s.saveBtn, busy && { opacity: 0.6 }]} testID="profile-save">
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>{saved ? t("profile.saved") : t("profile.save")}</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={shareProfile} style={s.shareBtn} testID="profile-share">
        <Text style={s.shareText}>{lang === "en" ? "SHARE MY PROFILE" : "CONDIVIDI IL MIO PROFILO"}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={signOut} style={s.signout} testID="profile-signout">
        <Text style={s.signoutText}>{t("signout")}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, backgroundColor: "transparent", alignItems: "center", justifyContent: "center" },
  h1: { color: theme.text, fontSize: 24, fontWeight: "900", marginBottom: 18 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  avatarBtn: { width: 92, height: 92, borderRadius: 46, overflow: "hidden", backgroundColor: "rgba(80,200,120,0.15)", borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center" },
  avatarImg: { width: "100%", height: "100%" },
  avatarLetter: { color: theme.primary, fontSize: 34, fontWeight: "800" },
  avatarEdit: { position: "absolute", bottom: 0, left: 0, right: 0, textAlign: "center", backgroundColor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 9, paddingVertical: 3, letterSpacing: 1 },
  name: { color: theme.text, fontSize: 20, fontWeight: "800" },
  lns: { color: "#50C878", fontSize: 12, marginTop: 2 },
  role: { color: theme.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 3 },
  label: { color: theme.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginTop: 20, marginBottom: 6 },
  input: { backgroundColor: theme.surfaceAlt, borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  langRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  langBtn: { flexGrow: 1, flexBasis: "44%", borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingVertical: 11, alignItems: "center", backgroundColor: theme.surfaceAlt },
  langBtnActive: { borderColor: theme.primary, backgroundColor: "rgba(80,200,120,0.15)" },
  langText: { color: theme.textDim, fontWeight: "700", fontSize: 14 },
  langTextActive: { color: theme.text },
  visBtn: { marginTop: 20, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  hint: { color: theme.textFaint, fontSize: 12, marginTop: 6 },
  saveBtn: { marginTop: 24, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 15, alignItems: "center" },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  signout: { marginTop: 18, alignItems: "center" },
  shareBtn: { marginTop: 12, borderWidth: 1, borderColor: theme.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  shareText: { color: theme.primary, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  signoutText: { color: theme.textFaint, fontSize: 13, fontWeight: "600" },
});
