-- ============================
-- Balloteer DB schema (v1)
-- ============================

-- Communities = cada grupo do Telegram
CREATE TABLE IF NOT EXISTS communities (
  group_id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  admin_id BIGINT
);

-- Voters = cada membro potencial/aprovado do grupo
CREATE TABLE IF NOT EXISTS voters (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  approved BOOLEAN DEFAULT false,
  weight INTEGER,
  processed BOOLEAN DEFAULT false,
  wallet_address TEXT,
  last_change_reason TEXT,
  last_modified_at TIMESTAMPTZ,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES communities(group_id)
);

-- Proposals = cada votação criada
CREATE TABLE IF NOT EXISTS proposals (
  group_id BIGINT NOT NULL,
  proposal_id INTEGER NOT NULL,
  title TEXT NOT NULL,

  -- array de opções de voto:
  -- ["Pizza","Sushi","Burger"]
  options JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- mapa peso total por opção:
  -- { "0":12, "1":5, "2":0 }
  votes JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- mapa voto individual:
  -- { "123456789":0, "5555":2 }
  voter_map JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'open', -- "open" | "closed"
  quorum_weight INTEGER,               -- ex: 30
  ends_at BIGINT,                      -- timestamp ms
  created_by BIGINT,                   -- admin telegram id

  attachment_file_id TEXT,
  attachment_file_name TEXT,

  PRIMARY KEY (group_id, proposal_id),
  FOREIGN KEY (group_id) REFERENCES communities(group_id)
);

-- proposal_counters = contador incremental por comunidade
CREATE TABLE IF NOT EXISTS proposal_counters (
  group_id BIGINT PRIMARY KEY REFERENCES communities(group_id),
  counter INTEGER NOT NULL DEFAULT 1
);
