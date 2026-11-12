#!/usr/bin/env python3
"""
DigiAgro — servidor + banco de dados.

Usa apenas a biblioteca padrão do Python (sqlite3 + http.server),
então não precisa instalar nada.  Para rodar:

    python server.py          (Windows: py server.py)

e abrir http://localhost:8000 no navegador.
"""
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import backup

BASE = Path(__file__).resolve().parent
PUBLIC = BASE / "public"
DB_PATH = Path(os.environ.get("DIGIAGRO_DB", BASE / "digiagro.db"))
HOST = os.environ.get("HOST", "127.0.0.1")   # só este computador; use 0.0.0.0 p/ rede
PORT = int(os.environ.get("PORT", "8000"))

SESSAO_DIAS = 7
MAX_CORPO = 1_000_000          # 1 MB por requisição
PBKDF2_ITER = 200_000
LOGIN_MAX_ERROS = 5            # erros de senha permitidos...
LOGIN_JANELA = 300             # ...a cada 5 minutos


# ─────────────────────────────────────────────────────────────
#  Banco de dados
# ─────────────────────────────────────────────────────────────
def conectar():
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def iniciar_banco():
    # Computador novo (sem banco) mas com o backup do Git: restaura os dados automaticamente.
    if not DB_PATH.exists() and backup.DUMP.exists():
        print("Banco não encontrado neste computador. Restaurando de dados/digiagro.sql ...")
        backup.restaurar()
    con = conectar()
    con.execute("PRAGMA journal_mode = WAL")
    con.executescript((BASE / "schema.sql").read_text(encoding="utf-8"))
    migrar(con)
    semear_demo(con)
    con.commit()
    con.close()


def migrar(con):
    """Atualiza bancos criados em versões anteriores (sacas -> quilos, umidade -> brix, despesa automática de insumos)."""
    cols = {r["name"] for r in con.execute("PRAGMA table_info(colheitas)")}
    if "volume_sacas" in cols:
        con.execute("ALTER TABLE colheitas RENAME COLUMN volume_sacas TO volume_kg")
    if "brix" not in cols:
        con.execute("ALTER TABLE colheitas ADD COLUMN brix REAL CHECK (brix BETWEEN 0 AND 40)")
    if "qualidade" not in cols:
        con.execute("ALTER TABLE colheitas ADD COLUMN qualidade TEXT")
    cols_l = {r["name"] for r in con.execute("PRAGMA table_info(lancamentos)")}
    if "insumo_id" not in cols_l:
        con.execute("ALTER TABLE lancamentos ADD COLUMN insumo_id INTEGER REFERENCES insumos(id) ON DELETE CASCADE")
    con.execute("CREATE INDEX IF NOT EXISTS idx_lancamentos_insumo ON lancamentos(insumo_id)")


def gerar_hash(senha):
    sal = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, PBKDF2_ITER)
    return f"{PBKDF2_ITER}${sal.hex()}${h.hex()}"


def conferir_senha(senha, guardado):
    try:
        iteracoes, sal, esperado = guardado.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"),
                                   bytes.fromhex(sal), int(iteracoes))
        return hmac.compare_digest(calc.hex(), esperado)
    except Exception:
        return False


def sha(texto):
    return hashlib.sha256(texto.encode("utf-8")).hexdigest()


def semear_demo(con):
    """Na primeira execução cria o usuário 'admin' com dados de exemplo (fruticultura)."""
    if con.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0]:
        return

    def d(dias):  # data relativa a hoje, para os gráficos sempre terem dados
        return (date.today() + timedelta(days=dias)).isoformat()

    uid = con.execute(
        "INSERT INTO usuarios (username, senha_hash, nome, propriedade, email, telefone, cidade, area_total)"
        " VALUES (?,?,?,?,?,?,?,?)",
        ("admin", gerar_hash("admin123"), "Administrador", "Propriedade Demo",
         "admin@digiagro.com", "(54) 99000-0000", "Farroupilha - RS", 12)).lastrowid

    def cultura(nome, gleba, area, plantio, colheita, status, variedade, prod, obs=""):
        return con.execute(
            "INSERT INTO culturas (usuario_id,nome,gleba,area,data_plantio,previsao_colheita,status,variedade,producao_estimada,observacoes)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (uid, nome, gleba, area, d(plantio), d(colheita), status, variedade, prod, obs)).lastrowid

    uva_a = cultura("Uva", "Gleba A", 3.0, -2200, -16, "Colheita", "Niágara Branca", 45000, "Safra em andamento")
    uva_b = cultura("Uva", "Gleba B", 2.5, -1500, 40, "Crescimento", "Bordô", 38000)
    pessego = cultura("Pêssego", "Gleba C", 4.0, -900, -100, "Concluído", "Chimarrita", 40000, "Safra encerrada")
    caqui = cultura("Caqui", "Gleba D", 1.5, -30, 700, "Plantio", "Fuyu", None, "Pomar novo")

    # só lançamentos manuais: as despesas de insumos são geradas automaticamente abaixo
    lancs = [
        ("Financiamento Pronaf", "receita", 25000, -170, "Financiamento", None, "Financiamento"),
        ("Mão de obra — poda", "despesa", 6400, -120, "Mão de obra", None, "À vista"),
        ("Venda de pêssego", "receita", 57000, -95, "Venda", pessego, "PIX"),
        ("Manutenção do pulverizador", "despesa", 3300, -70, "Equipamento", None, "À vista"),
        ("Mão de obra — colheita da uva", "despesa", 11500, -18, "Mão de obra", uva_a, "À vista"),
        ("Venda de uva (vinícola)", "receita", 38400, -14, "Venda", uva_a, "À vista"),
        ("Venda de uva (cooperativa)", "receita", 21000, -8, "Venda", uva_a, "PIX"),
    ]
    con.executemany(
        "INSERT INTO lancamentos (usuario_id,descricao,tipo,valor,data,categoria,cultura_id,forma_pagamento)"
        " VALUES (?,?,?,?,?,?,?,?)",
        [(uid, desc, tipo, val, d(dias), cat, cid, pag) for desc, tipo, val, dias, cat, cid, pag in lancs])

    insumos = [
        ("Fertilizante NPK 10-10-10", "Fertilizante", 1200, "kg", 4800, -150, "Agropecuária Silva", uva_a, "000123"),
        ("Adubo orgânico (esterco curtido)", "Fertilizante", 6, "t", 1800, -130, "Granja Boa Terra", pessego, "000198"),
        ("Fungicida — calda bordalesa", "Defensivo", 80, "kg", 2950, -105, "Cooperativa RS", uva_a, "000241"),
        ("Caixas plásticas 20 kg", "Embalagem", 500, "unidades", 5200, -92, "Embalagens Serra", pessego, "000087"),
        ("Diesel S10", "Combustível", 350, "L", 2100, -40, "Posto Rural", None, ""),
        ("Muda de caquizeiro Fuyu", "Muda", 300, "unidades", 3800, -32, "Viveiro Serra", caqui, "000312"),
    ]
    for n, t, q, u, c, dias, f, cid, nf in insumos:
        iid = con.execute(
            "INSERT INTO insumos (usuario_id,nome,tipo,quantidade,unidade,custo_total,data_compra,fornecedor,cultura_id,nota_fiscal)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)", (uid, n, t, q, u, c, d(dias), f, cid, nf)).lastrowid
        sincronizar_despesa_insumo(con, uid, iid)

    con.executemany(
        "INSERT INTO colheitas (usuario_id,cultura_id,data_colheita,volume_kg,receita,brix,qualidade,maquina,destino,observacoes)"
        " VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(uid, pessego, d(-100), 38000, 57000, 11.5, "Extra", "Equipe de 8 colhedores", "Cooperativa", "Boa safra, calibre grande"),
         (uid, uva_a, d(-16), 29700, 59400, 17.8, "Primeira", "Equipe de 10 colhedores", "Vinícola", "Colheita ainda em andamento")])


# ─────────────────────────────────────────────────────────────
#  Validação / CRUD genérico (só colunas da lista branca)
# ─────────────────────────────────────────────────────────────
class ErroAPI(Exception):
    def __init__(self, status, mensagem):
        super().__init__(mensagem)
        self.status = status
        self.mensagem = mensagem


RECURSOS = {
    "culturas": {
        "colunas": ["nome", "gleba", "area", "data_plantio", "previsao_colheita",
                    "status", "variedade", "producao_estimada", "observacoes"],
        "obrigatorios": ["nome", "gleba"],
        "numericos": ["area", "producao_estimada"],
        "datas": ["data_plantio", "previsao_colheita"],
        "enums": {"status": {"Plantio", "Crescimento", "Colheita", "Concluído"}},
        "padroes": {"status": "Plantio", "area": 0},
        "fks": [],
        "ordem": "nome, gleba",
    },
    "lancamentos": {
        "colunas": ["descricao", "tipo", "valor", "data", "categoria",
                    "cultura_id", "forma_pagamento", "observacoes"],
        "obrigatorios": ["descricao", "tipo", "valor", "data"],
        "numericos": ["valor"],
        "datas": ["data"],
        "enums": {"tipo": {"receita", "despesa"}},
        "padroes": {},
        "fks": ["cultura_id"],
        "ordem": "data DESC, id DESC",
    },
    "insumos": {
        "colunas": ["nome", "tipo", "quantidade", "unidade", "custo_total",
                    "data_compra", "fornecedor", "cultura_id", "nota_fiscal", "observacoes"],
        "obrigatorios": ["nome"],
        "numericos": ["quantidade", "custo_total"],
        "datas": ["data_compra"],
        "enums": {},
        "padroes": {"quantidade": 0, "custo_total": 0},
        "fks": ["cultura_id"],
        "ordem": "data_compra DESC, id DESC",
    },
    "colheitas": {
        "colunas": ["cultura_id", "data_colheita", "volume_kg", "receita", "brix",
                    "qualidade", "maquina", "destino", "observacoes"],
        "obrigatorios": ["cultura_id", "data_colheita", "volume_kg"],
        "numericos": ["volume_kg", "receita", "brix"],
        "datas": ["data_colheita"],
        "enums": {},
        "padroes": {"receita": 0},
        "fks": ["cultura_id"],
        "ordem": "data_colheita DESC, id DESC",
    },
}


def validar(recurso, dados, con, uid):
    cfg = RECURSOS[recurso]
    limpo = {}
    for col in cfg["colunas"]:
        v = dados.get(col)
        if isinstance(v, str):
            v = v.strip()
        if v == "" or v is None:
            v = cfg["padroes"].get(col)
        limpo[col] = v

    for col in cfg["obrigatorios"]:
        if limpo.get(col) in (None, ""):
            raise ErroAPI(400, f"O campo '{col}' é obrigatório.")

    for col in cfg["numericos"]:
        v = limpo[col]
        if v is None:
            continue
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise ErroAPI(400, f"O campo '{col}' precisa ser um número.")
        if not math.isfinite(v) or v < 0:
            raise ErroAPI(400, f"O campo '{col}' não pode ser negativo.")
        limpo[col] = v

    for col in cfg["datas"]:
        v = limpo[col]
        if v is None:
            continue
        try:
            datetime.strptime(str(v), "%Y-%m-%d")
        except ValueError:
            raise ErroAPI(400, f"O campo '{col}' precisa ser uma data válida (AAAA-MM-DD).")

    for col, validos in cfg["enums"].items():
        if limpo[col] is not None and limpo[col] not in validos:
            raise ErroAPI(400, f"Valor inválido para '{col}'.")

    for col in cfg["fks"]:
        v = limpo[col]
        if v is None:
            continue
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise ErroAPI(400, "Cultura inválida.")
        # só aceita cultura que pertence ao próprio usuário
        if not con.execute("SELECT 1 FROM culturas WHERE id=? AND usuario_id=?", (v, uid)).fetchone():
            raise ErroAPI(400, "Cultura não encontrada.")
        limpo[col] = v

    if limpo.get("brix") is not None and limpo["brix"] > 40:
        raise ErroAPI(400, "O °Brix deve estar entre 0 e 40.")

    return limpo


def listar(con, recurso, uid):
    cfg = RECURSOS[recurso]
    linhas = con.execute(
        f"SELECT * FROM {recurso} WHERE usuario_id=? ORDER BY {cfg['ordem']}", (uid,)).fetchall()
    return [dict(l) for l in linhas]


def sincronizar_despesa_insumo(con, uid, insumo_id):
    """Todo insumo com custo vira uma despesa no financeiro (e já desconta do lucro).
    Ao editar o insumo a despesa é atualizada; ao apagar, ela some junto (ON DELETE CASCADE)."""
    ins = con.execute("SELECT * FROM insumos WHERE id=? AND usuario_id=?", (insumo_id, uid)).fetchone()
    if not ins:
        return
    atual = con.execute("SELECT id FROM lancamentos WHERE insumo_id=? AND usuario_id=?", (insumo_id, uid)).fetchone()
    if not ins["custo_total"]:
        if atual:
            con.execute("DELETE FROM lancamentos WHERE id=?", (atual["id"],))
        return
    descricao = f"Insumo: {ins['nome']}"
    data = ins["data_compra"] or date.today().isoformat()
    if atual:
        con.execute("UPDATE lancamentos SET descricao=?, valor=?, data=?, cultura_id=? WHERE id=?",
                    (descricao, ins["custo_total"], data, ins["cultura_id"], atual["id"]))
    else:
        con.execute(
            "INSERT INTO lancamentos (usuario_id, insumo_id, descricao, tipo, valor, data, categoria, cultura_id)"
            " VALUES (?,?,?,'despesa',?,?,'Insumo',?)",
            (uid, insumo_id, descricao, ins["custo_total"], data, ins["cultura_id"]))


def bloquear_despesa_automatica(con, uid, rid):
    linha = con.execute("SELECT insumo_id FROM lancamentos WHERE id=? AND usuario_id=?", (rid, uid)).fetchone()
    if linha and linha["insumo_id"] is not None:
        raise ErroAPI(409, "Essa despesa foi gerada por um insumo. Edite ou apague o insumo para alterá-la.")


def criar(con, recurso, uid, dados):
    limpo = validar(recurso, dados, con, uid)
    cols = list(limpo)
    cur = con.execute(
        f"INSERT INTO {recurso} (usuario_id, {', '.join(cols)}) VALUES (?, {', '.join('?' * len(cols))})",
        [uid] + [limpo[c] for c in cols])
    if recurso == "insumos":
        sincronizar_despesa_insumo(con, uid, cur.lastrowid)
    con.commit()
    return dict(con.execute(f"SELECT * FROM {recurso} WHERE id=?", (cur.lastrowid,)).fetchone())


def atualizar(con, recurso, uid, rid, dados):
    if recurso == "lancamentos":
        bloquear_despesa_automatica(con, uid, rid)
    limpo = validar(recurso, dados, con, uid)
    cols = list(limpo)
    cur = con.execute(
        f"UPDATE {recurso} SET {', '.join(c + '=?' for c in cols)} WHERE id=? AND usuario_id=?",
        [limpo[c] for c in cols] + [rid, uid])
    if cur.rowcount == 0:
        raise ErroAPI(404, "Registro não encontrado.")
    if recurso == "insumos":
        sincronizar_despesa_insumo(con, uid, rid)
    con.commit()
    return dict(con.execute(f"SELECT * FROM {recurso} WHERE id=?", (rid,)).fetchone())


def remover(con, recurso, uid, rid):
    if recurso == "lancamentos":
        bloquear_despesa_automatica(con, uid, rid)
    cur = con.execute(f"DELETE FROM {recurso} WHERE id=? AND usuario_id=?", (rid, uid))
    if cur.rowcount == 0:
        raise ErroAPI(404, "Registro não encontrado.")
    con.commit()


# ─────────────────────────────────────────────────────────────
#  Usuários e sessões
# ─────────────────────────────────────────────────────────────
USUARIO_PUBLICO = "id, username, nome, propriedade, email, telefone, cidade, area_total, criado_em"
tentativas_login = {}   # (ip, usuario) -> [timestamps dos erros]


def criar_sessao(con, uid):
    token = secrets.token_urlsafe(32)
    expira = (datetime.now(timezone.utc) + timedelta(days=SESSAO_DIAS)).strftime("%Y-%m-%d %H:%M:%S")
    con.execute("DELETE FROM sessoes WHERE expira_em <= datetime('now')")
    con.execute("INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?,?,?)",
                (sha(token), uid, expira))
    con.commit()
    return token


def usuario_da_requisicao(con, cabecalhos):
    auth = cabecalhos.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise ErroAPI(401, "Faça login para continuar.")
    linha = con.execute(
        f"SELECT u.{USUARIO_PUBLICO.replace(', ', ', u.')} FROM sessoes s "
        "JOIN usuarios u ON u.id = s.usuario_id "
        "WHERE s.token_hash=? AND s.expira_em > datetime('now')",
        (sha(auth[7:].strip()),)).fetchone()
    if not linha:
        raise ErroAPI(401, "Sessão expirada. Entre novamente.")
    return dict(linha)


def texto(dados, chave, maximo=120):
    v = dados.get(chave)
    v = v.strip() if isinstance(v, str) else ""
    if len(v) > maximo:
        raise ErroAPI(400, f"O campo '{chave}' é grande demais.")
    return v


def registrar(con, dados):
    username = texto(dados, "username", 30)
    senha = dados.get("senha") or ""
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,30}", username):
        raise ErroAPI(400, "Usuário: 3 a 30 caracteres (letras, números, ponto, hífen ou _).")
    if not isinstance(senha, str) or not 6 <= len(senha) <= 128:
        raise ErroAPI(400, "A senha precisa ter de 6 a 128 caracteres.")
    email = texto(dados, "email", 120)
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ErroAPI(400, "E-mail inválido.")
    try:
        area = float(dados.get("area_total") or 0)
        if not math.isfinite(area) or area < 0:
            raise ValueError
    except (TypeError, ValueError):
        raise ErroAPI(400, "Área total inválida.")
    try:
        uid = con.execute(
            "INSERT INTO usuarios (username, senha_hash, nome, propriedade, email, telefone, cidade, area_total)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (username, gerar_hash(senha), texto(dados, "nome") or username,
             texto(dados, "propriedade") or "Minha Propriedade", email or None,
             texto(dados, "telefone", 30) or None, texto(dados, "cidade") or None, area)).lastrowid
    except sqlite3.IntegrityError:
        raise ErroAPI(409, "Esse usuário já existe. Escolha outro.")
    con.commit()
    return uid


def login(con, dados, ip):
    username = texto(dados, "username", 30)
    senha = dados.get("senha") or ""
    chave = (ip, username.lower())
    agora = time.time()
    erros = [t for t in tentativas_login.get(chave, []) if agora - t < LOGIN_JANELA]
    if len(erros) >= LOGIN_MAX_ERROS:
        raise ErroAPI(429, "Muitas tentativas. Aguarde alguns minutos.")
    linha = con.execute("SELECT id, senha_hash FROM usuarios WHERE username=?", (username,)).fetchone()
    if not linha or not isinstance(senha, str) or not conferir_senha(senha, linha["senha_hash"]):
        erros.append(agora)
        tentativas_login[chave] = erros
        raise ErroAPI(401, "Usuário ou senha incorretos.")
    tentativas_login.pop(chave, None)
    return linha["id"]


def atualizar_perfil(con, uid, dados):
    nome = texto(dados, "nome")
    propriedade = texto(dados, "propriedade")
    if not nome or not propriedade:
        raise ErroAPI(400, "Nome e propriedade são obrigatórios.")
    email = texto(dados, "email", 120)
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ErroAPI(400, "E-mail inválido.")
    try:
        area = float(dados.get("area_total") or 0)
        if not math.isfinite(area) or area < 0:
            raise ValueError
    except (TypeError, ValueError):
        raise ErroAPI(400, "Área total inválida.")
    con.execute(
        "UPDATE usuarios SET nome=?, propriedade=?, email=?, telefone=?, cidade=?, area_total=? WHERE id=?",
        (nome, propriedade, email or None, texto(dados, "telefone", 30) or None,
         texto(dados, "cidade") or None, area, uid))
    senha = dados.get("senha")
    if senha:
        if not isinstance(senha, str) or not 6 <= len(senha) <= 128:
            raise ErroAPI(400, "A nova senha precisa ter de 6 a 128 caracteres.")
        con.execute("UPDATE usuarios SET senha_hash=? WHERE id=?", (gerar_hash(senha), uid))
    con.commit()


# ─────────────────────────────────────────────────────────────
#  Servidor HTTP
# ─────────────────────────────────────────────────────────────
TIPOS = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}


class Handler(BaseHTTPRequestHandler):
    server_version = "DigiAgro/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}\n")

    # ----- respostas
    def enviar(self, status, corpo, tipo, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(corpo)

    def json(self, status, obj):
        self.enviar(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                    "application/json; charset=utf-8")

    def ler_json(self):
        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ErroAPI(400, "Requisição inválida.")
        if tamanho > MAX_CORPO:
            raise ErroAPI(413, "Requisição grande demais.")
        if tamanho == 0:
            return {}
        try:
            dados = json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise ErroAPI(400, "JSON inválido.")
        if not isinstance(dados, dict):
            raise ErroAPI(400, "JSON inválido.")
        return dados

    # ----- métodos
    def do_GET(self):    self.rotear("GET")
    def do_POST(self):   self.rotear("POST")
    def do_PUT(self):    self.rotear("PUT")
    def do_DELETE(self): self.rotear("DELETE")

    def rotear(self, metodo):
        caminho = urlparse(self.path).path
        if caminho.startswith("/api/"):
            partes = [p for p in caminho[5:].split("/") if p]
            con = conectar()
            try:
                self.api(con, metodo, partes)
            except ErroAPI as e:
                self.json(e.status, {"erro": e.mensagem})
            except sqlite3.Error as e:
                sys.stderr.write(f"Erro de banco: {e}\n")
                self.json(400, {"erro": "Não foi possível salvar: dados inválidos."})
            except Exception as e:  # noqa
                sys.stderr.write(f"Erro interno: {e!r}\n")
                self.json(500, {"erro": "Erro interno do servidor."})
            finally:
                con.close()
        elif metodo == "GET":
            self.estatico(unquote(caminho))
        else:
            self.json(405, {"erro": "Método não permitido."})

    def estatico(self, caminho):
        if caminho == "/":
            caminho = "/index.html"
        alvo = (PUBLIC / caminho.lstrip("/")).resolve()
        try:
            alvo.relative_to(PUBLIC)
        except ValueError:
            return self.json(404, {"erro": "Não encontrado."})
        if not alvo.is_file():
            return self.json(404, {"erro": "Não encontrado."})
        tipo = TIPOS.get(alvo.suffix.lower()) or mimetypes.guess_type(alvo.name)[0] or "application/octet-stream"
        self.enviar(200, alvo.read_bytes(), tipo)

    # ----- rotas da API
    def api(self, con, metodo, p):
        ip = self.client_address[0]

        if metodo == "POST" and p == ["registrar"]:
            uid = registrar(con, self.ler_json())
            token = criar_sessao(con, uid)
            usuario = dict(con.execute(f"SELECT {USUARIO_PUBLICO} FROM usuarios WHERE id=?", (uid,)).fetchone())
            return self.json(201, {"token": token, "usuario": usuario})

        if metodo == "POST" and p == ["login"]:
            uid = login(con, self.ler_json(), ip)
            token = criar_sessao(con, uid)
            usuario = dict(con.execute(f"SELECT {USUARIO_PUBLICO} FROM usuarios WHERE id=?", (uid,)).fetchone())
            return self.json(200, {"token": token, "usuario": usuario})

        # --- daqui para baixo precisa estar logado
        usuario = usuario_da_requisicao(con, self.headers)
        uid = usuario["id"]

        if p == ["logout"] and metodo == "POST":
            con.execute("DELETE FROM sessoes WHERE token_hash=?",
                        (sha(self.headers["Authorization"][7:].strip()),))
            con.commit()
            return self.json(200, {"ok": True})

        if p == ["eu"]:
            if metodo == "GET":
                return self.json(200, usuario)
            if metodo == "PUT":
                atualizar_perfil(con, uid, self.ler_json())
                novo = con.execute(f"SELECT {USUARIO_PUBLICO} FROM usuarios WHERE id=?", (uid,)).fetchone()
                return self.json(200, dict(novo))

        if p == ["dados"]:
            if metodo == "GET":
                return self.json(200, {r: listar(con, r, uid) for r in RECURSOS})
            if metodo == "DELETE":   # apaga só a produção do usuário (a conta continua)
                for r in ("colheitas", "insumos", "lancamentos", "culturas"):
                    con.execute(f"DELETE FROM {r} WHERE usuario_id=?", (uid,))
                con.commit()
                return self.json(200, {"ok": True})

        if p and p[0] in RECURSOS:
            recurso = p[0]
            if len(p) == 1 and metodo == "GET":
                return self.json(200, listar(con, recurso, uid))
            if len(p) == 1 and metodo == "POST":
                return self.json(201, criar(con, recurso, uid, self.ler_json()))
            if len(p) == 2 and p[1].isdigit():
                rid = int(p[1])
                if metodo == "PUT":
                    return self.json(200, atualizar(con, recurso, uid, rid, self.ler_json()))
                if metodo == "DELETE":
                    remover(con, recurso, uid, rid)
                    return self.json(200, {"ok": True})

        raise ErroAPI(404, "Rota não encontrada.")


def main():
    iniciar_banco()
    servidor = ThreadingHTTPServer((HOST, PORT), Handler)
    print("=" * 54)
    print("  DigiAgro rodando!")
    print(f"  Abra no navegador:  http://localhost:{PORT}")
    print(f"  Banco de dados:     {DB_PATH}")
    print("  Usuário de teste:   admin  /  admin123")
    print("  Para parar: Ctrl + C")
    print("=" * 54)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
