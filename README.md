# Stickerfolio

Stickerfolio ist eine selbst gehostete, für Smartphones optimierte Verwaltung für Stickeralben. Der MVP verwaltet die Alben eines konfigurierbaren Sammlers ohne Anmeldung und ist für den Betrieb im Heimnetz oder über VPN ausgelegt.

## Funktionen

- Ein Sammler kann mehrere Alben verwalten.
- Fehlende Sticker lassen sich mit einem Tipp als vorhanden markieren.
- Die Anzahl vorhandener Exemplare und Doubletten kann erhöht oder reduziert werden.
- Suche nach Stickercode, Bereich oder Team.
- Filter für fehlende, vorhandene und doppelte Sticker.
- Fortschritt insgesamt und je Bereich.
- Neue, beliebige Alben per CSV importieren.
- Bestände als CSV oder JSON exportieren.
- Erweiterbares Datenmodell für mehrere Sammler.
- Mobile Web-App für den iPhone-Home-Bildschirm.

Eine neue Installation startet ohne Album und ohne Stickerbestand. Sarahs Stand des Albums „Panini WM 2026“ vom 16.07.2026 kann bei Bedarf ausdrücklich über das mitgelieferte Seed-Skript geladen werden. Hinweise auf mögliche Tauschaktionen werden bewusst nicht als eigener Zustand übernommen.

## Lokal entwickeln

Voraussetzungen: Node.js 22 und pnpm 11.

```bash
pnpm install
pnpm dev
```

Die Anwendung ist anschließend unter `http://localhost:3000` erreichbar. Die lokale Datenbank wird unter `data/stickerfolio.db` angelegt.

Sarahs vorbereiteten WM-2026-Startbestand lokal laden:

```bash
pnpm seed:sarah
```

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

Der Container startet mit einer leeren Sammlung. Sarahs vorbereiteter WM-2026-Stand wird nur mit diesem zusätzlichen, ausdrücklichen Befehl geladen:

```bash
docker compose exec app node seed/scripts/seed-sarah.js
```

Das Skript kann gefahrlos erneut aufgerufen werden. Bereits vorhandene Stickerbestände werden nicht überschrieben.

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

Auch beim fertigen Image werden Sarahs Daten nicht automatisch geladen. Falls sie gewünscht sind, anschließend denselben Seed-Befehl ausführen:

```bash
docker compose exec app node seed/scripts/seed-sarah.js
```

### Anderen Sammler verwenden

Standardmäßig verwendet die Compose-Datei den Namen Sarah. Für eine andere Installation vor dem ersten Start eine `.env` neben `compose.yaml` anlegen:

```dotenv
COLLECTOR_NAME=Lisa
COLLECTOR_SLUG=lisa
```

Danach `docker compose up -d` starten und die gewünschten Alben über die Oberfläche importieren. Das Sarah-Seed-Skript wird für solche Installationen nicht benötigt.

`COLLECTOR_SLUG` ist die dauerhafte interne Kennung und sollte nach dem ersten Start nicht mehr geändert werden.

## Daten und Backup

Die SQLite-Datenbank liegt dauerhaft im Ordner `data/` neben der Compose-Datei. Sie wird nicht in ein Docker-Image eingebaut und bleibt bei Updates erhalten.

Bei einer bestehenden Installation bleiben bereits geladene Sarah-Daten durch diese Änderung erhalten. Nur eine neu angelegte Datenbank startet ohne Albumdaten.

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

Der aktive Sammler wird über `COLLECTOR_NAME` und `COLLECTOR_SLUG` konfiguriert. Eine spätere Sammlerauswahl kann ergänzt werden, ohne Kataloge oder Bestände umzubauen.

## Qualitätssicherung

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm seed:build
```
