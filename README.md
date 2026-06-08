# HTL1 Schachturnier

Single-Page-Tool für Schulturniere im **Schweizer System** mit Live-Beameransicht.
Vanilla JS + Supabase (Realtime) + statisches Hosting. **Kein Build-Schritt.**

## Schnellstart

1. **Supabase-Projekt** anlegen (Region EU/Frankfurt). SQL-Editor → `sql/schema.sql` ausführen.
2. In **`js/app.js`** ganz oben eintragen:
   ```js
   const CONFIG = { url: "https://DEINPROJEKT.supabase.co", key: "ANON_PUBLIC_KEY" };
   const VERIFY = "email"; // "none" | "code" | "email"
   ```
3. Lokal testen: in VS Code mit **Live Server** öffnen (nicht per `file://`).
   - Schüler/QR: `index.html`
   - Lehrer: `index.html?admin`
   - Beamer: `index.html?beamer`

## Struktur

```
index.html        Markup
css/app.css        Styles (dunkles Design)
js/app.js          gesamte Logik (CONFIG + VERIFY oben)
assets/            Logo, Legends-Wall, 3 Pokale
sql/schema.sql     DB-Einrichtung (zuerst)
sql/auth.sql       Lehrer-Login + RLS (danach)
tools/normalize.py Pokalbilder einheitlich aufbereiten
.htaccess          nur für easyname/Apache (GitHub Pages ignoriert es)
```

## Bestätigungsmodi (`VERIFY`)

- `none` – offene Anmeldung
- `code` – Event-Code vom Beamer (keine Kontaktdaten, DSGVO-sauber) **[Standard]**
- `email` – 6-stelliger Code per Mail (aktiv; braucht easyname-SMTP, siehe §6) **[aktuell]**

## E-Mail-Versand (easyname-SMTP)

Supabase → Authentication → SMTP Settings:
`smtp.easyname.com` · Port `465` (SSL) · Benutzer = easyname-Postfach-Benutzer · Absender = Adresse auf deiner Domain.
Im „Magic Link"-Template `{{ .Token }}` verwenden, damit ein **Code** statt eines Links kommt.
Details: **UEBERNAHME-schachturnier.md**.

## Deployment

- **GitHub Pages:** Repo pushen → Settings → Pages → `main`/root. Relative Pfade nötig (passt bereits).
- **easyname:** Ordnerinhalt per SFTP hochladen; `.htaccess` greift dort (HTTPS, Caching, Gzip).

> Der **anon key** gehört ins Frontend — geschützt wird über RLS. Den `service_role`-Key niemals einbauen.
