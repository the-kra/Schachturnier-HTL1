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

alter table chess_state enable row level security;
alter table chess_players enable row level security;
alter table chess_pairings enable row level security;
create policy "open" on chess_state    for all using (true) with check (true);
create policy "open" on chess_players  for all using (true) with check (true);
create policy "open" on chess_pairings for all using (true) with check (true);

-- Pokal-Inhaber (aktuell) + "schon vergeben"-Flag:
alter table chess_state add column if not exists champions jsonb default '[]'::jsonb;
alter table chess_state add column if not exists awarded boolean default false;
alter table chess_state add column if not exists event_code text default '';

-- Anmeldemodus, live im Admin-Panel umschaltbar: 'none' | 'code' | 'email'
alter table chess_state add column if not exists verify_mode text default 'code';

-- Alternativ-Anmeldung (wenn Code leer): Hinweistext + externer Link (QR)
alter table chess_state add column if not exists reg_text text default '';
alter table chess_state add column if not exists reg_link text default '';
alter table chess_state add column if not exists qr_extern boolean default false;
alter table chess_state add column if not exists live_only boolean default false;
alter table chess_state add column if not exists stechen_ids jsonb default '[]'::jsonb;
alter table chess_state add column if not exists paused boolean default false;
alter table chess_state add column if not exists pause_text text default '';

-- Bretter (Liste der Bezeichnungen; Anzahl = Kapazität, leer = unbegrenzt)
alter table chess_state add column if not exists board_labels text default 'Brett 1, Brett 2, Brett 3, Brett 4, Brett 5, Brett 6, Brett 7, Brett 8, Brett 9, Brett 10, Brett 11, Brett 12, Brett 13, Brett 14, Brett 15, Brett 16, Brett 17, Brett 18, Brett 19, Brett 20';

-- Brettnummern am Beamer anzeigen (ein/aus)
alter table chess_state add column if not exists beamer_boards boolean default true;

-- Brett-Warteschlange: aktiv (wird gespielt) + zugewiesene Brett-Bezeichnung
alter table chess_pairings add column if not exists active boolean default true;
alter table chess_pairings add column if not exists board_label text default '';

-- optionale Anmeldebestätigung:
alter table chess_players add column if not exists email text;
alter table chess_players add column if not exists verified boolean default false;
-- Stechen: manueller Tiebreak-Wert (höher = vorne), nur bei echtem Gleichstand
alter table chess_players add column if not exists tiebreak int default 0;

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

-- Realtime: alle Tabellen ins Publication (idempotent — Fehler "already member" wird ignoriert)
do $$ begin alter publication supabase_realtime add table chess_state;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_players;    exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_pairings;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table chess_halloffame; exception when duplicate_object then null; end $$;
