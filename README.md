# TVsort

Ein browserbasierter Favoriten-Editor für Philips `PhilipsChannelMaps/ChannelMap_110` – entwickelt für ChromeOS, ohne Wine. Wahlweise statisch oder mit lokaler ADB-Bridge.

## Funktionen (MVP)

- Import eines vollständigen `PhilipsChannelMaps`-Ordners oder einer ZIP-Datei
- Liest `ChannelList/s2channellib/DVBS.xml` und `ChannelList/Favorite.xml`
- Dekodiert Philips-Sendernamen aus Hex/UTF-16LE
- Suche in allen Satellitensendern mit vollständiger Seitennavigation (100 Einträge pro Seite); Zuordnung über `Broadcast.UniqueID`
- Favoritenliste 1 hinzufügen, entfernen, mit Pfeiltasten oder Drag & Drop sortieren
- Undo, Reset und Konsistenzprüfung
- Vollständiger ZIP-Export mit allen ursprünglichen Dateien, nur `Favorite.xml` wird bei Änderungen angepasst
- Kein Upload, kein Backend, keine Telemetrie

## Start

Die Webapp ist eine statische `index.html`. Entweder direkt im Browser öffnen oder im Projektordner `python3 -m http.server 8000` ausführen und `http://localhost:8000` aufrufen. Für ZIP-Dateien lädt die Seite JSZip 3.10.1 von jsDelivr; für den Ordnerimport ist diese Bibliothek nicht erforderlich.

### Philips-Export vorbereiten

Vom Fernseher vollständigen Ordner `PhilipsChannelMaps` exportieren und **unverändert sichern**. In TVsort über **Ordner öffnen** diesen Ordner auswählen; alternativ den kompletten Ordner als ZIP-Datei bereitstellen.

Nach dem Bearbeiten **Gesamten Export als ZIP speichern**. Erst nach sorgfältiger Überprüfung der erzeugten Dateien das ZIP entpacken und den Ordner `PhilipsChannelMaps` auf den USB-Stick kopieren.

## ChromeOS: TVsort mit lokaler Direktverbindung (empfohlen)

TVsort kann die Oberfläche und einen ADB-Helfer **unter derselben lokalen Adresse** starten. Dadurch entfallen Downloads, ZIP-Entpacken und Terminalbefehle bei jedem Senderlistenwechsel.

```bash
cd ~/TVsort
git pull
python3 tools/tvsort_server.py
```

In Chrome auf dem Chromebook **http://localhost:8765** öffnen (nicht die GitHub-Pages-Adresse).

Der Kasten **„Direktverbindung zum Philips“** bietet:
- **Vom USB laden**: Liest die bereits per Philips-Menü auf den TVsort-Stick exportierte Senderliste via ADB und erstellt gleichzeitig ein lokales Originalbackup.
- **Backup erstellen**: Speichert die komplette USB-Senderliste erneut als datiertes Backup.
- **Auf USB übertragen**: Nach expliziter Rückfrage prüft der Server die vollständige ZIP-Datei, die unveränderten neun übrigen Dateien, die Zuordnung der Sender-IDs sowie den aktuellen USB-Ausgangszustand. Er erstellt erneut ein Backup, schreibt ausschließlich `Favorite.xml` und liest sie zur Prüfsumme zurück.

**Wichtig:** „Vom USB laden“ liest den **USB-Export**, nicht die interne Philips-Senderdatenbank. Für einen aktuellen Stand auf dem TV vorher **Senderliste kopieren → Auf USB kopieren** ausführen. Nach „Auf USB übertragen“ auf dem TV **Auf Fernseher kopieren** wählen. Diese Philips-Menüschritte sind weiterhin manuell.

**Sicherheit:** Der Server bindet ausschließlich an `127.0.0.1:8765`, verwendet Same-Origin, einen Sitzungstoken sowie eine zusätzliche Schreibbestätigung. Er ist kein öffentlich erreichbarer Dienst. Alle Dateien bleiben lokal. Beim Beenden im Terminal **Strg+C** drücken. Nicht über Portfreigaben, öffentliche Tunnel oder Proxy-Dienste exponieren.

Für den lokalen Webserver sind nur Python 3 und ADB nötig; die Oberfläche verwendet JSZip von einem CDN und benötigt hierfür gegebenenfalls Internet. Bestehende USB-ID: `0F0B-2C4A`; bei Änderung `python3 tools/tvsort_server.py --volume XXXX-XXXX`. Die Backup-Dateien liegen unter `~/philips-debloat/channelmaps/bridge-backups/`.

## ChromeOS: automatisierter USB-Transfer mit TVsort Bridge

Die Oberfläche bleibt eine Webapp. Das lokale Python-Tool `tools/tvsort_bridge.py` übernimmt sichere ADB-Aktionen, die eine gehostete Webseite nicht direkt ausführen kann.

Voraussetzungen: `python3`, `adb`, bestehende ADB-Verbindung und ein angeschlossener USB-Stick mit bereits per Philips-Menü exportierter `PhilipsChannelMaps`-Struktur. **Nicht** auf Timeshift- oder als Android-Speicher formatierten USB-Sticks verwenden.

Im Linux-Terminal, im ausgecheckten TVsort-Repository:

```bash
python3 tools/tvsort_bridge.py status
python3 tools/tvsort_bridge.py backup
python3 tools/tvsort_bridge.py apply /mnt/chromeos/MyFiles/Downloads/TVsort-PhilipsChannelMaps-ChannelMap_110.zip
```

Die Bridge nutzt standardmäßig die TVsort-USB-ID `0F0B-2C4A`; mit `--volume XXXX-XXXX` ist sie konfigurierbar. Sie verifiziert die ADB-Verbindung und den eingebundenen öffentlichen USB-Datenträger, zieht vor dem Schreiben **alle 10 Originaldateien** als datiertes Backup, überprüft ZIP, Sender-IDs und die übrigen neun Dateien auf Bytegleichheit, fragt ausdrücklich nach `JA`, schreibt ausschließlich `Favorite.xml` und prüft die Daten danach per Rückleseprüfung. Falls auch andere Dateien abweichen, verweigert die Bridge den Transfer. Sie führt **keinen** Import in die TV-interne Datenbank aus.

Datenpfad der Backups: `~/philips-debloat/channelmaps/bridge-backups/`.

**Aus Sicherheitsgründen bleibt der offizielle Philips-Import am Fernseher ein manueller Schritt.** Ein Start des TV-USB-Exports via ADB ist noch nicht implementiert.

## Wichtige Sicherheitshinweise

- **Rückimport mit deinem 50PUS8804**: Eine erste reine Favoriten-Änderung in `Favorite.xml` wurde erfolgreich am Gerät importiert. Diese Erfahrung garantiert nicht die Kompatibilität aller künftigen Änderungen.
- Original-Backups behalten; vor einem TV-Import die ZIP-Dateien und die Favoritenliste prüfen.
- Keine Manipulation an `channelFile.bin`, `chanLst.bin`, Sendernummern oder Empfangsdaten. Alle übrigen Dateien bleiben byteweise unverändert.
- Es wird ausschließlich `ChannelMap_110` unterstützt. Andere Philips-Formate werden bewusst abgelehnt.
- Der Import in den Fernseher ist ein **manueller, risikobehafteter Schritt**. Die Webapp greift nie direkt auf den TV zu; die optionale lokale Bridge nutzt ADB ausschließlich für die USB-Dateien.

## Technisches

Vanilla JavaScript mit DOMParser, JSZip für ZIP-Container, vollständig clientseitig. Für spätere Versionen sind automatisierte Tests mit echten anonymisierten Testexports, Erweiterung um die anderen Favoritenlisten und eine dokumentierte Rückimportprüfung vorgesehen.

### Referenz

- [ChanSort](https://github.com/PredatH0r/ChanSort) – funktionale Orientierung und Dokumentation. Kein ChanSort-Code übernommen.
- [ChanSort – unterstützte Philips-Dateiformate](https://github.com/PredatH0r/ChanSort/blob/master/source/fileformats.md)

TVsort ist ein unabhängiges Projekt und nicht mit Philips oder ChanSort verbunden.
