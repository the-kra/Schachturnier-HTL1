# HTL1 Schachturnier — Übernahme nach VS Code

Handover-Dokument für die Weiterentwicklung des Turnier-Tools (Single-File-HTML → eigenes Projekt mit Supabase + easyname-SMTP + GitHub Pages).

---

## 1. Überblick & Architektur

- **Frontend:** eine eigenständige `index.html` (Vanilla JS, kein Framework, kein Build-Schritt). Läuft als statische Seite überall, wo HTML ausgeliefert wird.
- **Backend / Daten:** Supabase (Postgres + Realtime). Der Browser spricht direkt mit Supabase über den **anon public key**. Kein eigener Server nötig.
- **Live-Sync:** Supabase Realtime spiegelt Anmeldungen, Paarungen und Ergebnisse auf alle Geräte (Schülerhandys, Lehrer-Tablet, Beamer).
- **Hosting:** GitHub Pages (statisch). Daten liegen in Supabase — GitHub Pages liefert nur die HTML/Assets aus.
- **Rollen** über URL-Parameter:
  - `…/` → Schüler-/Zuschaueransicht
  - `…/?admin` → Lehrer-Steuerung
  - `…/?beamer` → Vollbild-Beameransicht (rotiert automatisch)

> Daten in Supabase + Auslieferung über GitHub Pages ist die richtige Kombination: Pages kann selbst keine DB, Supabase liefert DB + Realtime + (optional) Auth/Mail.

---

## 2. Voraussetzungen

- Node.js (nur für Hilfsskripte wie Bild-Auslagerung; die App selbst braucht **kein** Build)
- VS Code mit Extension **Live Server** (lokales Testen) oder **SFTP** (Deploy zu easyname, falls gewünscht)
- Git + GitHub-Account
- Supabase-Account (kostenloser Tier reicht für ein Schulturnier)
- easyname-Postfach für den Mailversand (für `VERIFY="email"`)

---

## 3. Projektstruktur in VS Code

Du kannst die Datei **so lassen** (ein File, alles inline) — das ist am robustesten und deploybar ohne jeden Build. Empfohlen fürs Aufräumen ist trotzdem eine kleine Aufteilung:

```
schachturnier/
├─ index.html            ← Markup + <script src> + <link>
├─ css/
│  └─ app.css            ← aus dem <style>-Block
├─ js/
│  └─ app.js             ← aus dem <script>-Block (CONFIG ganz oben)
├─ assets/
│  ├─ logo.png           ← HTL1-Logo (transparent)
│  ├─ legends.jpg        ← HTL1-LEGENDS-Wall
│  ├─ pokal-gold.jpg
│  ├─ pokal-silber.jpg
│  └─ pokal-bronze.jpg
├─ sql/
│  ├─ schema.sql         ← DB-Einrichtung, zuerst (siehe §5)
│  └─ auth.sql           ← Lehrer-Login + RLS, danach (siehe §7a)
├─ .gitignore
└─ README.md
```

In `index.html` dann statt Inline:

```html
<link rel="stylesheet" href="css/app.css">
...
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script src="js/app.js"></script>
```

> **Wichtig bei GitHub Pages:** relative Pfade (`css/…`, `js/…`, `assets/…`) verwenden, keine absoluten (`/css/…`), weil das Projekt unter `username.github.io/repo/` liegt.

---

## 4. Bilder auslagern (Base64 → Dateien)

Aktuell sind 5 Bilder als Base64 eingebettet (`HTL1_LOGO`, `LEGENDS_BOARD`, `TROPHY_CONFIG.images[3]`). Das macht die HTML groß (~0,8 MB). Beim Aufteilen besser als Dateien referenzieren.

**Variante A — Originale verwenden (am einfachsten).**
Du hast die Original-PNGs ja selbst hochgeladen. Leg sie in `assets/` und stell die Konstanten auf Pfade um:

```js
const HTL1_LOGO     = "assets/logo.png";
const LEGENDS_BOARD = "assets/legends.jpg";
const TROPHY_CONFIG = {
  images:        ["assets/pokal-gold.jpg", "assets/pokal-silber.jpg", "assets/pokal-bronze.jpg"],
  plateTopPct:   [77, 77, 77],
  plateWidthPct: [70, 70, 70],
  plateStyle:    ["engrave", "engrave", "engrave"]
};
```

> **Achtung Pokale:** Die eingebetteten Pokalbilder wurden vorab *normalisiert* — einheitlich auf 600×900 (2:3) zugeschnitten, unten bündig, Gold zusätzlich gesättigt, Gravur bei 77 %. Das Silber-Original ist **quadratisch** und anders gerahmt. Wenn du die Roh-Originale direkt einsetzt, sitzt die Gravur nicht mehr bündig. Entweder `plateTopPct` je Pokal nachjustieren **oder** die Bilder mit dem Skript unten identisch normalisieren (empfohlen).

**Normalisierungs-Skript** (`tools/normalize.py`, einmalig laufen lassen):

```python
# pip install pillow numpy
import numpy as np
from PIL import Image, ImageEnhance

def content_bbox(im, thr=16):
    g = np.asarray(im.convert("L")).astype(float)
    ys, xs = np.where(g > thr)
    return xs.min(), ys.min(), xs.max()+1, ys.max()+1

def normalize(src, dst, gold=False, cw=600, ch=900, q=92):
    im = Image.open(src).convert("RGB")
    if gold:
        im = ImageEnhance.Color(im).enhance(1.22)
        im = ImageEnhance.Brightness(im).enhance(1.05)
        im = ImageEnhance.Contrast(im).enhance(1.04)
    x0,y0,x1,y1 = content_bbox(im)
    c = im.crop((x0,y0,x1,y1)); w,h = c.size
    s = min((ch*0.99)/h, (cw*0.96)/w)
    c = c.resize((int(w*s), int(h*s)), Image.LANCZOS)
    cv = Image.new("RGB", (cw,ch), (0,0,0))
    cv.paste(c, ((cw-c.size[0])//2, ch-c.size[1]-2))
    cv.save(dst, "JPEG", quality=q, optimize=True)

normalize("roh/gold.png",   "assets/pokal-gold.jpg",   gold=True)
normalize("roh/silber.png", "assets/pokal-silber.jpg")
normalize("roh/bronze.png", "assets/pokal-bronze.jpg")
```

Logo + Legends-Wall einfach direkt in `assets/` kopieren (Logo ist bereits transparent).

**Variante B — aus der HTML extrahieren** (`tools/extract.mjs`):

```js
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const html = readFileSync("index.html", "utf8");
mkdirSync("assets", { recursive: true });
const uris = [...html.matchAll(/data:image\/(\w+);base64,([A-Za-z0-9+/=]+)/g)];
uris.forEach((m, i) => writeFileSync(`assets/img_${i}.${m[1]}`, Buffer.from(m[2], "base64")));
console.log(`${uris.length} Bilder extrahiert`);
```

---

## 5. Supabase einrichten

1. **Projekt anlegen** auf supabase.com → neues Projekt, Region z.B. *Central EU (Frankfurt)* (näher an AT, DSGVO-freundlich).
2. **Schema ausführen:** SQL-Editor öffnen, `sql/schema.sql` (Inhalt unten) einfügen, *Run*.
3. **Keys holen:** Project Settings → API → `Project URL` und `anon public` key.
4. **In die App eintragen** (oben in `app.js`):

```js
const CONFIG = {
  url: "https://DEINPROJEKT.supabase.co",
  key: "DEIN_ANON_PUBLIC_KEY"
};
```

### `sql/schema.sql`

```sql
create table chess_state (
  id int primary key default 1,
  tournament_name text default 'Schachturnier',
  status text default 'registration',      -- registration | running | finished
  num_rounds int default 6,
  current_round int default 0,
  time_control text default '5+3',
  updated_at timestamptz default now()
);
insert into chess_state (id) values (1) on conflict do nothing;

create table chess_players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  klasse text,
  withdrawn boolean default false,
  created_at timestamptz default now()
);

create table chess_pairings (
  id uuid primary key default gen_random_uuid(),
  round int not null,
  board int not null,
  white_id uuid,
  black_id uuid,                            -- null = Freilos
  result text,                              -- '1-0' | '0-1' | 'draw' | 'bye' | null
  created_at timestamptz default now()
);

alter table chess_state    enable row level security;
alter table chess_players  enable row level security;
alter table chess_pairings enable row level security;
create policy "open" on chess_state    for all using (true) with check (true);
create policy "open" on chess_players  for all using (true) with check (true);
create policy "open" on chess_pairings for all using (true) with check (true);

-- Pokal-Inhaber (aktuell) + "schon vergeben"-Flag + Anmeldecode:
alter table chess_state add column if not exists champions jsonb default '[]'::jsonb;
alter table chess_state add column if not exists awarded boolean default false;
alter table chess_state add column if not exists event_code text default '';

-- optionale Anmeldebestätigung:
alter table chess_players add column if not exists email text;
alter table chess_players add column if not exists verified boolean default false;

-- Wall of Fame (Archiv aller bisherigen Sieger):
create table if not exists chess_halloffame (
  id uuid primary key default gen_random_uuid(),
  tournament_name text,
  event_date date,
  rank int,                                -- 1, 2 oder 3
  name text,
  klasse text,
  created_at timestamptz default now()
);
alter table chess_halloffame enable row level security;
create policy "open" on chess_halloffame for all using (true) with check (true);

alter publication supabase_realtime
  add table chess_state, chess_players, chess_pairings, chess_halloffame;
```

> **Zu den `open`-Policies:** Für ein betreutes Schulevent okay — jeder mit dem anon key kann lesen/schreiben. Wenn du es enger willst: Schreibrechte auf `chess_state`/`chess_pairings` per RLS an eine Postgres-Funktion oder an authentifizierte Admins binden und nur `chess_players` (Anmeldung) offen lassen. Das ist Ausbaustufe, nicht zwingend.

---

## 6. easyname-SMTP in Supabase (für `VERIFY="email"`)

Damit der 6-stellige Bestätigungscode zuverlässig bei 30–40 Anmeldungen ankommt, braucht es **eigenen SMTP** — Supabases eingebauter Mailversand ist absichtlich stark gedrosselt (nur für Tests).

### 6.1 easyname-Zugangsdaten

| Feld          | Wert |
|---------------|------|
| **Host**      | `smtp.easyname.com` |
| **Port**      | `465` (SSL/TLS) — alternativ `587` (STARTTLS) |
| **Username**  | der vom easyname-Control-Panel generierte Postfach-Benutzer (oft **nicht** die Mailadresse, z.B. `8xxxxx-domain0`) |
| **Passwort**  | Passwort dieses Postfachs |
| **Absender**  | eine echte Adresse auf deiner Domain, z.B. `schachturnier@deinedomain.at` |

> Lege in easyname ein eigenes Postfach (z.B. `schachturnier@…`) an und verwende dessen Benutzernamen/Passwort. Den genauen *Benutzernamen* findest du im easyname-Control-Panel unter den E-Mail-/Postfach-Einstellungen.

### 6.2 In Supabase hinterlegen

1. Dashboard → **Authentication → Emails → SMTP Settings** → *Enable Custom SMTP* (Stand Anfang 2026; falls die UI abweicht, im Dashboard nach „SMTP" suchen).
2. Felder ausfüllen:
   - **Sender email:** `schachturnier@deinedomain.at`
   - **Sender name:** `HTL1 Schachturnier`
   - **Host:** `smtp.easyname.com`
   - **Port:** `465`
   - **Username / Password:** wie oben
3. Speichern.

### 6.3 Code statt Magic-Link

`signInWithOtp` schickt standardmäßig einen Link. Damit ein **6-stelliger Code** kommt:
- **Authentication → Email Templates → "Magic Link"** öffnen und im Template `{{ .Token }}` verwenden (statt/zusätzlich zu `{{ .ConfirmationURL }}`), z.B.:

```html
<h2>Dein Anmeldecode</h2>
<p>Code: <strong>{{ .Token }}</strong></p>
<p>Gilt einige Minuten. Wenn du dich nicht angemeldet hast, ignoriere diese Mail.</p>
```

Die App verifiziert mit `verifyOtp({ email, token, type: "email" })` — das passt zu diesem Token.

### 6.4 Limits & Zustellbarkeit

- **Rate Limit erhöhen:** Authentication → Rate Limits → „Emails per hour" hochsetzen (Default ist niedrig; bei 40 gleichzeitigen Anmeldungen sonst Stau).
- **SPF/DKIM** für deine Domain in easyname setzen, damit die Mails nicht im Spam landen.
- **OTP-Gültigkeit** (Email OTP expiry) ggf. auf 10 Min stellen.

---

## 7. Bestätigungs-Modi (`VERIFY`)

Ganz oben in `app.js`:

```js
const VERIFY = "code";   // "none" | "code" | "email"
```

| Modus    | Was passiert | Infrastruktur | DSGVO |
|----------|--------------|---------------|-------|
| `none`   | offene Anmeldung (nur Name/Klasse) | keine | minimal |
| `code`   | Lehrer setzt Event-Code (steht am Beamer), Schüler tippt ihn ein | keine | **sauber** (keine Kontaktdaten) |
| `email`  | 6-stelliger Code an (Schul-)Mail, dann bestätigt | Supabase + SMTP | Mailadresse = personenbezogen |

**SMS** (Ausbaustufe): in `app.js` in `doRequestCode`/`doVerifyCode` `{ phone }` statt `{ email }` und `type:"sms"`. Erfordert einen kostenpflichtigen SMS-Provider in Supabase (Twilio/MessageBird/Vonage). Für Minderjährige eher nicht empfohlen.

---

## 7a. Admin-Login (Supabase Auth + RLS) & Excel-Export

**Lehrer-Login.** Online läuft das echte Login über Supabase Auth (E-Mail + Passwort). Nur gelistete Lehrer dürfen steuern — in `app.js`:
```js
const ADMIN_EMAILS = ["kra@htl1-klu.at", "oko@htl1-klu.at"];
```
Diese Liste muss 1:1 mit der DB-Tabelle `chess_admins` (siehe `sql/auth.sql`) übereinstimmen.

**Einrichtung (einmalig):**
1. Supabase → **Authentication → Users**: je Lehrer einen Nutzer mit E-Mail + Passwort anlegen (`kra@htl1-klu.at`, `oko@htl1-klu.at`).
2. SQL-Editor: **zuerst `sql/schema.sql`, dann `sql/auth.sql`** ausführen. `auth.sql` legt `chess_admins` + die Funktion `is_admin()` an und ersetzt die offenen Policies durch echte Rechte.

**Logik / Sicherheit:**
- Lesen dürfen alle (Schüler, Beamer). Eintragen (Anmeldung) darf jeder. **Steuern (Paarungen, Ergebnisse, Status, Pokale) nur Lehrer** aus `chess_admins`.
- **Schüler sind NICHT Admin:** Sie melden sich per E-Mail-Code an und sind dann zwar „authenticated", aber ihre E-Mail steht nicht in `chess_admins` → `is_admin()` = false → die Datenbank lehnt jeden Steuerungs-Schreibzugriff ab. Der Schutz ist serverseitig (RLS), nicht nur in der Oberfläche.
- Session bleibt über Reloads erhalten; in jeder Admin-Leiste gibt es **🔒 Abmelden** (`supabase.auth.signOut()`).
- Lokal-Modus (ohne Supabase, zum Testen) fällt auf das einfache `ADMIN_PASS` zurück.

**Excel-Export.** Button **📊 Excel** in jeder Admin-Leiste erzeugt eine `.xlsx` (SheetJS, via CDN) mit den Blättern **Tabelle**, **Teilnehmer**, **Paarungen** und **Ruhmeshalle**. Dateiname = Turniername + Datum.

---

## 8. Lokal testen

- **Ohne Supabase:** `CONFIG` leer lassen → die App läuft im **Lokal-Modus** (im-Speicher, kein Sync) — ideal zum UI-Testen. Im Admin gibt's „+20 Demo-Teilnehmer".
- **Mit Supabase:** `CONFIG` ausfüllen, dann in VS Code per **Live Server** starten (nicht `file://` öffnen, sonst zicken QR/Realtime). URL z.B. `http://127.0.0.1:5500/index.html?admin`.

---

## 9. Deployment (GitHub Pages)

```bash
git init
git add .
git commit -m "Schachturnier-Tool"
git branch -M main
git remote add origin https://github.com/DEINUSER/schachturnier.git
git push -u origin main
```

Dann im Repo: **Settings → Pages → Source: `main` / root** → speichern.
Nach ~1 Min live unter `https://DEINUSER.github.io/schachturnier/`.

URLs fürs Event:
- Schüler/QR: `https://DEINUSER.github.io/schachturnier/`
- Lehrer: `…/?admin`
- Beamer: `…/?beamer`

> Da der anon key im Frontend steht (das ist bei Supabase normal & vorgesehen), schützt **RLS** die Daten — nicht der Key. Den `service_role`-Key niemals ins Frontend!

---

## 10. DSGVO-Kurzcheck (für E-Mail-Modus)

Du sammelst dann personenbezogene Daten von (großteils) Minderjährigen:
- **Datenminimierung:** nur Name, Klasse, Mail; keine Handynummern (= Argument gegen SMS).
- **Zweckbindung & Löschung:** Mailadressen nach dem Turnier löschen (`delete from chess_players …` oder Spalte leeren).
- **Rechtsgrundlage/Einwilligung:** kurze Info, wofür die Mail genutzt wird (nur Bestätigung).
- **Region:** Supabase-Projekt in der EU (Frankfurt) anlegen.
- Der **`code`-Modus** umgeht das alles, weil keine Kontaktdaten anfallen — für ein schulinternes Event meist die bessere Wahl.

---

## 11. Checkliste vor dem Event

- [ ] Supabase-Projekt + Schema + `CONFIG` gesetzt
- [ ] (bei `email`) easyname-SMTP getestet — Testanmeldung kommt an
- [ ] Rate Limit für Mails hochgesetzt
- [ ] Beamer-URL am Projektor getestet (QR scannbar, Code sichtbar)
- [ ] Turniername, Rundenzahl, Bedenkzeit eingestellt
- [ ] (bei `code`) Anmeldecode gewürfelt & am Beamer sichtbar
- [ ] Pokalbilder & Logo laden (Pfade/Assets korrekt)
- [ ] Probe-Auslosung mit Demo-Teilnehmern gemacht

---

## 12. Offene Ausbaustufen (optional)

- **Top-4-Playoff-Finale:** nach der letzten Schweizer-Runde Halbfinale/Finale am Beamer (für ein „echtes Endspiel").
- **Eigene DB auf easyname** statt Supabase: möglich, aber dann brauchst du eine eigene Realtime-Lösung (WebSocket/Polling) — Supabase nimmt dir das ab. Für Live-Sync würde ich bei Supabase bleiben.
- **Engere RLS:** Schreibzugriff auf Turniersteuerung absichern.

---

*Letzte Anpassungen: dunkles Design, Logo im Header/Beamer, Pokale auf schwarzem Display-Panel, HTL1-LEGENDS-Wall als Jahres-Doku, Anmeldebestätigung (none/code/email).*
