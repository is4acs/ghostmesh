-- ═══════════════════════════════════════════════════════════════════
-- GhostMesh — Supabase Schema
-- Coller dans Supabase > SQL Editor > Run
-- ═══════════════════════════════════════════════════════════════════

-- 1. Codes d'accès clients (persistants entre redémarrages serveur)
create table if not exists client_codes (
  code        text        primary key,           -- 8 chiffres JJMMAAAA
  label       text        not null default 'Client',
  created_at  timestamptz not null default now()
);

-- 2. Journal des sessions (audit log)
create table if not exists sessions_log (
  id           uuid        primary key default gen_random_uuid(),
  room_id      text        not null,
  client_code  text        not null,
  client_label text,
  secure       boolean     not null default false,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  peer_count   int         not null default 0
);

-- Index pour requêtes courantes
create index if not exists idx_sessions_log_started on sessions_log (started_at desc);

-- RLS : accès uniquement via service_role (clé secrète côté serveur)
alter table client_codes  enable row level security;
alter table sessions_log  enable row level security;

-- Pas de policy publique — tout passe par le backend Node (service_role key)
-- Le frontend React ne contacte jamais Supabase directement
