#!/usr/bin/env python3
"""
DigiAgro — backup e restauração do banco de dados em arquivo de TEXTO.

O digiagro.db é um arquivo binário e não combina com o Git. Por isso o conteúdo
do banco é exportado para  dados/digiagro.sql  (texto: o Git compara e guarda o
histórico direitinho) e pode ser restaurado em qualquer computador.

    python backup.py salvar          grava dados/digiagro.sql com o que está no banco
    python backup.py restaurar       recria o banco a partir de dados/digiagro.sql
    python backup.py restaurar --sim (restaura sem perguntar)

Feche o servidor antes de restaurar.
"""
import argparse
import os
import shutil
import sqlite3
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DIGIAGRO_DB", BASE / "digiagro.db"))      # mesmo caminho do server.py
DUMP = Path(os.environ.get("DIGIAGRO_DUMP", BASE / "dados" / "digiagro.sql"))
SCHEMA = BASE / "schema.sql"

# A ordem importa: quem é referenciado vem antes (chaves estrangeiras).
# A tabela 'sessoes' fica de fora de propósito: login não deve ir para o Git.
TABELAS = ["usuarios", "culturas", "insumos", "lancamentos", "colheitas"]


def salvar():
    if not DB_PATH.exists():
        raise SystemExit(f"Banco não encontrado em {DB_PATH}. Rode o servidor ao menos uma vez.")
    con = sqlite3.connect(DB_PATH)
    linhas = [
        "-- DigiAgro: cópia do banco de dados em texto (gerada por backup.py).",
        "-- Restaure com:  python backup.py restaurar",
        "BEGIN;",
    ]
    resumo = []
    for tabela in TABELAS:
        colunas = [c[1] for c in con.execute(f"PRAGMA table_info({tabela})")]
        # quote() devolve cada valor já escapado como literal SQL (texto, número, NULL...)
        consulta = f"SELECT {', '.join(f'quote({c})' for c in colunas)} FROM {tabela} ORDER BY id"
        qtd = 0
        for valores in con.execute(consulta):
            linhas.append(f"INSERT INTO {tabela} ({', '.join(colunas)}) VALUES ({', '.join(valores)});")
            qtd += 1
        resumo.append(f"{qtd} {tabela}")
    linhas.append("COMMIT;")
    con.close()
    DUMP.parent.mkdir(parents=True, exist_ok=True)
    with open(DUMP, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(linhas) + "\n")
    print(f"Backup salvo em {DUMP}")
    print("  " + " · ".join(resumo))


def restaurar(perguntar=False):
    if not DUMP.exists():
        raise SystemExit(f"Não achei {DUMP}.\nRode 'python backup.py salvar' no computador onde estão os dados "
                         "e envie o arquivo (git push).")
    # 1) monta o banco novo num arquivo temporário e confere tudo ANTES de mexer no atual
    tmp = DB_PATH.with_name(DB_PATH.name + ".restaurando")
    for extra in ("", "-wal", "-shm", "-journal"):
        Path(str(tmp) + extra).unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    try:
        con.executescript(SCHEMA.read_text(encoding="utf-8"))
        con.executescript(DUMP.read_text(encoding="utf-8"))
        problemas = con.execute("PRAGMA foreign_key_check").fetchall()
        if problemas:
            raise ValueError("há registros ligados a algo que não existe")
        con.commit()
    except Exception as e:
        con.close()
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"O backup está inválido ({e}).\nO banco atual NÃO foi alterado.")
    con.close()

    # 2) se já existe um banco, guarda uma cópia antes de substituir
    if DB_PATH.exists():
        if perguntar:
            resp = input("Já existe um banco neste computador. Substituir pelo backup? (s/N) ").strip().lower()
            if resp not in ("s", "sim"):
                tmp.unlink(missing_ok=True)
                print("Cancelado. Nada foi alterado.")
                return False
        copia = DB_PATH.with_name(DB_PATH.name + ".antes-do-restore")
        shutil.copy2(DB_PATH, copia)
        print(f"Cópia do banco antigo guardada em {copia}")
        for extra in ("-wal", "-shm"):
            Path(str(DB_PATH) + extra).unlink(missing_ok=True)
    os.replace(tmp, DB_PATH)
    print(f"Banco restaurado de {DUMP}")
    return True


def main():
    ap = argparse.ArgumentParser(description="Backup do banco do DigiAgro em texto (para o Git).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("salvar", help="exporta o banco para dados/digiagro.sql")
    r = sub.add_parser("restaurar", help="recria o banco a partir de dados/digiagro.sql")
    r.add_argument("--sim", action="store_true", help="não perguntar antes de substituir")
    args = ap.parse_args()
    if args.cmd == "salvar":
        salvar()
    else:
        restaurar(perguntar=not args.sim)


if __name__ == "__main__":
    main()
