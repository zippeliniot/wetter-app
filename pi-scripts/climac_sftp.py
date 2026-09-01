#!/usr/bin/env python3
"""climac_sftp.py — SFTP-Client fuer die Wetter-App.

Alle Zugangsdaten kommen ausschliesslich aus der SQLite-DB
(/opt/climac/data/climac.db, Tabelle `credentials`). Kein Hardcode.

Struktur auf dem Zielhost (Basis = credentials.path, z.B. /Gronenberg/Wetter_1):
    <base>/data/            -> live.json, history.json
    <base>/data/months/     -> 2026-08.json, ...
"""
from __future__ import annotations

import os
import sqlite3
import stat

import paramiko

DB_PATH = os.environ.get("CLIMAC_DB_PATH", "/opt/climac/data/climac.db")

SFTP_CRED_ID = "sftp_ionos_wetter"
INFLUX_CRED_ID = "influx_v2_local"

# Optional: lokales Deploy ohne SQLite (Windows), z. B.:
#   SFTP_IONOS_HOST / SFTP_IONOS_PORT / SFTP_IONOS_USER / SFTP_IONOS_PASSWORD / SFTP_IONOS_PATH
ENV_SFTP = {
    "target": "SFTP_IONOS_HOST",
    "port": "SFTP_IONOS_PORT",
    "user": "SFTP_IONOS_USER",
    "secret": "SFTP_IONOS_PASSWORD",
    "path": "SFTP_IONOS_PATH",
}

# Feste Vorgaben laut Projekt-Kontext (CLAUDE.md / migration_config)
INFLUX_ORG = "home"
INFLUX_BUCKET = "homeassistant"

# Measurement-Gruppen je Logik-Sensor.
# Bei Sensor-Umbenennungen laufen mehrere Measurements (teils parallel) --
# fuer Tagesmittel/History werden sie per union() zusammengefuehrt.
#   sw40 : Seewasser 40 cm Tiefe
#   swgr : Seewasser Grund (Boden)
#   at   : Aussentemperatur, ah : Aussenluftfeuchte
#   bld  : Blitz-Entfernung, blt : letzter Blitz, bln : Blitzanzahl
SENSOR_MEASUREMENTS = {
    "sw40": [
        "sensor.temperature_sensor_101_40_cm_temperature",  # alt, ab 2023-06
        "sensor.seewasser_temp_101_40cm",                   # neu, ab 2025-07
    ],
    "swgr": [
        "sensor.temperature_sensor_102_grund_temperature",  # alt, ab 2023-06
        "sensor.seewasser_temp_102_grund",                  # zwischenzeitl. 2025-07..2026-03
        "sensor.seewasser_temp_102_grund_2",                # neu, ab 2025-12
    ],
    "at": ["sensor.gw2000a_outdoor_temperature"],
    "ah": ["sensor.gw2000a_humidity"],
    "bld": ["sensor.gw2000a_lightning_strike_distance_3"],
    "blt": ["sensor.gw2000a_last_lightning_strike_3"],
    "bln": ["sensor.gw2000a_lightning_strikes_3"],
}


def get_credential(cred_id: str) -> dict:
    """Liest einen Credential-Datensatz aus SQLite. Eigene Verbindung,
    die sofort wieder geschlossen wird (Standalone-Script, kein API-Handler).

    Fuer SFTP_IONOS: alternativ Umgebungsvariablen SFTP_IONOS_* (lokales Deploy).
    """
    if cred_id == SFTP_CRED_ID:
        env = {k: os.environ.get(v) for k, v in ENV_SFTP.items()}
        if env.get("target") and env.get("user") and env.get("secret") is not None:
            return {
                "target": env["target"],
                "port": int(env["port"] or 22),
                "user": env["user"],
                "secret": env["secret"],
                "path": env.get("path") or "",
            }

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT * FROM credentials WHERE id = ? AND active = 1", (cred_id,)
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise RuntimeError(f"Credential '{cred_id}' nicht gefunden oder inaktiv")
    return dict(row)


def get_influx_config() -> dict:
    """URL + Token fuer InfluxDB v2. org/bucket sind projektweit fix."""
    c = get_credential(INFLUX_CRED_ID)
    host = c["target"]
    port = c["port"] or 8086
    token = c["secret"]
    if not token:
        raise RuntimeError(f"Credential '{INFLUX_CRED_ID}': secret (Token) leer")
    return {
        "url": f"http://{host}:{port}",
        "token": token,
        "org": INFLUX_ORG,
        "bucket": INFLUX_BUCKET,
    }


class ClimacSFTP:
    """Duenne paramiko-Huelle. Kein atomic-rename (bewusst)."""

    def __init__(self, cred_id: str = SFTP_CRED_ID):
        c = get_credential(cred_id)
        self.host = c["target"]
        self.port = int(c["port"] or 22)
        self.user = c["user"]
        self.password = c["secret"]
        # Basis-Pfad ohne abschliessenden Slash
        self.base = (c["path"] or "").rstrip("/")
        if not self.password:
            raise RuntimeError(f"Credential '{cred_id}': secret (Passwort) leer")

        self._transport = paramiko.Transport((self.host, self.port))
        self._transport.connect(username=self.user, password=self.password)
        self.sftp = paramiko.SFTPClient.from_transport(self._transport)

    # -- Kontext-Manager -------------------------------------------------
    def __enter__(self) -> "ClimacSFTP":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def close(self) -> None:
        try:
            if self.sftp:
                self.sftp.close()
        finally:
            if self._transport:
                self._transport.close()

    # -- Pfade ---------------------------------------------------------
    def _remote_dir(self, subdir: str | None) -> str:
        parts = [self.base, "data"]
        if subdir:
            parts.append(subdir.strip("/"))
        return "/".join(parts)

    def _ensure_dir(self, remote_dir: str) -> None:
        """Legt remote_dir rekursiv an, falls noetig."""
        segs = remote_dir.strip("/").split("/")
        path = ""
        for seg in segs:
            path = f"{path}/{seg}"
            try:
                if stat.S_ISDIR(self.sftp.stat(path).st_mode):
                    continue
            except IOError:
                pass
            try:
                self.sftp.mkdir(path)
            except IOError:
                # existiert bereits (Race / bereits vorhanden)
                pass

    def _exists(self, remote_path: str) -> bool:
        try:
            self.sftp.stat(remote_path)
            return True
        except IOError:
            return False

    # -- Transfer ----------------------------------------------------
    def upload_file(
        self, local_path: str, remote_filename: str, subdir: str | None = None
    ) -> str:
        remote_dir = self._remote_dir(subdir)
        self._ensure_dir(remote_dir)
        remote_path = f"{remote_dir}/{remote_filename}"
        self.sftp.put(local_path, remote_path)
        return remote_path

    def upload_raw(self, local_path: str, remote_relpath: str) -> str:
        """Datei relativ zum SFTP-Basispfad hochladen (z. B. 'js/main.js').
        Fuer Web-Deploys ausserhalb von data/."""
        remote_path = f"{self.base}/{remote_relpath.strip('/')}"
        self._ensure_dir(remote_path.rsplit("/", 1)[0])
        self.sftp.put(local_path, remote_path)
        return remote_path

    def download_file(
        self, remote_filename: str, local_path: str, subdir: str | None = None
    ) -> bool:
        """Laedt eine Datei herunter. Rueckgabe False, wenn sie remote fehlt."""
        remote_path = f"{self._remote_dir(subdir)}/{remote_filename}"
        if not self._exists(remote_path):
            return False
        os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
        self.sftp.get(remote_path, local_path)
        return True


if __name__ == "__main__":
    # Selbsttest: Verbindung + Verzeichnis-Listing
    inf = get_influx_config()
    print(f"InfluxDB : {inf['url']}  org={inf['org']}  bucket={inf['bucket']}  "
          f"token={'*' * 6}{inf['token'][-3:]}")
    with ClimacSFTP() as s:
        print(f"SFTP     : {s.user}@{s.host}:{s.port}  base={s.base}")
        d = s._remote_dir(None)
        s._ensure_dir(d)
        print(f"Listing  : {d}")
        for name in sorted(s.sftp.listdir(d)):
            print(f"   - {name}")
