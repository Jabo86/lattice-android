// Richieste in arrivo nelle 12 lingue.
const L = ["it", "en", "zh", "hi", "es", "pt", "ar", "fr", "ru", "de", "ja", "tr"];
const K = {
  "book.incoming": ["Richieste in arrivo", "Incoming requests", "收到的请求", "आई हुई अनुरोध", "Solicitudes recibidas", "Solicitações recebidas", "الطلبات الواردة", "Demandes reçues", "Входящие запросы", "Eingehende Anfragen", "受け取ったリクエスト", "Gelen istekler"],
  "book.incomingFrom": ["{name} ti ha aggiunto in rubrica", "{name} added you to their address book", "{name} 已把你加入通讯录", "{name} ने आपको रूब्रिका में जोड़ा", "{name} te ha añadido a su agenda", "{name} te adicionou à agenda", "أضافك {name} إلى دفتره", "{name} vous a ajouté à son carnet", "{name} добавил вас в свою книгу контактов", "{name} hat dich ins Adressbuch aufgenommen", "{name} さんがあなたをアドレス帳に追加しました", "{name} seni rehbere ekledi"],
  "book.accept": ["Accetta", "Accept", "接受", "स्वीकारें", "Aceptar", "Aceitar", "اقبل", "Accepter", "Принять", "Annehmen", "承認", "Kabul et"],
  "book.waiting": ["In attesa che accetti", "Waiting for them to accept", "等待对方接受", "स्वीकृति की प्रतीक्षा", "Esperando que acepte", "Aguardando aceitar", "في انتظار القبول", "En attente de son accord", "Ждём подтверждения", "Warten auf Zustimmung", "承認を待っています", "Kabul etmesi bekleniyor"],
  "book.ignore": ["Ignora", "Ignore", "忽略", "अनदेखा करें", "Ignorar", "Ignorar", "تجاهل", "Ignorer", "Игнорировать", "Ignorieren", "無視", "Yoksay"],
  "book.ignoreTitle": ["Ignora la richiesta", "Ignore request", "忽略请求", "अनुरोध अनदेखा करें", "Ignorar la solicitud", "Ignorar a solicitação", "تجاهل الطلب", "Ignorer la demande", "Игнорировать запрос", "Anfrage ignorieren", "リクエストを無視", "İsteği yoksay"],
  "book.ignoreAsk": ["Ignorare {name}? Verrà bloccato e non potrà scriverti.", "Ignore {name}? They will be blocked and won't be able to write to you.", "忽略 {name}？该用户将被屏蔽，无法给你发消息。", "{name} को अनदेखा करें? उन्हें ब्लॉक कर दिया जाएगा और वे आपको संदेश नहीं भेज पाएंगे.", "¿Ignorar a {name}? Será bloqueado y no podrá escribirte.", "Ignorar {name}? Será bloqueado e não poderá te escrever.", "تجاهل {name}؟ سيتم حظره ولن يتمكن من مراسلتك.", "Ignorer {name} ? Il sera bloqué et ne pourra plus vous écrire.", "Игнорировать {name}? Пользователь будет заблокирован и не сможет вам писать.", "{name} ignorieren? Die Person wird blockiert und kann dir nicht schreiben.", "{name} を無視しますか？ブロックされ、メッセージを送れなくなります。", "{name} yoksayılsın mı? Engellenecek ve sana yazamayacak."],
  "book.cancel": ["Annulla", "Cancel", "取消", "रद्द करें", "Cancelar", "Cancelar", "إلغاء", "Annuler", "Отмена", "Abbrechen", "キャンセル", "İptal"],
};
export const REQ12 = (() => {
  const out = {};
  L.forEach((c, i) => { const p = {}; Object.keys(K).forEach((k) => { p[k] = K[k][i] || K[k][0]; }); out[c] = p; });
  return out;
})();
