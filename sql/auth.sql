-- ==========================================================================
--  HTL1 Schachturnier · auth.sql
--  Echtes Lehrer-Login (Supabase Auth) + RLS.
--  REIHENFOLGE: zuerst schema.sql ausführen, DANN diese Datei.
--
--  Vorher in Supabase: Authentication -> Users -> je einen Nutzer mit
--  E-Mail + Passwort anlegen: kra@htl1-klu.at und oko@htl1-klu.at
--  (müssen mit ADMIN_EMAILS in js/app.js übereinstimmen).
-- ==========================================================================

-- Lehrer-Liste -------------------------------------------------------------
create table if not exists chess_admins (email text primary key);
insert into chess_admins (email) values
  ('kra@htl1-klu.at'),
  ('oko@htl1-klu.at')
on conflict do nothing;

-- chess_admins ist nicht öffentlich lesbar; nur die Funktion (security definer)
-- liest sie. Keine Policy = kein Zugriff per anon/authenticated über die API.
alter table chess_admins enable row level security;

-- Prüft, ob der eingeloggte Nutzer ein Lehrer ist -------------------------
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from chess_admins
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- Alte offene Policies entfernen ------------------------------------------
drop policy if exists "open" on chess_state;
drop policy if exists "open" on chess_players;
drop policy if exists "open" on chess_pairings;
drop policy if exists "open" on chess_halloffame;

-- Lesen: alle (Schüler, Beamer, anonym) -----------------------------------
create policy "read_all" on chess_state      for select using (true);
create policy "read_all" on chess_players    for select using (true);
create policy "read_all" on chess_pairings   for select using (true);
create policy "read_all" on chess_halloffame for select using (true);

-- Anmeldung: jeder darf sich als Spieler eintragen ------------------------
create policy "register" on chess_players for insert with check (true);

-- Steuerung: NUR Lehrer (E-Mail in chess_admins) --------------------------
create policy "adm_upd"   on chess_players    for update using (is_admin()) with check (is_admin());
create policy "adm_del"   on chess_players    for delete using (is_admin());
create policy "adm_state" on chess_state      for all    using (is_admin()) with check (is_admin());
create policy "adm_pair"  on chess_pairings   for all    using (is_admin()) with check (is_admin());
create policy "adm_hall"  on chess_halloffame for all    using (is_admin()) with check (is_admin());

-- Hinweis: Schüler, die sich per E-Mail-Code anmelden, sind zwar
-- "authenticated", aber nicht in chess_admins -> is_admin() = false ->
-- sie können Ergebnisse/Paarungen/Status NICHT ändern. Genau das wollten wir.
