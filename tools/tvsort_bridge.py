#!/usr/bin/env python3
"""TVsort Bridge: conservative ADB USB backup and Favorite.xml deployment.

No direct modification of the TV's internal channel databases.
"""
import argparse
import hashlib
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZipFile, BadZipFile
import xml.etree.ElementTree as ET

DEFAULT_VOLUME = "0F0B-2C4A"
ROOT = "PhilipsChannelMaps/ChannelMap_110/ChannelList/"
FAVORITE = ROOT + "Favorite.xml"
EXPECTED = {
    ROOT + "Favorite.xml",
    ROOT + "LNBs.txt",
    ROOT + "chanLst.bin",
    ROOT + "channelFile.bin",
    ROOT + "channellib/DVBC.xml",
    ROOT + "channellib/DVBT.xml",
    ROOT + "logo.txt",
    ROOT + "s2channellib/DVBS.xml",
    ROOT + "s2channellib/DVBSall.xml",
    ROOT + "satInfo.bin",
}

def adb(*args, capture=False):
    run = subprocess.run(["adb", *args], check=True, text=True,
                         capture_output=capture)
    return run.stdout if capture else None

def mounted_volume(volume):
    if not (len(volume) == 9 and volume[4] == "-" and
            all(c in "0123456789ABCDEFabcdef" for c in volume.replace("-", ""))):
        raise ValueError("Ungültige Volume-ID.")
    listing = adb("shell", "sm", "list-volumes", "all", capture=True)
    lines = [s.split() for s in listing.splitlines()]
    matches = [parts for parts in lines if len(parts) >= 3 and
               parts[0].startswith("public:") and parts[1] == "mounted" and
               parts[2].upper() == volume.upper()]
    if len(matches) != 1:
        raise RuntimeError(f"USB-Volume {volume} nicht eindeutig als public/mounted erkannt.\n{listing}")
    return "/storage/" + volume

def check_device():
    devices = [line.split() for line in adb("devices", capture=True).splitlines()[1:] if line.strip()]
    ready = [line for line in devices if len(line) > 1 and line[1] == "device"]
    if len(ready) != 1:
        raise RuntimeError("Genau ein aktives ADB-Gerät erforderlich.")
    print("ADB-Gerät:", ready[0][0])

def backup(volume, folder):
    remote = mounted_volume(volume) + "/PhilipsChannelMaps"
    folder.mkdir(parents=True, exist_ok=False)
    print("Lese vollständigen TV-Export vom USB ...")
    adb("pull", remote, str(folder))
    base = folder / "PhilipsChannelMaps"
    for rel in EXPECTED:
        path = folder / rel
        if not path.is_file():
            raise RuntimeError(f"Fehlende Originaldatei im Backup: {rel}")
    print("Backup vollständig:", base)
    return folder

def sha(data):
    return hashlib.sha256(data).hexdigest()

def ordered_favorites(data):
    root = ET.fromstring(data)
    lists = [l for l in root.iter("FavoriteList") if l.get("Index") == "1"]
    if len(lists) != 1:
        raise RuntimeError("Favoritenliste 1 fehlt oder ist mehrfach vorhanden.")
    entries = []
    for element in lists[0].findall("FavoriteChannel"):
        uid = element.findtext("UniqueID")
        number = element.findtext("FavNumber")
        if not uid or number is None:
            raise RuntimeError("Ungültiger Favoriteneintrag.")
        entries.append((int(number), uid))
    if sorted(p for p, _ in entries) != list(range(len(entries))):
        raise RuntimeError("Favoritenpositionen nicht lückenlos.")
    if len({uid for _, uid in entries}) != len(entries):
        raise RuntimeError("Doppelte Favoriten-ID.")
    return [uid for _, uid in sorted(entries)]

def inspect_zip(filename):
    with ZipFile(filename) as archive:
        if archive.testzip():
            raise RuntimeError("ZIP-Integrität fehlerhaft.")
        names = {name for name in archive.namelist() if not name.endswith("/")}
        if names != EXPECTED:
            missing = EXPECTED - names
            extra = names - EXPECTED
            raise RuntimeError(f"Unerwartete ZIP-Dateien. Fehlend: {missing}; zusätzlich: {extra}")
        if any(not name.startswith("PhilipsChannelMaps/") or ".." in Path(name).parts for name in names):
            raise RuntimeError("Unsichere ZIP-Pfade.")
        return {name: archive.read(name) for name in EXPECTED}

def deploy(volume, filename, backups_dir, confirmed=False):
    check_device()
    remote = mounted_volume(volume)
    proposed = inspect_zip(filename)
    current_favs = ordered_favorites(proposed[FAVORITE])
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backups_dir / ("before-write-" + stamp)
    # A complete TV USB export is saved before any modification.
    original_dir = backup(volume, backup_path)
    original = {rel: (original_dir / rel).read_bytes() for rel in EXPECTED}
    original_favs = ordered_favorites(original[FAVORITE])
    changes = [rel for rel in EXPECTED if sha(proposed[rel]) != sha(original[rel])]
    print("Abweichende Dateien:", changes or "keine")
    print("Favoriten vorher:", len(original_favs), "| nachher:", len(current_favs))
    if not changes:
        raise RuntimeError("Keine Änderungen gegenüber dem USB-Export gefunden.")
    if changes != [FAVORITE]:
        raise RuntimeError("Abbruch: Erwartet wird ausschließlich eine geänderte Favorite.xml. "
                           "Die unveränderte Senderbasis auf dem USB ist Voraussetzung.")
    # Verify every referenced uid exists in the unchanged DVBS.xml.
    tv = ET.fromstring(original[ROOT + "s2channellib/DVBS.xml"])
    known = {b.get("UniqueID") for b in tv.iter("Broadcast")}
    if set(current_favs) - known:
        raise RuntimeError("Abbruch: Unbekannte Sender-IDs in der Favoritenliste.")
    print("Originalbackup:", original_dir.resolve())
    print("SHA256 Original:", sha(original[FAVORITE]))
    print("SHA256 Änderung:", sha(proposed[FAVORITE]))
    if not confirmed:
        confirm = input('Nur Favorite.xml auf dem USB ersetzen? Gib "JA" ein: ').strip()
        if confirm != "JA":
            print("Abgebrochen. Keine Änderung am USB.")
            return
    with TemporaryDirectory(prefix="tvsort-bridge-") as temp:
        local = Path(temp) / "Favorite.xml"
        local.write_bytes(proposed[FAVORITE])
        remote_file = remote + "/" + FAVORITE
        adb("push", str(local), remote_file)
        verify = Path(temp) / "Favorite-verify.xml"
        adb("pull", remote_file, str(verify))
        if sha(verify.read_bytes()) != sha(proposed[FAVORITE]):
            raise RuntimeError("KRITISCH: USB-Rückleseprüfung fehlgeschlagen. Nicht am TV importieren.")
    print("ERFOLG: Favorite.xml auf USB geschrieben und bytegenau verifiziert.")
    print("Der anschließende Import am Philips erfolgt weiterhin MANUELL.")

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--volume", default=DEFAULT_VOLUME, help="USB-ID (Standard: 0F0B-2C4A)")
    p.add_argument("--backups-dir", type=Path, default=Path.home() / "philips-debloat" / "channelmaps" / "bridge-backups")
    actions = p.add_subparsers(dest="command", required=True)
    actions.add_parser("status", help="ADB und USB prüfen, nichts schreiben")
    actions.add_parser("backup", help="Originalexport vom USB sichern")
    apply_cmd = actions.add_parser("apply", help="Geprüfte TVsort-ZIP-Favoriten auf USB schreiben")
    apply_cmd.add_argument("zip", type=Path, help="TVsort-ZIP-Datei")
    args = p.parse_args()
    try:
        check_device()
        remote = mounted_volume(args.volume)
        print("USB:", remote)
        if args.command == "status":
            print(adb("shell", "df", "-h", remote, capture=True).strip())
        elif args.command == "backup":
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup(args.volume, args.backups_dir / ("manual-" + stamp))
        else:
            if not args.zip.is_file():
                raise RuntimeError("ZIP-Datei nicht gefunden.")
            deploy(args.volume, args.zip, args.backups_dir)
    except (RuntimeError, ValueError, subprocess.CalledProcessError,
            BadZipFile, ET.ParseError, OSError) as exc:
        print("FEHLER:", exc, file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
