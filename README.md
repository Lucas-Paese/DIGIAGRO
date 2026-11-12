# DigiAgro — Sistema de Gestão Rural

Sistema web de gestão para pequenas propriedades rurais, com **banco de dados real (SQLite)**,
login de usuários e controle de culturas, colheitas, insumos e finanças.
Cada usuário só enxerga os dados que ele mesmo cadastrou.

## Como rodar

Precisa só do **Python 3.8+** (não precisa instalar mais nada).

```bash
python server.py        # no Windows pode ser:  py server.py   (ou dar dois cliques em iniciar.bat)
```

Depois abra **http://localhost:8000** no navegador.

- Usuário de teste: `admin` / `admin123` (já vem com dados de exemplo)
- Para criar a sua conta, use a aba **Cadastrar**
- Para parar o servidor: `Ctrl + C`

O banco é criado automaticamente na primeira execução no arquivo `digiagro.db`.
Para começar do zero, feche o servidor e apague esse arquivo.

> Já rodou uma versão anterior (que usava sacas)? O banco é atualizado sozinho, mas os números
> antigos continuam como estavam. Insumos cadastrados antes dessa versão não têm despesa automática até serem salvos de novo. Apague o `digiagro.db` para ver os dados de exemplo de fruticultura.

## Estrutura

```
digiagro/
├── server.py        servidor HTTP + API REST + acesso ao banco
├── schema.sql       modelo do banco de dados (tabelas e relacionamentos)
├── backup.py        exporta/restaura o banco em texto (para usar com o Git)
├── dados/           digiagro.sql = cópia do banco em texto (criada por backup.py)
├── digiagro.db      banco SQLite (criado ao rodar)
├── iniciar.bat      atalho para Windows
└── public/          interface (HTML, CSS e JavaScript)
    ├── index.html
    ├── style.css
    ├── app.js
    └── vendor/chart.umd.js   biblioteca de gráficos (já incluída, funciona offline)
```

## Git e o banco em vários computadores

O arquivo `digiagro.db` é binário e **fica fora do Git** (veja `.gitignore`). Os dados viajam por um
arquivo de texto, `dados/digiagro.sql`, que o Git versiona normalmente.

**Primeira vez: colocar o projeto no GitHub**

```bash
cd digiagro
git init
git add .
git commit -m "DigiAgro: primeira versão"
git branch -M main
# crie um repositório no GitHub (github.com/new), de preferência PRIVADO, e copie a URL:
git remote add origin https://github.com/SEU-USUARIO/digiagro.git
git push -u origin main
```

**Levar os dados para outro computador**

| Onde | O que fazer |
|---|---|
| Computador A (ao terminar) | `Ctrl+C` no servidor → `python backup.py salvar` → `git add .` → `git commit -m "Atualiza dados"` → `git push` |
| Computador B (primeira vez) | `git clone URL` → `python server.py` (sem banco, ele **restaura sozinho** de `dados/digiagro.sql`) |
| Computador B (já tem banco) | `git pull` → feche o servidor → `python backup.py restaurar` |

- Antes de substituir um banco existente, o `restaurar` guarda uma cópia em `digiagro.db.antes-do-restore`.
- Se o backup estiver corrompido, o `restaurar` avisa e **não mexe** no banco atual.
- Sem `dados/digiagro.sql`, a primeira execução cria o banco com os dados de exemplo (`admin` / `admin123`).
- Cuidado: o backup contém os usuários (e-mail, telefone e o *hash* das senhas). Use repositório
  **privado** se tiver dados reais.
- O Git sincroniza quando você faz `push`/`pull`, não em tempo real. Para vários computadores usando
  o mesmo banco ao mesmo tempo, o sistema precisa ficar hospedado em um servidor na internet.

## Vercel: o que funciona e o que não funciona

O DigiAgro tem duas partes: o **visual** (pasta `public/`, arquivos estáticos) e o **servidor com banco**
(`server.py` + SQLite). O Vercel só hospeda a primeira:

- O Vercel **não roda** o `server.py` (ele não mantém um servidor ligado) e **não guarda** o arquivo
  `digiagro.db` (o disco lá é temporário). Por isso, publicado só no Vercel, a tela aparece, mas
  login, cadastro e dados **não funcionam** (a tela mostra "A API do DigiAgro não respondeu").
- O `vercel.json` desta pasta manda o Vercel publicar **somente** a pasta `public/`. Assim o banco,
  os backups e o `server.py` nunca ficam acessíveis pela internet.
- Se o CSS não carregar: confira em *Project Settings → Build and Development Settings* se
  **Output Directory** está `public` e, se o projeto estiver dentro de uma subpasta do repositório,
  se **Root Directory** aponta para ela.
- Nunca suba o `digiagro.db` nem `dados/digiagro.sql` para um lugar público.

## Banco de dados

| Tabela | O que guarda |
|---|---|
| `usuarios` | login, senha (hash), nome, propriedade, contato, área total |
| `sessoes` | sessões de login (só o hash do token) |
| `culturas` | cultura, **gleba**, área, plantio, previsão de colheita, status, variedade |
| `colheitas` | volume em **kg**, receita, °Brix, qualidade, destino — ligada a uma cultura |
| `lancamentos` | receitas e despesas (categoria, forma de pagamento, cultura opcional) |
| `insumos` | mudas, fertilizantes, defensivos, embalagens... (custo, fornecedor, nota fiscal). **Cada insumo gera uma despesa automática em `lancamentos`**, que já desconta do lucro |

Relacionamentos (todos os registros de produção têm `usuario_id`):

```
usuarios 1 ──< culturas 1 ──< colheitas
    │              └────────< lancamentos (cultura opcional)
    │              └────────< insumos     (cultura opcional)
    ├──< lancamentos
    ├──< insumos
    └──< sessoes
```

- Ao cadastrar um **insumo** com custo, o sistema cria sozinho uma despesa (categoria *Insumo*) no financeiro. Editar o insumo atualiza a despesa; apagar o insumo apaga a despesa. Essa despesa só pode ser alterada pelo próprio insumo.
- Apagar uma **cultura** apaga as colheitas dela; lançamentos e insumos ligados a ela ficam sem cultura.
- Apagar um **usuário** apaga tudo que é dele (`ON DELETE CASCADE`).

Para ver o banco por dentro: `sqlite3 digiagro.db` (ou o programa gratuito *DB Browser for SQLite*).

## Segurança

- Senhas guardadas com **PBKDF2-SHA256 + sal** (nunca em texto puro)
- Token de sessão guardado no banco só como hash; expira em 7 dias
- Consultas SQL parametrizadas (protege contra SQL injection)
- Cada requisição confere o dono do registro (um usuário não acessa dados de outro)
- Bloqueio temporário após 5 senhas erradas
- O servidor escuta só neste computador (`127.0.0.1`). Para acessar de outros aparelhos da rede:
  `HOST=0.0.0.0 python server.py` (no Windows: `set HOST=0.0.0.0` antes). Nesse caso use uma senha forte
  no usuário `admin` ou apague-o, pois ele é o usuário de demonstração.

## API (resumo)

| Método | Rota | Função |
|---|---|---|
| POST | `/api/registrar` · `/api/login` · `/api/logout` | conta e sessão |
| GET/PUT | `/api/eu` | perfil do usuário logado |
| GET/DELETE | `/api/dados` | tudo do usuário / apagar toda a produção |
| GET/POST | `/api/culturas` (`lancamentos`, `insumos`, `colheitas`) | listar / criar |
| PUT/DELETE | `/api/culturas/{id}` (idem) | editar / apagar |

## Funcionalidades

Dashboard com gráficos · Culturas por gleba (uva, pêssego, caqui...) · Colheitas em kg e produtividade (kg/ha) · Lançamentos financeiros ·
Insumos · Relatórios (margem, produtividade, resumo mensal) · Perfil · Exportação CSV e backup JSON ·
Tema claro/escuro · Layout responsivo.
