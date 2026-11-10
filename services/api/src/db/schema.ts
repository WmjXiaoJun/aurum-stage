/**
 * 数据库结构（需求文档 8.2 + v1.5 扩展）
 * 默认落地 SQLite（零依赖、可离线跑），字段与 PostgreSQL DDL 一一对应，
 * 生产切 PG 时只需替换驱动与 JSONB/TEXT 映射（见 deploy/README）。
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  variety_type    TEXT NOT NULL,
  aspect_ratio    TEXT NOT NULL DEFAULT '16:9',
  fps             INTEGER NOT NULL DEFAULT 25,
  style_prompt    TEXT,
  style_negative  TEXT,
  privacy_mode    INTEGER NOT NULL DEFAULT 0,
  visual_style    TEXT NOT NULL DEFAULT 'photoreal',
  style_ref_asset_id INTEGER,
  global_config   TEXT NOT NULL DEFAULT '{}',
  owner_user_id   INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'draft',
  segment_cap_sec INTEGER NOT NULL DEFAULT 300,
  auto_compose    INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  raw_md          TEXT NOT NULL,
  structured_json TEXT NOT NULL DEFAULT '{}',
  parse_status    TEXT NOT NULL DEFAULT 'pending',
  parse_report    TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_script_project ON script(project_id);

CREATE TABLE IF NOT EXISTS season_episode (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  title          TEXT NOT NULL,
  brief          TEXT,
  template_key   TEXT,
  visual_style   TEXT NOT NULL DEFAULT 'photoreal',
  language       TEXT NOT NULL DEFAULT 'zh',
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TEXT NOT NULL,
  UNIQUE (project_id, seq)
);

CREATE TABLE IF NOT EXISTS segment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  segment_type    TEXT NOT NULL,
  title           TEXT,
  default_engine  TEXT NOT NULL DEFAULT 'muse_api',
  visual_style    TEXT,
  duration_ms     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE (project_id, seq)
);

CREATE TABLE IF NOT EXISTS round_shot (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id              INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  segment_id              INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
  seq                     INTEGER NOT NULL,
  shot_code               TEXT NOT NULL DEFAULT '',
  speaker_role_id         TEXT,
  speaker_name            TEXT,
  camera                  TEXT NOT NULL DEFAULT 'medium_shot',
  lines                   TEXT NOT NULL DEFAULT '[]',
  text_clean              TEXT,
  emotion                 TEXT,
  emotion_instruction     TEXT,
  performance_tags        TEXT NOT NULL DEFAULT '[]',
  visual_prompt           TEXT,
  negative_prompt         TEXT,
  overlays                TEXT NOT NULL DEFAULT '[]',
  render_engine           TEXT NOT NULL DEFAULT 'muse_api',
  visual_style            TEXT NOT NULL DEFAULT 'photoreal',
  engine_params           TEXT NOT NULL DEFAULT '{}',
  template_id             TEXT,
  tts_engine              TEXT,
  voice_id                TEXT,
  tts_speed               REAL NOT NULL DEFAULT 1.00,
  tts_duration_ms         INTEGER,
  tts_asset_id            INTEGER,
  lipsync_required        INTEGER NOT NULL DEFAULT 0,
  lipsync_asset_id        INTEGER,
  native_audio            INTEGER NOT NULL DEFAULT 0,
  privacy                 INTEGER NOT NULL DEFAULT 0,
  manual_edited           INTEGER NOT NULL DEFAULT 0,
  status                  TEXT NOT NULL DEFAULT 'empty',
  duration_ms             INTEGER NOT NULL DEFAULT 0,
  target_duration_ms      INTEGER,
  preview_asset_id        INTEGER,
  locked                  INTEGER NOT NULL DEFAULT 0,
  error_code              TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE (segment_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_shot_project ON round_shot(project_id);
CREATE INDEX IF NOT EXISTS idx_shot_segment ON round_shot(segment_id, seq);

CREATE TABLE IF NOT EXISTS character_asset (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  role_id        TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  name           TEXT NOT NULL,
  role_type      TEXT NOT NULL DEFAULT 'guest',
  persona        TEXT,
  prompt_prefix  TEXT,
  negative_extra TEXT,
  lock_seed      INTEGER NOT NULL DEFAULT 1,
  seed           INTEGER,
  is_active      INTEGER NOT NULL DEFAULT 1,
  anchor_prompt  TEXT,
  art_status     TEXT NOT NULL DEFAULT 'none',
  authorization_file_hash TEXT,
  authorized_until TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (project_id, role_id, version)
);

CREATE TABLE IF NOT EXISTS character_ref_image (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id  INTEGER NOT NULL REFERENCES character_asset(id) ON DELETE CASCADE,
  asset_id      INTEGER NOT NULL,
  angle         TEXT NOT NULL DEFAULT 'front',
  weight        REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS voice_asset (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  voice_id       TEXT NOT NULL,
  role_id        TEXT,
  provider       TEXT NOT NULL DEFAULT 'indextts2',
  base_speed     REAL NOT NULL DEFAULT 1.00,
  available_emotions TEXT NOT NULL DEFAULT '[]',
  forbidden      TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  authorization_file_hash TEXT,
  authorized_until TEXT,
  created_at     TEXT NOT NULL,
  UNIQUE (project_id, voice_id)
);

CREATE TABLE IF NOT EXISTS voice_ref_audio (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  voice_id      INTEGER NOT NULL REFERENCES voice_asset(id) ON DELETE CASCADE,
  asset_id      INTEGER NOT NULL,
  ref_type      TEXT NOT NULL DEFAULT 'normal',
  duration_sec  REAL,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS script_document (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  skill_key         TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'draft',
  body              TEXT NOT NULL DEFAULT '{}',
  gates             TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_script_document_project ON script_document(project_id, skill_key, version);

CREATE TABLE IF NOT EXISTS engineering_file (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  engineering_id    TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'draft',
  body              TEXT NOT NULL DEFAULT '{}',
  lineage           TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_engineering_project ON engineering_file(project_id, version);

CREATE TABLE IF NOT EXISTS workflow_template (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key   TEXT NOT NULL UNIQUE,
  template_type  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  template_body  TEXT NOT NULL,
  param_map      TEXT NOT NULL DEFAULT '{}',
  params_schema  TEXT NOT NULL DEFAULT '{}',
  constraints    TEXT NOT NULL DEFAULT '{}',
  enabled        INTEGER NOT NULL DEFAULT 1,
  visual_style   TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS render_task (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id       INTEGER NOT NULL,
  shot_id          INTEGER,
  segment_id       INTEGER,
  task_type        TEXT NOT NULL,
  engine           TEXT NOT NULL,
  engine_params    TEXT NOT NULL DEFAULT '{}',
  idempotency_key  TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending',
  priority         INTEGER NOT NULL DEFAULT 5,
  node_id          INTEGER,
  external_task_id TEXT,
  attempt          INTEGER NOT NULL DEFAULT 0,
  max_attempt      INTEGER NOT NULL DEFAULT 2,
  depends_on       TEXT NOT NULL DEFAULT '[]',
  progress         INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  error_msg        TEXT,
  result_asset_id  INTEGER,
  meta             TEXT NOT NULL DEFAULT '{}',
  started_at       TEXT,
  finished_at      TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_status ON render_task(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_task_shot ON render_task(shot_id);

CREATE TABLE IF NOT EXISTS shot_candidate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shot_id     INTEGER NOT NULL REFERENCES round_shot(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  idx         INTEGER NOT NULL,
  asset_id    INTEGER,
  duration_ms INTEGER,
  state       TEXT NOT NULL DEFAULT 'pending',
  meta        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS asset (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL,
  asset_type    TEXT NOT NULL,
  source        TEXT NOT NULL,
  bucket        TEXT NOT NULL DEFAULT 'assets',
  object_key    TEXT NOT NULL,
  nfs_path      TEXT,
  thumb_key     TEXT,
  width         INTEGER,
  height        INTEGER,
  duration_sec  REAL,
  meta          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_asset_project ON asset(project_id, asset_type);

CREATE TABLE IF NOT EXISTS timeline_item (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  shot_id    INTEGER,
  track      TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER NOT NULL,
  asset_id   INTEGER,
  payload    TEXT NOT NULL DEFAULT '{}',
  locked     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_timeline_project ON timeline_item(project_id, track, start_ms);

CREATE TABLE IF NOT EXISTS render_account (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL,
  account_name   TEXT NOT NULL,
  secret_ref     TEXT NOT NULL,
  quota_used     INTEGER NOT NULL DEFAULT 0,
  quota_limit    INTEGER,
  cooldown_until TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_node (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  node_key       TEXT NOT NULL UNIQUE,
  base_url       TEXT NOT NULL DEFAULT '',
  engine_tags    TEXT NOT NULL DEFAULT '[]',
  vram_total_gb  REAL,
  vram_free_gb   REAL,
  queue_len      INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'online',
  models_loaded  TEXT NOT NULL DEFAULT '[]',
  last_heartbeat TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  actor      TEXT NOT NULL DEFAULT 'system',
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compose_export (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL,
  segment_id    INTEGER,
  task_id       INTEGER,
  status        TEXT NOT NULL DEFAULT 'pending',
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  video_asset_id INTEGER,
  subtitle_asset_id INTEGER,
  ass_asset_id  INTEGER,
  manifest      TEXT NOT NULL DEFAULT '{}',
  error_code    TEXT,
  error_msg     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_provider (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  protocol     TEXT NOT NULL DEFAULT 'openai',
  base_url     TEXT NOT NULL,
  api_keys     TEXT NOT NULL DEFAULT '[]',
  enabled      INTEGER NOT NULL DEFAULT 1,
  is_default   INTEGER NOT NULL DEFAULT 0,
  health       TEXT NOT NULL DEFAULT 'unknown',
  last_check   TEXT,
  meta         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_model (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES llm_provider(id) ON DELETE CASCADE,
  model_id    TEXT NOT NULL,
  display_name TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  context_len INTEGER,
  enabled     INTEGER NOT NULL DEFAULT 1,
  discovered  INTEGER NOT NULL DEFAULT 1,
  UNIQUE (provider_id, model_id)
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  provider   TEXT NOT NULL,
  model      TEXT NOT NULL,
  purpose    TEXT,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok         INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_llm_override (
  project_id  INTEGER PRIMARY KEY,
  provider_id INTEGER,
  model_id    TEXT,
  params      TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_run (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  goal        TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'idea',
  source_text TEXT NOT NULL,
  variety_type TEXT NOT NULL,
  visual_style TEXT NOT NULL,
  target_sec  INTEGER NOT NULL DEFAULT 300,
  stage       TEXT NOT NULL DEFAULT 'intake',
  status      TEXT NOT NULL DEFAULT 'running',
  outputs     TEXT NOT NULL DEFAULT '{}',
  events      TEXT NOT NULL DEFAULT '[]',
  script_id   INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_stage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      INTEGER NOT NULL REFERENCES agent_run(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  agent       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  summary     TEXT,
  payload     TEXT NOT NULL DEFAULT '{}',
  started_at  TEXT,
  finished_at TEXT,
  UNIQUE (run_id, stage)
);

CREATE TABLE IF NOT EXISTS quality_issue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  run_id     INTEGER,
  shot_id    INTEGER,
  segment_id INTEGER,
  level      TEXT NOT NULL DEFAULT 'warn',
  code       TEXT NOT NULL,
  message    TEXT NOT NULL,
  suggestion TEXT,
  resolved   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issue_project ON quality_issue(project_id, resolved);

CREATE TABLE IF NOT EXISTS clue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL,
  clue_key    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'prop',
  description TEXT NOT NULL,
  anchor      TEXT,
  first_shot_id INTEGER,
  pinned      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, clue_key)
);

CREATE TABLE IF NOT EXISTS comic_panel (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  segment_id INTEGER,
  shot_id    INTEGER,
  seq        INTEGER NOT NULL DEFAULT 0,
  layout     TEXT NOT NULL DEFAULT 'grid_4',
  panel_json TEXT NOT NULL DEFAULT '{}',
  preview_asset_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
