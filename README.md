# Pocket Arcade

Pocket Arcade ist eine Angular-Webseite für lokale Game-Boy-, Game-Boy-Advance-, Nintendo-DS- und Nintendo-3DS-ROMs. EmulatorJS läuft in einem eigenen iframe. Die ROM-Bibliothek, Einstellungen und Save-States werden lokal in IndexedDB gespeichert.

## Starten

```sh
npm install
npm start
```

Der Entwicklungsserver startet die App.

## Produktionsbuild und PWA-Vorschau

Erzeuge einen Produktionsbuild und starte anschließend die statische Vorschau:

```sh
npm run build
npm run preview
```

Öffne danach [http://127.0.0.1:4300](http://127.0.0.1:4300).

Die installierbare PWA speichert App-Dateien und EmulatorJS-Ressourcen im Offline-Cache, nachdem sie online geladen wurden. ROMs und Emulator-Kerne sind nicht im Projekt enthalten. EmulatorJS wird vom CDN geladen und muss vor dem ersten Offline-Start online verfügbar gewesen sein.

## Funktionen

- Lokale Spielebibliothek mit internem Spieletitel, ROM-Prüfung, CRC32, Dateigröße, Spielzeit und zuletzt gespielt
- Save-State-Slots 1 bis 3 mit Screenshot und Zeitstempel
- Automatisches Fortsetzen des zuletzt verwendeten Save-States
- Import und Export von Save-States
- USB- und Bluetooth-Gamepads über EmulatorJS
- Umschaltbare oder frei belegbare Tastatursteuerung
- Bildfilter, Seitenverhältnis und Vollbildmodus
- DS- und 3DS-Anzeige mit Touchscreen-Fokus
- Installierbare PWA mit zwischengespeicherter Oberfläche und EmulatorJS-Dateien

## Unterstützte Dateien

| Dateiendung | System |
| --- | --- |
| `.gb\`, `.gbc\` | Game Boy / Game Boy Color |
| `.gba\` | Game Boy Advance |
| `.nds\` | Nintendo DS |
| `.3ds\`, `.cci\`, `.cxi\` | Nintendo 3DS über den EmulatorJS-/Azahar-Core |
| `.zip\` | Archiv mit einer oder mehreren unterstützten ROM-Dateien |

## ROM-Prüfung und Kompatibilität

Beim Laden prüft die Anwendung ROM-Header und formatspezifische Prüfsummen. Bei DS-ROMs werden zusätzlich die Programmabschnitte geprüft, bei 3DS-ROMs die NCSD-/NCCH-Kennung.

CRC32 dient als Fingerabdruck einer Datei. Es ist kein vollständiger Abgleich mit einer bekannten ROM-Datenbank.

3DS-Spiele benötigen deutlich mehr Rechenleistung. Je nach Spiel und Browser können sie langsam laufen oder inkompatibel sein.

## Lokale Speicherung

Bibliothek, Einstellungen und Save-States bleiben in IndexedDB auf diesem Gerät. Der Browser-Speicher ist an den verwendeten Browser und die Website-Adresse gebunden. Ein Wechsel des Browsers oder der Website-Adresse greift daher nicht automatisch auf dieselben Daten zu.

