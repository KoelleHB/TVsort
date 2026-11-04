# TVsort

Ein lokaler, browserbasierter Favoriten-Editor für Philips `PhilipsChannelMaps/ChannelMap_110` – entwickelt für ChromeOS, ohne Wine und ohne Backend.

## Funktionen (MVP)

- Import eines vollständigen `PhilipsChannelMaps`-Ordners oder einer ZIP-Datei
- Liest `ChannelList/s2channellib/DVBS.xml` und `ChannelList/Favorite.xml`
- Dekodiert Philips-Sendernamen aus Hex/UTF-16LE
- Suche in allen Satellitensendern; Zuordnung über `Broadcast.UniqueID`
- Favoritenliste 1 hinzufügen, entfernen, mit Pfeiltasten oder Drag & Drop sortieren
- Undo, Reset und Konsistenzprüfung
- Vollständiger ZIP-Export mit allen ursprünglichen Dateien, nur `Favorite.xml` wird bei Änderungen angepasst
- Kein Upload, kein Backend, keine Telemetrie

## Start

Die Webapp ist eine statische `index.html`. Entweder direkt im Browser öffnen oder im Projektordner `python3 -m http.server 8000` ausführen und `http://localhost:8000` aufrufen. Für ZIP-Dateien lädt die Seite JSZip 3.10.1 von jsDelivr; für den Ordnerimport ist diese Bibliothek nicht erforderlich.

### Philips-Export vorbereiten

Vom Fernseher vollständigen Ordner `PhilipsChannelMaps` exportieren und **unverändert sichern**. In TVsort über **Ordner öffnen** diesen Ordner auswählen; alternativ den kompletten Ordner als ZIP-Datei bereitstellen.

Nach dem Bearbeiten **Gesamten Export als ZIP speichern**. Erst nach sorgfältiger Überprüfung der erzeugten Dateien das ZIP entpacken und den Ordner `PhilipsChannelMaps` auf den USB-Stick kopieren.

## Wichtige Sicherheitshinweise

- **Experimentelle Exportfunktion**: Ein erfolgreicher XML-Export bedeutet nicht, dass Philips die Datei importiert. Die Rückimportfähigkeit wurde noch nicht am TV verifiziert.
- Original-Backups behalten; vor einem TV-Import die ZIP-Dateien und die Favoritenliste prüfen.
- Keine Manipulation an `channelFile.bin`, `chanLst.bin`, Sendernummern oder Empfangsdaten. Alle übrigen Dateien bleiben byteweise unverändert.
- Es wird ausschließlich `ChannelMap_110` unterstützt. Andere Philips-Formate werden bewusst abgelehnt.
- Der Import in den Fernseher ist ein **manueller, risikobehafteter Schritt**. TVsort greift nie direkt auf den TV zu.

## Technisches

Vanilla JavaScript mit DOMParser, JSZip für ZIP-Container, vollständig clientseitig. Für spätere Versionen sind automatisierte Tests mit echten anonymisierten Testexports, Erweiterung um die anderen Favoritenlisten und eine dokumentierte Rückimportprüfung vorgesehen.

### Referenz

- [ChanSort](https://github.com/PredatH0r/ChanSort) – funktionale Orientierung und Dokumentation. Kein ChanSort-Code übernommen.
- [ChanSort – unterstützte Philips-Dateiformate](https://github.com/PredatH0r/ChanSort/blob/master/source/fileformats.md)

TVsort ist ein unabhängiges Projekt und nicht mit Philips oder ChanSort verbunden.
