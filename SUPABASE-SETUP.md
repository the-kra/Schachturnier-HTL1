# Supabase neu aufsetzen — komplette Anleitung

Damit lässt sich das HTL1-Schachturnier von Grund auf an eine **neue** Supabase-Datenbank hängen (neues Projekt, neue Schule, Neustart). Reihenfolge einhalten.

> Kurzfassung: **(1)** Projekt anlegen → **(2)** `sql/schema.sql` ausführen → **(3)** Lehrer-User anlegen → **(4)** `sql/auth.sql` ausführen → **(5)** `CONFIG` in `js/app.js` eintragen → **(6)** Realtime prüfen → **(7)** testen.

---

## 1. Neues Projekt
1. [supabase.com](https://supabase.com) → **New project**.
2. Region **Central EU (Frankfurt)** (nah an AT, DSGVO-freundlich).
3. Datenbank-Passwort vergeben (wird hier nicht gebraucht, aber notieren).

## 2. Schema einspielen (Tabellen, Spalten, Realtime)
**SQL Editor → New query** → kompletten Inhalt von **`sql/schema.sql`** einfügen → **Run**.

Das legt an:
- Tabellen `chess_state`, `chess_players`, `chess_pairings`, `chess_halloffame`, **`chess_archive`** (Siegerehrungs-Archiv)
- **alle Spalten** (Status, Runden, Bedenkzeit, Pokale, Anmeldemodus, externer Link, **Spiel-Live-Modus**, **Stechen** (`tiebreak`/`stechen_ids`), **Pause + Pausentext**, Bretter/Warteschlange, Beamer-Brettnummern, E-Mail-Bestätigung …)
- die **offenen** Policies (vorläufig — werden in Schritt 4 ersetzt)
- die **Realtime-Publication** für die Live-Tabellen (idempotent — Mehrfach-Ausführen ist ok). `chess_archive` braucht kein Realtime (wird nur beim Öffnen von `?archiv` geladen).

> Das Skript ist so geschrieben, dass es **mehrfach** laufen kann (alle Spalten mit `add column if not exists`, Realtime mit Fehler-Ignorieren). Auf einer leeren DB genau einmal nötig.

## 3. Lehrer-Konten anlegen (vor auth.sql!)
**Authentication → Users → Add user → Create new user**, für **jeden** Lehrer:
- E-Mail + Passwort
- ✅ **„Auto Confirm User"** anhaken (sonst muss die Mail erst bestätigt werden)

Standard-Lehrer dieses Projekts (müssen 1:1 mit `ADMIN_EMAILS` in `js/app.js` und `chess_admins` in `auth.sql` übereinstimmen):
- `kra@htl1-klu.at`
- `oko@htl1-klu.at`

> Andere Schule/Lehrer? Dann diese Adressen **an drei Stellen** ändern: hier (Auth-User), in `sql/auth.sql` (`chess_admins`-Insert) **und** in `js/app.js` (`ADMIN_EMAILS`).

## 4. Rechte absichern (RLS + Lehrer-Login)
**SQL Editor → New query** → kompletten Inhalt von **`sql/auth.sql`** einfügen → **Run**.

Danach gilt:
- **Lesen:** alle (Schüler, Beamer, anonym)
- **Anmelden:** jeder darf sich als Spieler eintragen
- **Steuern/Löschen:** **nur eingeloggte Lehrer** (E-Mail in `chess_admins`)

> Ohne diesen Schritt kann **jeder** mit dem (öffentlichen) Key alles löschen/ändern. Für ein echtes Event **zwingend**.

## 5. Keys in die App
**Project Settings → API** → `Project URL` und den **publishable / anon** Key kopieren und oben in **`js/app.js`** eintragen:
```js
const CONFIG = {
  url: "https://DEINPROJEKT.supabase.co",
  key: "DEIN_PUBLISHABLE_ODER_ANON_KEY"
};
```
Und die Lehrer-Mails prüfen:
```js
const ADMIN_EMAILS = ["kra@htl1-klu.at", "oko@htl1-klu.at"];
```
> Den **`service_role`**-Key **niemals** ins Frontend — nur publishable/anon. Geschützt wird über RLS, nicht über den Key.

## 6. Realtime prüfen (sonst „Handy aktualisiert nicht von selbst")
**Database → Replication → `supabase_realtime`** öffnen und sicherstellen, dass **alle vier** Tabellen aktiviert sind:
`chess_state`, `chess_players`, `chess_pairings`, `chess_halloffame`.

Fehlt eine (häufig **`chess_state`** → dann kommt z. B. die **Pause** nicht am Handy an), per SQL nachziehen:
```sql
do $$ begin alter publication supabase_realtime add table chess_state;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_players;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_pairings;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_halloffame; exception when duplicate_object then null; end $$;
```
> Die App hat zusätzlich einen **Fallback-Poll alle 8 s** — verpasste Events werden so spätestens nach 8 s nachgezogen. Sauberer ist es trotzdem, wenn alle Tabellen im Realtime sind (dann ~0,3 s).

## 7. Testen / Abnahme-Checkliste
- [ ] `?admin` öffnen → mit Lehrer-Mail + Passwort **einloggen** (oben erscheint **Abmelden**).
- [ ] In **Anmeldephase**: Karte **„Teilnehmer hinzufügen"** + **„Schüler einladen"** (QR) sichtbar.
- [ ] **+20 Testdaten** → **Testlauf simulieren** → Handy (zweites Gerät / Inkognito) läuft **automatisch** mit (Runden, Tabelle, **Pause**, Endstand) — ohne Refresh.
- [ ] **Aussteiger**-Button in der Zwischenstand-Tabelle wirkt (Zeile ausgegraut, nicht mehr ausgelost).
- [ ] **Gegentest RLS:** privates Fenster (nicht eingeloggt) → Ändern/Löschen muss **fehlschlagen**.
- [ ] `?beamer` am Projektor: QR im Header, Spielplan, Pause-Screen, Endstand/Pokale.

---

## Spalten-Übersicht (zur Kontrolle)
**chess_state** (eine Zeile, `id=1`): `tournament_name, status, num_rounds, current_round, time_control, champions(jsonb), awarded, event_code, verify_mode, reg_text, reg_link, qr_extern, live_only, stechen_ids(jsonb), paused, pause_text, board_labels, beamer_boards, updated_at`
**chess_players**: `id, name, klasse, withdrawn, email, verified, tiebreak, created_at`
**chess_pairings**: `id, round, board, white_id, black_id, result, active, board_label, created_at`
**chess_halloffame**: `id, tournament_name, event_date, rank, name, klasse, created_at`
**chess_archive**: `id, tournament_name, event_date, data(jsonb: {top:[{rank,name,klasse,points,buch}]}), created_at`

> Spalten dieser Session (auf einer bestehenden DB nachziehen — `sql/schema.sql` ist idempotent und macht das automatisch): `chess_state.live_only`, `chess_state.stechen_ids`, `chess_players.tiebreak` sowie die neue Tabelle **`chess_archive`**.

## Häufige Stolpersteine
| Symptom | Ursache / Fix |
|---|---|
| Handy aktualisiert nicht von selbst (v. a. **Pause**) | Tabelle (meist `chess_state`) **nicht** im Realtime → Schritt 6. |
| „Teilnehmer hinzufügen" / QR fehlen | Nicht als Lehrer **eingeloggt** oder nicht in **Anmeldephase**. |
| Ändern/Löschen geht für jeden | `auth.sql` nicht ausgeführt (Policies offen) → Schritt 4. |
| Lehrer kann nicht steuern | Auth-User fehlt / E-Mail stimmt nicht mit `chess_admins` + `ADMIN_EMAILS` überein. |
| E-Mail-Bestätigungsmodus | Braucht eigenes SMTP — siehe **UEBERNAHME-schachturnier.md §6**. |
| „policy already exists" beim Re-Run | Harmlos bzw. `auth.sql` droppt offene Policies vorher; einfach weiterlaufen lassen. |
