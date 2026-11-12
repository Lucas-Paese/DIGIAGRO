-- ============================================================
--  DigiAgro — Modelo do banco de dados (SQLite)
--  Todo registro de produção pertence a um usuário (usuario_id).
-- ============================================================
PRAGMA foreign_keys = ON;

-- Usuários do sistema (a senha NUNCA é guardada em texto puro)
CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash   TEXT    NOT NULL,                       -- PBKDF2-SHA256 com sal
  nome         TEXT    NOT NULL,
  propriedade  TEXT    NOT NULL DEFAULT 'Minha Propriedade',
  email        TEXT,
  telefone     TEXT,
  cidade       TEXT,
  area_total   REAL    NOT NULL DEFAULT 0 CHECK (area_total >= 0),
  criado_em    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Sessões de login (guardamos só o hash do token)
CREATE TABLE IF NOT EXISTS sessoes (
  token_hash   TEXT    PRIMARY KEY,
  usuario_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  criado_em    TEXT    NOT NULL DEFAULT (datetime('now')),
  expira_em    TEXT    NOT NULL
);

-- Culturas plantadas, cada uma em uma gleba da propriedade
CREATE TABLE IF NOT EXISTS culturas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id          INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nome                TEXT    NOT NULL,
  gleba               TEXT    NOT NULL,
  area                REAL    NOT NULL DEFAULT 0 CHECK (area >= 0),   -- hectares
  data_plantio        TEXT,
  previsao_colheita   TEXT,
  status              TEXT    NOT NULL DEFAULT 'Plantio'
                      CHECK (status IN ('Plantio','Crescimento','Colheita','Concluído')),
  variedade           TEXT,
  producao_estimada   REAL    CHECK (producao_estimada >= 0),          -- quilos (kg)
  observacoes         TEXT,
  criado_em           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Receitas e despesas (cada insumo comprado gera uma despesa automática aqui)
CREATE TABLE IF NOT EXISTS lancamentos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cultura_id       INTEGER REFERENCES culturas(id) ON DELETE SET NULL,
  insumo_id        INTEGER REFERENCES insumos(id) ON DELETE CASCADE,   -- preenchido quando a despesa nasce de um insumo
  descricao        TEXT    NOT NULL,
  tipo             TEXT    NOT NULL CHECK (tipo IN ('receita','despesa')),
  valor            REAL    NOT NULL CHECK (valor >= 0),
  data             TEXT    NOT NULL,
  categoria        TEXT,
  forma_pagamento  TEXT,
  observacoes      TEXT,
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Insumos comprados (mudas, fertilizantes, defensivos, embalagens, combustível...)
CREATE TABLE IF NOT EXISTS insumos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cultura_id    INTEGER REFERENCES culturas(id) ON DELETE SET NULL,
  nome          TEXT    NOT NULL,
  tipo          TEXT,
  quantidade    REAL    NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  unidade       TEXT,
  custo_total   REAL    NOT NULL DEFAULT 0 CHECK (custo_total >= 0),
  data_compra   TEXT,
  fornecedor    TEXT,
  nota_fiscal   TEXT,
  observacoes   TEXT,
  criado_em     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Colheitas registradas (sempre ligadas a uma cultura)
CREATE TABLE IF NOT EXISTS colheitas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  cultura_id     INTEGER NOT NULL REFERENCES culturas(id) ON DELETE CASCADE,
  data_colheita  TEXT    NOT NULL,
  volume_kg      REAL    NOT NULL CHECK (volume_kg >= 0),           -- quilos colhidos
  receita        REAL    NOT NULL DEFAULT 0 CHECK (receita >= 0),
  brix           REAL    CHECK (brix BETWEEN 0 AND 40),             -- teor de açúcar (°Brix)
  qualidade      TEXT,                                              -- Extra, Primeira, Segunda...
  maquina        TEXT,                                              -- equipe / equipamento
  destino        TEXT,
  observacoes    TEXT,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_culturas_usuario     ON culturas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_usuario  ON lancamentos(usuario_id, data);
CREATE INDEX IF NOT EXISTS idx_insumos_usuario      ON insumos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_colheitas_usuario    ON colheitas(usuario_id, data_colheita);
CREATE INDEX IF NOT EXISTS idx_sessoes_usuario      ON sessoes(usuario_id);
