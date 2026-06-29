# HTL1 Schachturnier

Ein schlankes Web-Tool, um an der Schule ein **Schachturnier im Schweizer System** zu veranstalten — mit Online-Anmeldung per QR-Code, automatischer Auslosung, Live-Tabelle und einer **Beameransicht**, die sich von selbst durchblättert. Reines Vanilla JS + Supabase, **kein Build-Schritt**, läuft als statische Seite (GitHub Pages oder easyname).

## 🔗 Live-Ansichten

| Ansicht | Wofür | Link |
|---------|-------|------|
| **Schüler** | Anmeldung per QR, Spielplan & Tabelle live mitverfolgen | https://the-kra.github.io/Schachturnier-HTL1/ |
| **Lehrer** | Auslosung, Ergebnisse, Pokale — nur am eigenen Gerät | https://the-kra.github.io/Schachturnier-HTL1/?admin |
| **Beamer** | Vollbild für den Projektor (Uhr, QR, Spielplan, Pause, Sieger-Pokale, Stechen) | https://the-kra.github.io/Schachturnier-HTL1/?beamer |
| **Archiv** | Vergangene Siegerehrungen dauerhaft (Pokale + Liste je Turnier) | https://the-kra.github.io/Schachturnier-HTL1/?archiv |

> Am Beamer erscheint der QR-Code → Schüler scannen ihn und landen direkt in der Schüler-Ansicht. Die Lehrer-URL (`?admin`) nur auf dem eigenen Gerät öffnen. Siehe auch [LINKS.md](LINKS.md).

---

## Was kann das Tool?

- **Anmeldung per Handy** — Schüler scannen den QR-Code (Beamer-Header oder Anmelde-Seite) und tragen sich selbst ein. Live auf allen Geräten.
- **Drei Anmeldemodi**, live im Admin-Panel umschaltbar (kein Code-Edit nötig):
  - **Offen** – nur Name + Klasse/Funktion · **Code** – Event-Code vom Beamer (DSGVO-freundlich, *Standard*) · **E-Mail** – 6-stelliger Code an die Schul-Mail
- **QR-Umschalter (3 Modi)** — QR/Anmeldung zeigt wahlweise auf die **Schüleransicht** (Anmeldung + Spielplan/Tabelle in der App), einen **externen Link**, oder **Spiel Live** (keine Anmeldung; Schüler bekommen nur einen QR zum Mitverfolgen/Teilen, Beamer & Seite ohne „Anmeldung").
- **Teilnehmer einzeln hinzufügen** (Lehrer, ohne Code) **oder** per **Excel/CSV-Import** (Spalten *Vorname, Nachname, Klasse* — oder *Name, Klasse*; Namen werden gekürzt). **Vorlage**-Download inklusive. Feld **„Klasse / Funktion"** (auch *Lehrer/Direktor* möglich).
- **Schweizer System** — automatische Auslosung mit Farbausgleich, Revanche-Vermeidung und Freilos bei ungerader Anzahl.
- **Brett-Warteschlange** — bei mehr Partien als Brettern warten die übrigen Paarungen und rücken automatisch nach, sobald ein Brett frei wird.
- **Dauer-Schätzung (Forecast)** aus Runden, Bedenkzeit & Teilnehmern — berücksichtigt die Warteschlange. **Bedenkzeit** von Blitz bis **klassisch (40 Züge, FIDE)**.
- **Live-Tabelle** (Buchholz) + große **Beameransicht**: Spielplan, Gesamtreihung, 7-Segment-Uhr, **QR im Header**, dezente Pokale im Hintergrund, **Sieger-Ansicht** (Pokale + Endstand überblenden), animierte Konstellationen — alles im Vollbild mit Auto-Rotation.
- **Spielpause** — ein-/ausschaltbar, mit frei eintippbarem **Pausentext**; Beamer & Handy zeigen einen Pausen-Screen.
- **Aussteiger / außer Wertung** — Spieler im laufenden Turnier zurückziehen (zählt nicht mehr für die Auslosung, Punkte bleiben); im **Endstand** per **„Raus"** aus der Wertung nehmen (z. B. Lehrkraft) → die Schüler rücken auf 1/2/3 nach, Partien zählen weiter für die Buchholz der Gegner.
- **Stechen bei Punktgleichheit** — Buchholz reiht nur **vorläufig**; punktgleiche Spieler sind im Endstand markiert (⇅). Sieger eines Stechens mit **„Stechen ↑"** nach vorne setzen (überschreibt Buchholz). Betrifft es das **Podest (Top 3)**, warnt die App vor dem Gravieren und der **Beamer zeigt automatisch „Stechen" + die Paarung**, bis graviert ist. Test-Buttons **„Stechen-Test 2er/3er"**.
- **Pokale & Wall of Fame & Siegertafel** — Top 3 werden auf 3 Pokale „graviert", darunter eine **Siegertafel** (Rang/Name/Klasse). Alte Sieger wandern in die **Wall of Fame** (Tafeln mit ♚♛♞ statt Medaillen, Name + Klasse). **Export** als `.xlsx`.
- **Urkunden (PDF)** — A4-Hochformat pro Sieger (Schullogo + HTL1-Siegel, Pokal, Name/Klasse, Turnier & Datum, Gratulations-Text) über den Druckdialog als PDF.
- **Archiv** — „Siegerehrung archivieren" speichert Pokale + komplette Liste dauerhaft; unter **`?archiv`** (auch über einen Button auf der Schülerseite) sind alle vergangenen Siegerehrungen abrufbar.
- **Lehrer-Login** über Supabase Auth; Steuerung serverseitig per **RLS** geschützt. **Abmelden** oben im Header.
- **Echtzeit-Sync** über Supabase Realtime (+ 8-Sek-Fallback-Poll); **Testlauf-Simulation** spielt ein ganzes Turnier durch.

## Rollen (über URL-Parameter)

| URL | Ansicht |
|-----|---------|
| `index.html` | Schüler / Zuschauer (Anmeldung, Spielplan, Tabelle) |
| `index.html?admin` | Lehrer-Steuerung |
| `index.html?beamer` | Vollbild-Beamer (rotiert automatisch) |
| `index.html?archiv` | Archiv aller vergangenen Siegerehrungen |

---

## Ablauf am Event-Tag (Lehrer)

1. **Vorbereitung:** Turniername, Runden, Bedenkzeit, Bretter und Anmeldemodus im Admin einstellen. Bei `?admin` mit Lehrer-Mail **einloggen** (oben erscheint **Abmelden**).
2. **Anmeldung:** Beamer (`?beamer`) zeigt den QR. Schüler melden sich per Handy an — oder der Lehrer trägt sie über **„Teilnehmer hinzufügen"** / **Excel-Import** ein. Liste füllt sich live.
3. **Anwesenheit & Start:** Teilnehmer sind standardmäßig **„nicht anwesend"** — vor der Auslosung die Anwesenden **abhaken** (oder Bulk **„Alle anwesend"**). Nur Anwesende werden gelost. Dann **„Anmeldung schließen & auslosen"** → Runde 1. Danach pro Runde Ergebnisse eintragen (`1:0 / ½ / 0:1`), bei Warteschlange Brett zuweisen, dann **„Runde N auslosen"**.
4. **Während des Turniers:** **Spielpause** (mit Pausentext) ein-/ausschalten, **Aussteiger** in der Zwischenstand-Tabelle zurückziehen, Runden zurückblättern.
5. **Ende:** nach der letzten Runde **„Turnier beenden"**. Bei **Punktgleichheit** am Podest (markiert mit ⇅) ein **Stechen** spielen lassen — der Beamer zeigt automatisch „Stechen" + die Paarung, bis graviert ist — und den Sieger mit **„Stechen ↑"** ordnen. Lehrkräfte ggf. per **„Raus"** aus der Wertung nehmen. Dann **„Pokale gravieren (Top 3)"**, optional **„Urkunden (PDF)"** drucken und **„Siegerehrung archivieren"** (bleibt unter `?archiv`). Beamer zeigt die Sieger-Pokale; alte Inhaber wandern in die Wall of Fame. (Test-Gravur via **„Gravur löschen"** entfernbar.)

> Alles synchronisiert sich automatisch auf Schüler-Handys und Beamer (Supabase Realtime). Kein manuelles Aktualisieren nötig.

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
index.html          Markup (Supabase/XLSX per CDN; QR-Lib lokal + css/js)
css/app.css         Styles (dunkles Design, Inline-SVG-Icons)
js/app.js           gesamte Logik — CONFIG + VERIFY_DEFAULT + ADMIN_EMAILS ganz oben
assets/             Logo, HTL1-Wortmarke (logo-htl1.svg), Legends-Wall, 3 Pokale (…_neu.png)
assets/vendor/      qrcode.min.js (lokal — funktioniert auch ohne externes CDN/Schulnetz)
sql/schema.sql      DB-Einrichtung: Tabellen, Spalten, Realtime (zuerst, idempotent)
sql/auth.sql        Lehrer-Login + RLS (danach)
SUPABASE-SETUP.md   komplette Schritt-für-Schritt-Anleitung (DB neu aufsetzen)
tools/              normalize.py + Test-Importdatei (Vorname/Nachname/Klasse)
.htaccess           nur für easyname/Apache (GitHub Pages ignoriert es)
```

---

## Vor dem Event prüfen

- [ ] Supabase-Projekt + `CONFIG` gesetzt, `schema.sql` **und** `auth.sql` ausgeführt (→ **[SUPABASE-SETUP.md](SUPABASE-SETUP.md)**)
- [ ] **Realtime** für alle 4 Tabellen aktiv (sonst kommt z. B. die Pause nicht am Handy an)
- [ ] Test: als Nicht-Lehrer ein Ergebnis eintragen wollen → muss von der DB abgelehnt werden (RLS aktiv)
- [ ] Lehrer-Konten angelegt, Login funktioniert (Abmelden-Button oben sichtbar)
- [ ] (E-Mail-Modus) SMTP getestet — Testanmeldung kommt an, Rate-Limit hochgesetzt
- [ ] Beamer-URL am Projektor getestet (QR scannbar, Spielplan passt, Pause & Sieger-Pokale ok)
- [ ] Turniername, Runden, Bedenkzeit, Bretter, Anmeldemodus eingestellt
- [ ] **Testlauf simulieren** auf 2. Gerät mitverfolgt (Runden/Tabelle/Pause/Endstand laufen automatisch mit)

> Ausführliche Hintergründe (SMTP, DSGVO, Bild-Auslagerung, RLS-Details): **[UEBERNAHME-schachturnier.md](UEBERNAHME-schachturnier.md)**.
