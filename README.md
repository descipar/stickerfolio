# Stickerfolio

Stickerfolio ist eine selbst gehostete, für Smartphones optimierte Verwaltung für Stickeralben. Der MVP verwaltet Sarahs Alben ohne Anmeldung und ist für den Betrieb im Heimnetz oder über VPN ausgelegt.

## Funktionen

- Sarah kann mehrere Alben verwalten.
- Fehlende Sticker lassen sich mit einem Tipp als vorhanden markieren.
- Die Anzahl vorhandener Exemplare und Doubletten kann erhöht oder reduziert werden.
- Suche nach Stickercode, Bereich oder Team.
- Filter für fehlende, vorhandene und doppelte Sticker.
- Fortschritt insgesamt und je Bereich.
- Neue, beliebige Alben per CSV importieren.
- Bestände als CSV oder JSON exportieren.
- Erweiterbares Datenmodell für mehrere Sammler.
- Mobile Web-App für den iPhone-Home-Bildschirm.

Das vorinstallierte Album „Panini WM 2026“ enthält 994 Sticker: 48 Teams mit je 20 Stickern, `FWC00–19` sowie `CC1–14`. Sarahs Stand vom 16.07.2026 ist als Initialbestand hinterlegt. Hinweise auf mögliche Tauschaktionen werden bewusst nicht als eigener Zustand übernommen.

## Lokal entwickeln

Voraussetzungen: Node.js 22 und pnpm 11.

```bash
pnpm install
pnpm dev
```

Die Anwendung ist anschließend unter `http://localhost:3000` erreichbar. Die lokale Datenbank wird unter `data/stickerfolio.db` angelegt.

## Raspberry Pi 4

Empfohlen wird Raspberry Pi OS 64-Bit mit Docker und Docker Compose.

Da das Repository privat ist, funktioniert das GitHub-Account-Passwort beim Klonen nicht. Empfohlen wird der Zugriff per SSH. Auf dem Raspberry Pi wird dafür einmalig ein Schlüssel erzeugt:

```bash
ssh-keygen -t ed25519 -C "stickerfolio-raspberry-pi"
cat ~/.ssh/id_ed25519.pub
```

Den ausgegebenen öffentlichen Schlüssel anschließend bei GitHub unter **Settings → SSH and GPG keys → New SSH key** hinterlegen. Danach kann die Verbindung geprüft und das Repository geklont werden:

```bash
ssh -T git@github.com
git clone git@github.com:descipar/stickerfolio.git
cd stickerfolio
docker compose up -d --build
```

Alternativ ist HTTPS mit einem [Fine-grained Personal Access Token](https://github.com/settings/personal-access-tokens/new) möglich. Der Token benötigt für `descipar/stickerfolio` nur **Contents: Read-only**. Beim folgenden Befehl wird als Benutzername `descipar` und bei der Passwortabfrage der Token eingegeben – nicht das GitHub-Passwort:

```bash
git clone https://github.com/descipar/stickerfolio.git
```

Auf dem iPhone wird Stickerfolio über `http://<IP-DES-PI>:6000` oder `http://raspberrypi.local:6000` geöffnet. In Safari kann die Seite über „Teilen“ → „Zum Home-Bildschirm“ als Web-App abgelegt werden.

### Fertiges Image aus GHCR verwenden

Das GitHub-Workflow baut Images für `linux/amd64` und `linux/arm64`. Da das Repository privat ist, muss Docker auf dem Pi einmal mit einem GitHub-Token mit `read:packages` angemeldet werden:

```bash
docker login ghcr.io -u descipar
docker compose pull
docker compose up -d
```

## Daten und Backup

Die SQLite-Datenbank liegt dauerhaft im Ordner `data/` neben der Compose-Datei. Sie wird nicht in ein Docker-Image eingebaut und bleibt bei Updates erhalten.

Ein konsistentes Backup kann so erstellt werden:

```bash
./scripts/backup.sh
```

Zusätzlich kann jedes Album direkt in der Oberfläche als CSV oder JSON exportiert werden.

## Weitere Alben importieren

Die CSV muss UTF-8-kodiert sein und diese Spalten enthalten:

```csv
section_code,section_name,sticker_code,sticker_number,label
GER,Deutschland,GER1,1,Sticker GER1
GER,Deutschland,GER2,2,Sticker GER2
```

`section` ist absichtlich allgemein gehalten und kann ein Team, eine Albumseite oder jede andere Kategorie darstellen. Neue Sticker starten als fehlend.

## Datenmodell

- `collectors`: Sammler
- `albums`: Albumkataloge
- `sections`: Teams, Seiten oder Kategorien
- `stickers`: Sticker eines Albums
- `collections`: Zuordnung eines Albums zu einem Sammler
- `holdings`: Anzahl eines Stickers in einer Sammlung

Die Oberfläche verwendet zunächst automatisch Sarah. Später kann eine Sammlerauswahl ergänzt werden, ohne Kataloge oder Bestände umzubauen.

## Qualitätssicherung

```bash
pnpm test
pnpm typecheck
pnpm build
```
