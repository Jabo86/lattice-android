# Artefatti binari non inclusi (e come rifarli)

Questi file NON sono nel repository: sono output di compilazione o dati generati.
Qui c'è tutto il necessario per ottenerli identici, e l'impronta di quelli usati
nell'APK pubblicato al momento di questa pubblicazione.

| File | SHA-256 | Come si ottiene |
|---|---|---|
| `android/app/libs/libv2ray.aar` | `ba84bad0493194eefe8c53df8085bf7e34e260483b4d92772a873cd82c07ae33` | `bash tools/build-libv2ray.sh` (gomobile su `third_party/libxray`, arm64, build deterministica) |
| `third_party/libxray/assets/geoip.dat` | `7806115947f8a704d347fa103aa83aadc2cd531a72b82c44d991d598ac23eae9` | `bash third_party/libxray/gen_assets.sh` (dati di routing generati dalle liste pubbliche) |
| `third_party/libxray/assets/geosite.dat` | `725397e93d0043146973220c106eb7e53ccbfd39508a63389e9fa0f7d616c06d` | `bash third_party/libxray/gen_assets.sh` (dati di routing generati dalle liste pubbliche) |

Il commit del sorgente di libxray usato è in `third_party/libxray/COMMIT`.
Le dipendenze Go sono fissate da `go.sum`: scaricarle o averle in casa dà gli stessi byte.
