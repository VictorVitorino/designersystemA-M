-- 0002_content — apresentações, versões, arquivos (metadados), referências, comentários e interações.
-- Conteúdo pesado (imagens/arquivos) NUNCA fica no banco: só metadados em app.assets; os bytes vão para o armazenamento
-- de objetos, endereçados pelo SHA-256 (mesmo arquivo = um só objeto, mesmo salvando mil vezes ou em várias apresentações).

create table app.presentations (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references app.users(id) on delete restrict,
  title            text not null,
  slide_count      int  not null default 0,
  rev              int  not null default 1,            -- revisão da cópia de trabalho (controle otimista de conflitos)
  snap_seq         int  not null default 0,            -- último nº de versão gravado em presentation_versions
  content          jsonb not null,                     -- cópia de trabalho; imagens são referências "asset:sha256:<hash>"
  content_hash     text not null,                      -- SHA-256 do conteúdo canônico (detecta "nada mudou")
  thumb_sha        text,                               -- miniatura do 1º slide (arquivo no armazenamento)
  source_id        uuid references app.presentations(id) on delete set null,  -- de qual apresentação esta é cópia
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references app.users(id) on delete set null,
  last_snapshot_at timestamptz,
  deleted_at       timestamptz,                        -- lixeira (excluir = mover para a lixeira; admin apaga de vez)
  deleted_by       uuid references app.users(id) on delete set null,
  constraint pres_title_len   check (length(btrim(title)) between 1 and 200),
  constraint pres_hash_fmt    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint pres_thumb_fmt   check (thumb_sha is null or thumb_sha ~ '^[0-9a-f]{64}$'),
  constraint pres_size        check (pg_column_size(content) < 12582912),
  constraint pres_slides      check (slide_count between 0 and 500)
);
create index presentations_owner_idx   on app.presentations (owner_id, updated_at desc) where deleted_at is null;
create index presentations_updated_idx on app.presentations (updated_at desc, id) where deleted_at is null;
create index presentations_trash_idx   on app.presentations (deleted_at) where deleted_at is not null;
create index presentations_source_idx  on app.presentations (source_id) where source_id is not null;

create table app.presentation_versions (
  id              bigint generated always as identity primary key,
  presentation_id uuid not null references app.presentations(id) on delete cascade,
  version_no      int  not null,
  content         jsonb not null,
  content_hash    text not null,
  slide_count     int  not null default 0,
  title           text not null,
  kind            text not null,
  label           text,
  created_by      uuid references app.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint ver_unique unique (presentation_id, version_no),
  constraint ver_kind   check (kind in ('autosave','manual','restore','import','copy','pre_overwrite','pre_restore')),
  constraint ver_hash   check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint ver_label  check (label is null or length(label) <= 120),
  constraint ver_size   check (pg_column_size(content) < 12582912)
);
create index presentation_versions_idx on app.presentation_versions (presentation_id, version_no desc);

-- Metadados de arquivos. Chave = SHA-256 do conteúdo (deduplicação global). storage_key aponta para o objeto.
create table app.assets (
  sha256       text primary key,
  size_bytes   bigint not null,
  mime         text not null,
  kind         text not null default 'image',
  width        int,
  height       int,
  status       text not null default 'pending',
  uploaded_by  uuid references app.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  ready_at     timestamptz,
  last_ref_at  timestamptz,
  constraint assets_sha   check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint assets_size  check (size_bytes > 0 and size_bytes <= 1073741824),
  constraint assets_kind  check (kind in ('image','thumb','attachment')),
  constraint assets_status check (status in ('pending','ready','rejected','deleted')),
  constraint assets_mime  check (mime ~ '^[a-z]+/[a-z0-9.+-]+$')
);
create index assets_uploader_idx on app.assets (uploaded_by, created_at desc);
create index assets_status_idx   on app.assets (status, created_at);

-- Prova de posse: quem enviou os mesmos bytes (mesmo SHA-256) pode usar o arquivo mesmo que outra pessoa o tenha enviado antes.
create table app.asset_uploads (
  sha256  text not null references app.assets(sha256) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (sha256, user_id)
);

-- Quem usa cada arquivo. version_no = 0 → cópia de trabalho; > 0 → aquela versão do histórico.
create table app.asset_refs (
  presentation_id uuid not null references app.presentations(id) on delete cascade,
  version_no      int  not null,
  sha256          text not null references app.assets(sha256) on delete restrict,
  primary key (presentation_id, version_no, sha256)
);
create index asset_refs_sha_idx on app.asset_refs (sha256);

create table app.comments (
  id              uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references app.presentations(id) on delete cascade,
  slide_index     int,
  author_id       uuid not null references app.users(id) on delete restrict,
  body            text not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  resolved_at     timestamptz,
  resolved_by     uuid references app.users(id) on delete set null,
  deleted_at      timestamptz,
  constraint comments_body check (length(btrim(body)) between 1 and 2000),
  constraint comments_slide check (slide_index is null or slide_index between 0 and 499)
);
create index comments_pres_idx on app.comments (presentation_id, created_at) where deleted_at is null;

-- Interações dos espectadores: respostas de formulário, estado de quadros/votações, reações, visualizações.
create table app.interactions (
  id              bigint generated always as identity primary key,
  presentation_id uuid not null references app.presentations(id) on delete cascade,
  user_id         uuid not null references app.users(id) on delete cascade,
  kind            text not null,
  element_id      text not null default '',
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint inter_kind check (kind in ('form_response','board_state','vote_state','view','reaction')),
  constraint inter_elem check (length(element_id) <= 80),
  constraint inter_size check (pg_column_size(payload) < 65536)
);
create index interactions_pres_idx on app.interactions (presentation_id, kind, element_id, created_at);
create index interactions_user_idx on app.interactions (user_id, presentation_id);
-- Estados (quadro/votação) são únicos por pessoa+elemento; respostas e visualizações acumulam.
create unique index interactions_state_uniq on app.interactions (presentation_id, user_id, kind, element_id)
  where kind in ('board_state','vote_state');
