# HTL1 Schachturnier

Ein schlankes Web-Tool, um an der Schule ein **Schachturnier im Schweizer System** zu veranstalten — mit Online-Anmeldung per QR-Code, automatischer Auslosung, Live-Tabelle und einer **Beameransicht**, die sich von selbst durchblättert. Reines Vanilla JS + Supabase, **kein Build-Schritt**, läuft als statische Seite (GitHub Pages oder easyname).

## 🔗 Live-Ansichten

| Ansicht | Wofür | Link |
|---------|-------|------|
| **Schüler** | Anmeldung per QR, Spielplan & Tabelle live mitverfolgen | https://the-kra.github.io/Schachturnier-HTL1/ |
| **Lehrer** | Auslosung, Ergebnisse, Pokale — nur am eigenen Gerät | https://the-kra.github.io/Schachturnier-HTL1/?admin |
| **Beamer** | Vollbild für den Projektor (Uhr, QR, Spielplan, Podest) | https://the-kra.github.io/Schachturnier-HTL1/?beamer |

> Am Beamer erscheint der QR-Code → Schüler scannen ihn und landen direkt in der Schüler-Ansicht. Die Lehrer-URL (`?admin`) nur auf dem eigenen Gerät öffnen. Siehe auch [LINKS.md](LINKS.md).

---

## Was kann das Tool?

- **Anmeldung per Handy** — Schüler scannen den QR-Code am Beamer und tragen sich selbst ein. Live sichtbar auf allen Geräten.
- **Drei Anmeldemodi**, live im Admin-Panel umschaltbar (kein Code-Edit nötig):
  - **Offen** – nur Name + Klasse
  - **Code** – Event-Code vom Beamer (keine Kontaktdaten, DSGVO-freundlich) · *Standard*
  - **E-Mail** – 6-stelliger Bestätigungscode an die Schul-Mail
- **Schweizer System** — automatische Auslosung mit Farbausgleich, Vermeidung von Revanchen und Freilos-Handling bei ungerader Teilnehmerzahl.
- **Live-Tabelle** mit Buchholz-Wertung, **Beameransicht** (Spielplan ↔ Gesamtreihung, 7-Segment-Uhr, Vollbild, Auto-Rotation, animierte Konstellationen).
- **Teilnehmer-Import** aus Excel/CSV und **Export** als `.xlsx` (Tabelle, Teilnehmer, Paarungen, Ruhmeshalle).
- **Pokale & Wall of Fame** — Top 3 werden auf 3 Pokale „graviert", alte Sieger wandern ins Jahres-Archiv.
- **Lehrer-Login** über Supabase Auth; Steuerung serverseitig per RLS geschützt.
- **Testlauf-Simulation** — spielt ein ganzes Turnier mit Zufallsergebnissen durch (zum Üben vor dem Event).

## Rollen (über URL-Parameter)

| URL | Ansicht |
|-----|---------|
| `index.html` | Schüler / Zuschauer (Anmeldung, Spielplan, Tabelle) |
| `index.html?admin` | Lehrer-Steuerung |
| `index.html?beamer` | Vollbild-Beamer (rotiert automatisch) |

---

## Schnellstart (zum Ausprobieren, ohne Setup)

1. Repo öffnen, in VS Code mit der Extension **Live Server** starten (nicht per `file://`, sonst zicken QR & Realtime).
2. `http://127.0.0.1:5500/index.html?admin` aufrufen → **Lokal-Modus** (im Speicher, kein Sync).
3. Im Admin: **+20 Testdaten** → **Testlauf simulieren** → durchspielen. Modus oben umschalten und ausprobieren.

> Im Lokal-Modus ist man ohne Passwort Admin (zum Testen). Für ein echtes Event Supabase einrichten (unten).

---

## Supabase einrichten (für das echte Event)

Der Browser spricht direkt mit Supabase über den öffentlichen Key — **kein eigener Server nötig**. Supabase liefert Datenbank, Realtime-Sync und (für den E-Mail-Modus) den Mailversand.

### 1. Projekt anlegen
[supabase.com](https://supabase.com) → neues Projekt, Region **Central EU (Frankfurt)** (näher an AT, DSGVO-freundlich).

> **Komplette Schritt-für-Schritt-Anleitung (DB neu/2. Mal aufsetzen):** **[SUPABASE-SETUP.md](SUPABASE-SETUP.md)** — inkl. Realtime-Check, Lehrer-Logins und Fehlersuche.

### 2. Datenbank-Schema einspielen
SQL-Editor öffnen und **in dieser Reihenfolge** ausführen:
1. `sql/schema.sql` — legt Tabellen, Realtime und Spalten an.
2. `sql/auth.sql` — ersetzt die offenen Policies durch echte Rechte (Lesen für alle, **Steuern nur für Lehrer**).

> Ohne `auth.sql` ist die DB für jeden mit dem Key beschreibbar. Für ein echtes Event **immer beide** ausführen.

### 3. Keys eintragen
Project Settings → **API** → `Project URL` und den **publishable / anon** Key kopieren und oben in `js/app.js` eintragen:

```js
const CONFIG = {
  url: "https://DEINPROJEKT.supabase.co",
  key: "DEIN_PUBLISHABLE_ODER_ANON_KEY"
};
```

> Dieser Key gehört bewusst ins Frontend — geschützt werden die Daten über **RLS**, nicht über den Key. Den `service_role`-Key **niemals** einbauen.

### 4. Lehrer-Konten anlegen
- Supabase → **Authentication → Users** → je Lehrer einen Nutzer mit E-Mail + Passwort.
- Dieselben Adressen müssen in `js/app.js` (`ADMIN_EMAILS`) **und** in `sql/auth.sql` (Tabelle `chess_admins`) stehen. Nur diese dürfen steuern.

### 5. (Nur E-Mail-Modus) SMTP einrichten
Für den E-Mail-Bestätigungscode braucht es eigenen SMTP (Supabases eingebauter Versand ist gedrosselt). In **Authentication → SMTP Settings** die easyname-Zugangsdaten hinterlegen und im „Magic Link"-Template `{{ .Token }}` verwenden, damit ein **Code** statt eines Links kommt. Details: **[UEBERNAHME-schachturnier.md](UEBERNAHME-schachturnier.md) §6**.

Danach den Modus einfach im Admin-Panel auf **E-Mail** stellen.

---

## Teilnehmer aus Excel/CSV importieren

Im Admin (Anmeldephase): **Import Excel/CSV**. Erwartet eine Tabelle mit Kopfzeile und den Spalten **Vorname**, **Nachname**, **Klasse** (`.xlsx`, `.xls` oder `.csv`). Eine einzelne **Name**-Spalte funktioniert weiterhin. Reihenfolge egal, Spalten werden automatisch erkannt, Duplikate übersprungen. Namen werden beim Import **gekürzt** (nur ein Vorname + Nachname), damit sie sauber auf die Pokale passen.

| Vorname | Nachname | Klasse |
|---------|----------|--------|
| Lena | Maier | 2AHET |
| Paul | Koch | 1BHET |

---

## Deployment

**GitHub Pages:** Repo pushen → Settings → Pages → Source `main` / root. Nach ~1 Min live unter `https://DEINUSER.github.io/REPO/`. (Relative Pfade sind bereits gesetzt.)

**easyname / Apache:** Ordnerinhalt per SFTP hochladen; `.htaccess` erzwingt dort HTTPS, Caching und Gzip und sperrt interne Dateien (`sql/`, `tools/`, `.md`).

---

## Projektstruktur

```
index.html         Markup (lädt CDN-Libs + css/js)
css/app.css        Styles (dunkles Design, Inline-SVG-Icons)
js/app.js          gesamte Logik — CONFIG + VERIFY_DEFAULT + ADMIN_EMAILS ganz oben
assets/            Logo, Legends-Wall, 3 Pokale
sql/schema.sql     DB-Einrichtung (zuerst)
sql/auth.sql       Lehrer-Login + RLS (danach)
tools/normalize.py Pokalbilder einheitlich aufbereiten
.htaccess          nur für easyname/Apache (GitHub Pages ignoriert es)
```

---

## Vor dem Event prüfen

- [ ] Supabase-Projekt + `CONFIG` gesetzt, `schema.sql` **und** `auth.sql` ausgeführt
- [ ] Test: als Nicht-Lehrer ein Ergebnis eintragen wollen → muss von der DB abgelehnt werden (RLS aktiv)
- [ ] Lehrer-Konten angelegt, Login funktioniert
- [ ] (E-Mail-Modus) SMTP getestet — Testanmeldung kommt an, Rate-Limit hochgesetzt
- [ ] Beamer-URL am Projektor getestet (QR scannbar, ggf. Code sichtbar)
- [ ] Turniername, Runden, Bedenkzeit, Anmeldemodus eingestellt
- [ ] Probe-Auslosung mit Testdaten gemacht

> Ausführliche Hintergründe (SMTP, DSGVO, Bild-Auslagerung, RLS-Details): **[UEBERNAHME-schachturnier.md](UEBERNAHME-schachturnier.md)**.
