'use strict';
/* ════════════════════════════════════════════════════════════
   DigiAgro — front-end
   Todos os dados vêm do banco de dados (SQLite) via API.
   No navegador fica guardado só o token de login e o tema.
════════════════════════════════════════════════════════════ */

const S = { usuario: null, culturas: [], lancamentos: [], insumos: [], colheitas: [], pagina: 'dashboard' };
let token = localStorage.getItem('digiagro_token');
const filtro = { cultura: 'todas', lanc: 'todos', insumo: 'todos' };
const charts = {};
const PAGINAS = {};
const TITULOS = { dashboard: 'Dashboard', culturas: 'Culturas', colheitas: 'Colheitas', financeiro: 'Lançamentos',
                  insumos: 'Insumos', relatorios: 'Relatórios', perfil: 'Meu perfil' };

/* ───────── utilidades ───────── */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n) || 0;
const brl = n => 'R$ ' + num(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = n => 'R$ ' + num(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const kg = n => (num(n) % 1 ? num(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : num(n).toLocaleString('pt-BR')) + ' kg';
const fmt = (n, d = 1) => num(n).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dataBR = d => (d ? d.split('-').reverse().join('/') : '—');
const soma = (arr, f) => arr.reduce((s, x) => s + num(f(x)), 0);
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const nomeCultura = id => { const c = S.culturas.find(x => x.id === id); return c ? `${c.nome} (${c.gleba})` : '—'; };
const receitas = () => soma(S.lancamentos.filter(l => l.tipo === 'receita'), l => l.valor);
const despesas = () => soma(S.lancamentos.filter(l => l.tipo === 'despesa'), l => l.valor);

function meses(n) {
  const out = [], h = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(h.getFullYear(), h.getMonth() - i, 1);
    out.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
               rotulo: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][d.getMonth()] + '/' + String(d.getFullYear()).slice(2) });
  }
  return out;
}

function toast(msg, tipo = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + (tipo === 'ok' ? '' : tipo);
  t.textContent = (tipo === 'error' ? '❌ ' : tipo === 'warning' ? '⚠️ ' : '✅ ') + msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, 3200);
}

function confirmar(titulo, msg) {
  return new Promise(resolve => {
    $('c-titulo').textContent = titulo; $('c-msg').textContent = msg;
    $('confirma').classList.add('open');
    const fim = r => { $('confirma').classList.remove('open'); resolve(r); };
    $('c-sim').onclick = () => fim(true); $('c-nao').onclick = () => fim(false);
  });
}

/* ───────── API ───────── */
function statusBanco(ok) {
  const el = document.querySelector('.status-db');
  if (!el) return;
  el.lastChild.textContent = ok ? ' Banco conectado' : ' Servidor offline';
  el.firstElementChild.style.background = ok ? '' : 'var(--red)';
  el.firstElementChild.style.boxShadow = ok ? '' : '0 0 8px var(--red)';
}

async function api(metodo, caminho, corpo) {
  const opts = { method: metodo, headers: {} };
  if (token) opts.headers.Authorization = 'Bearer ' + token;
  if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
  let resp;
  try { resp = await fetch('/api/' + caminho, opts); }
  catch { statusBanco(false); throw new Error('Não foi possível falar com o servidor. Ele está rodando?'); }
  statusBanco(true);
  const dados = await resp.json().catch(() => ({}));
  if (resp.status === 401 && token) { encerrarSessao(); throw new Error(dados.erro || 'Sessão expirada. Entre novamente.'); }
  if (!resp.ok) throw new Error(dados.erro || 'Erro inesperado.');
  return dados;
}

async function carregarDados() {
  const d = await api('GET', 'dados');
  S.culturas = d.culturas; S.lancamentos = d.lancamentos; S.insumos = d.insumos; S.colheitas = d.colheitas;
  ['culturas', 'colheitas', 'lancamentos', 'insumos'].forEach(k => { $('n-' + k).textContent = S[k].length; });
}

/* ───────── tema ───────── */
function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('digiagro_tema', t);
  $('toggle-tema').classList.toggle('on', t === 'light');
}
function alternarTema() { aplicarTema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); irPara(S.pagina); }

/* ───────── autenticação ───────── */
function trocarAba(aba) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.aba === aba));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.toggle('active', f.id === 'form-' + aba));
}
function erroAuth(id, msg) { const e = $(id); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; }

async function autenticar(caminho, corpo, idErro, idBtn) {
  erroAuth(idErro, ''); $(idBtn).disabled = true; token = null;
  try {
    const r = await api('POST', caminho, corpo);
    token = r.token; localStorage.setItem('digiagro_token', token); S.usuario = r.usuario;
    await carregarDados(); abrirApp();
  } catch (e) { erroAuth(idErro, e.message); }
  finally { $(idBtn).disabled = false; }
}
function entrar(ev) { ev.preventDefault(); autenticar('login', { username: $('l-user').value.trim(), senha: $('l-pass').value }, 'l-err', 'l-btn'); }
function cadastrar(ev) {
  ev.preventDefault();
  autenticar('registrar', { username: $('r-user').value.trim(), senha: $('r-pass').value, nome: $('r-nome').value, propriedade: $('r-prop').value,
    email: $('r-email').value, telefone: $('r-tel').value, cidade: $('r-cidade').value, area_total: $('r-area').value }, 'r-err', 'r-btn');
}

function encerrarSessao() {
  token = null; localStorage.removeItem('digiagro_token'); S.usuario = null;
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
  $('app').hidden = true; $('auth').hidden = false;
  $('l-pass').value = '';
}
async function sair() { try { await api('POST', 'logout'); } catch { /* sessão já inválida */ } encerrarSessao(); toast('Até logo!'); }

function abrirApp() {
  $('auth').hidden = true; $('app').hidden = false;
  atualizarUsuarioNaTela(); irPara('dashboard');
}
function atualizarUsuarioNaTela() {
  const u = S.usuario, ini = (u.nome || u.username).charAt(0).toUpperCase();
  $('sb-avatar').textContent = ini; $('top-avatar').textContent = ini;
  $('sb-nome').textContent = u.nome || u.username; $('sb-prop').textContent = u.propriedade || '';
}

/* ───────── navegação ───────── */
function irPara(p) {
  S.pagina = p;
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === p));
  $('crumb').textContent = TITULOS[p];
  PAGINAS[p]();
  window.scrollTo(0, 0);
  $('sidebar').classList.remove('open');
}
function recolherMenu() { $('sidebar').classList.toggle('mini'); $('main').classList.toggle('mini'); }
function menuMobile() { $('sidebar').classList.toggle('open'); }

/* ───────── gráficos ───────── */
function cores() {
  const escuro = document.documentElement.dataset.theme !== 'light';
  return { verde: escuro ? 'rgba(61,214,140,.78)' : 'rgba(13,138,69,.78)', verdeS: escuro ? '#3DD68C' : '#0D8A45',
           verm: escuro ? 'rgba(240,90,90,.72)' : 'rgba(204,48,48,.72)', ambar: escuro ? 'rgba(240,176,64,.75)' : 'rgba(168,106,8,.75)',
           azul: escuro ? 'rgba(80,184,240,.75)' : 'rgba(15,104,168,.75)', roxo: escuro ? 'rgba(176,128,240,.75)' : 'rgba(107,61,186,.75)',
           grade: escuro ? 'rgba(61,214,140,.07)' : 'rgba(13,138,69,.09)', rot: escuro ? '#6F9376' : '#6F8F76', txt: escuro ? '#8BB094' : '#3D6545' };
}
function grafico(id, cfg) { const c = $(id); if (!c) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(c, cfg); }
function eixos(c, fmtY) {
  return { x: { grid: { color: c.grade }, ticks: { color: c.rot, font: { size: 10 } } },
           y: { grid: { color: c.grade }, ticks: { color: c.rot, font: { size: 10 }, callback: fmtY || (v => v) } } };
}
const kfmt = v => (Math.abs(v) >= 1000 ? 'R$' + (v / 1000).toFixed(0) + 'k' : 'R$' + v);

/* ───────── blocos de HTML ───────── */
const metrica = (l, v, s = '', cor = '', cls = '') => `<div class="metric ${cls}"><div class="l">${l}</div><div class="v ${cor}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const cabecalho = (titulo, sub, botoes = '') => `<div class="page-header"><div><div class="page-title">${titulo}</div><div class="page-sub" id="sub">${sub}</div></div><div class="page-actions">${botoes}</div></div>`;
const vazio = (emoji, txt, botao = '') => `<div class="vazio"><div class="e">${emoji}</div><b>${txt}</b>${botao}</div>`;
const badgeStatus = s => `<span class="badge ${{ Plantio: 'b-blue', Crescimento: 'b-amber', Colheita: 'b-green', 'Concluído': 'b-gray' }[s] || 'b-gray'}">${esc(s)}</span>`;
const abas = (chave, itens) => `<div class="abas">${itens.map(([v, r]) => `<button class="aba ${filtro[chave] === v ? 'active' : ''}" onclick="setFiltro('${chave}','${v}',this)">${r}</button>`).join('')}</div>`;
const btnsLinha = (rec, id) => `<div class="acoes"><button class="btn btn-xs btn-ghost" onclick="abrirForm('${rec}',${id})" title="Editar">✏️</button><button class="btn btn-xs btn-danger" onclick="apagar('${rec}',${id})" title="Apagar">🗑</button></div>`;
const btnNovo = (rec, rot) => `<button class="btn btn-primary btn-sm" onclick="abrirForm('${rec}')">+ ${rot}</button>`;
const btnCsv = rec => `<button class="btn btn-ghost btn-sm" onclick="exportarCSV('${rec}')">⬇ CSV</button>`;

const ATUALIZAR = {};
function setFiltro(chave, valor, btn) {
  filtro[chave] = valor;
  btn.parentElement.querySelectorAll('.aba').forEach(b => b.classList.toggle('active', b === btn));
  ATUALIZAR[S.pagina]();
}

/* ═════════ DASHBOARD ═════════ */
PAGINAS.dashboard = () => {
  const rec = receitas(), des = despesas(), lucro = rec - des;
  const data = new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const ultimos = S.lancamentos.slice(0, 6);
  $('conteudo').innerHTML = cabecalho('Dashboard <em>·</em>', data,
    `<button class="btn btn-ghost btn-sm" onclick="irPara('dashboard')">↺ Atualizar</button>${btnNovo('lancamentos', 'Lançamento')}`) + `
    <div class="metrics">
      ${metrica('Receitas', brl0(rec), S.lancamentos.filter(l => l.tipo === 'receita').length + ' lançamentos', 'green')}
      ${metrica('Despesas', brl0(des), S.lancamentos.filter(l => l.tipo === 'despesa').length + ' lançamentos', 'red', 'red')}
      ${metrica('Lucro / saldo', brl0(lucro), lucro >= 0 ? 'Resultado positivo' : 'Resultado negativo', lucro >= 0 ? 'green' : 'red')}
      ${metrica('Área cultivada', fmt(soma(S.culturas, c => c.area)) + ' ha', S.culturas.length + ' cultura(s)', 'blue', 'blue')}
      ${metrica('Total colhido', kg(soma(S.colheitas, c => c.volume_kg)), S.colheitas.length + ' colheita(s)', 'amber', 'amber')}
      ${metrica('Custo de insumos', brl0(soma(S.insumos, i => i.custo_total)), S.insumos.length + ' item(s)', 'purple', 'purple')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div class="card-title">Receitas × despesas</div>
        <select class="sel" id="periodo" onchange="graficoBarras()"><option value="6">6 meses</option><option value="12">12 meses</option></select></div>
        <div class="chart-box"><canvas id="gBarras"></canvas></div></div>
      <div class="card"><div class="card-head"><div class="card-title">Despesas por categoria</div></div>
        <div class="chart-box"><canvas id="gRosca"></canvas></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div class="card-title">Culturas</div><button class="btn btn-xs btn-ghost" onclick="irPara('culturas')">Ver todas →</button></div>
        ${S.culturas.length ? S.culturas.slice(0, 6).map(c => `<div class="linha"><div><div class="t">${esc(c.nome)}</div><div class="m">${esc(c.gleba)} · ${fmt(c.area)} ha${c.variedade ? ' · ' + esc(c.variedade) : ''}</div></div>${badgeStatus(c.status)}</div>`).join('')
          : vazio('🌱', 'Nenhuma cultura ainda', btnNovo('culturas', 'Nova cultura'))}</div>
      <div class="card"><div class="card-head"><div class="card-title">Últimos lançamentos</div><button class="btn btn-xs btn-ghost" onclick="irPara('financeiro')">Ver todos →</button></div>
        ${ultimos.length ? ultimos.map(l => `<div class="linha"><div><div class="t">${esc(l.descricao)}</div><div class="m">${dataBR(l.data)} · ${esc(l.categoria || '—')}</div></div><div class="fw td-mono ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'receita' ? '+' : '−'} ${brl(l.valor)}</div></div>`).join('')
          : vazio('💰', 'Nenhum lançamento ainda', btnNovo('lancamentos', 'Lançamento'))}</div>
    </div>`;
  graficoBarras();
  const porCat = {};
  S.lancamentos.filter(l => l.tipo === 'despesa').forEach(l => { const k = l.categoria || 'Outro'; porCat[k] = (porCat[k] || 0) + l.valor; });
  const c = cores();
  grafico('gRosca', { type: 'doughnut', data: { labels: Object.keys(porCat), datasets: [{ data: Object.values(porCat), backgroundColor: [c.verde, c.verm, c.ambar, c.azul, c.roxo, 'rgba(120,200,160,.7)', 'rgba(200,150,90,.7)'], borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: c.txt, font: { size: 10 }, boxWidth: 10, padding: 8 } } } } });
};
function graficoBarras() {
  const n = parseInt(($('periodo') || {}).value || '6'), ms = meses(n), c = cores();
  const por = tipo => ms.map(m => soma(S.lancamentos.filter(l => l.tipo === tipo && (l.data || '').startsWith(m.chave)), l => l.valor));
  grafico('gBarras', { type: 'bar', data: { labels: ms.map(m => m.rotulo), datasets: [
      { label: 'Receitas', data: por('receita'), backgroundColor: c.verde, borderRadius: 5, borderSkipped: false },
      { label: 'Despesas', data: por('despesa'), backgroundColor: c.verm, borderRadius: 5, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: c.txt, font: { size: 11 }, boxWidth: 10 } } }, scales: eixos(c, kfmt) } });
}

/* ═════════ CULTURAS ═════════ */
PAGINAS.culturas = () => {
  $('conteudo').innerHTML = cabecalho('Culturas', '', btnNovo('culturas', 'Nova cultura')) + `
    <div class="card"><div class="controles">
      ${abas('cultura', [['todas', 'Todas'], ['Plantio', 'Plantio'], ['Crescimento', 'Crescimento'], ['Colheita', 'Colheita'], ['Concluído', 'Concluídas']])}
      <input class="busca" id="busca" placeholder="Buscar cultura ou gleba..." oninput="tabelaCulturas()"></div>
      <div class="tabela-wrap"><table><thead><tr><th>Cultura</th><th>Gleba</th><th>Área</th><th>Plantio</th><th>Prev. colheita</th><th>Status</th><th>Observações</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  tabelaCulturas();
};
function tabelaCulturas() {
  const q = ($('busca').value || '').toLowerCase();
  const d = S.culturas.filter(c => (filtro.cultura === 'todas' || c.status === filtro.cultura) && (!q || (c.nome + ' ' + c.gleba).toLowerCase().includes(q)));
  $('sub').textContent = `${d.length} de ${S.culturas.length} cultura(s)`;
  $('tb').innerHTML = d.length ? d.map(c => `<tr>
    <td><span class="fw">${esc(c.nome)}</span>${c.variedade ? `<br><span class="muted">${esc(c.variedade)}</span>` : ''}</td>
    <td>${esc(c.gleba)}</td><td class="td-mono">${fmt(c.area, 2)} ha</td><td class="td-mono">${dataBR(c.data_plantio)}</td><td class="td-mono">${dataBR(c.previsao_colheita)}</td>
    <td>${badgeStatus(c.status)}</td><td class="muted ellip">${esc(c.observacoes || '—')}</td><td>${btnsLinha('culturas', c.id)}</td></tr>`).join('')
    : `<tr><td colspan="8">${vazio('🌱', 'Nenhuma cultura encontrada', btnNovo('culturas', 'Nova cultura'))}</td></tr>`;
};

/* ═════════ COLHEITAS ═════════ */
PAGINAS.colheitas = () => {
  const vol = soma(S.colheitas, c => c.volume_kg), rec = soma(S.colheitas, c => c.receita);
  const area = soma(S.culturas.filter(c => S.colheitas.some(h => h.cultura_id === c.id)), c => c.area);
  $('conteudo').innerHTML = cabecalho('Colheitas', '', btnCsv('colheitas') + btnNovo('colheitas', 'Registrar colheita')) + `
    <div class="metrics">
      ${metrica('Volume colhido', kg(vol), S.colheitas.length + ' colheita(s)', 'amber', 'amber')}
      ${metrica('Receita das colheitas', brl(rec), '', 'green')}
      ${metrica('Preço médio / kg', vol ? brl(rec / vol) : '—', '', 'blue', 'blue')}
      ${metrica('Produtividade média', area ? fmt(vol / area, 0) + ' kg/ha' : '—', '', 'purple', 'purple')}
    </div>
    <div class="card"><div class="controles"><input class="busca" id="busca" placeholder="Buscar colheita..." oninput="tabelaColheitas()"></div>
      <div class="tabela-wrap"><table><thead><tr><th>Cultura / gleba</th><th>Data</th><th>Volume</th><th>Receita</th><th>Preço/kg</th><th>°Brix</th><th>Qualidade</th><th>Destino</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  tabelaColheitas();
};
function tabelaColheitas() {
  const q = ($('busca').value || '').toLowerCase();
  const d = S.colheitas.filter(h => !q || nomeCultura(h.cultura_id).toLowerCase().includes(q));
  $('sub').textContent = `${d.length} de ${S.colheitas.length} colheita(s)`;
  $('tb').innerHTML = d.length ? d.map(h => `<tr>
    <td class="fw">${esc(nomeCultura(h.cultura_id))}</td><td class="td-mono">${dataBR(h.data_colheita)}</td><td class="td-mono fw">${kg(h.volume_kg)}</td>
    <td class="td-mono pos fw">${brl(h.receita)}</td><td class="td-mono muted">${h.volume_kg ? brl(h.receita / h.volume_kg) : '—'}</td>
    <td class="td-mono muted">${h.brix != null ? fmt(h.brix) : '—'}</td><td class="muted">${esc(h.qualidade || '—')}</td><td class="muted">${esc(h.destino || '—')}</td><td>${btnsLinha('colheitas', h.id)}</td></tr>`).join('')
    : `<tr><td colspan="9">${vazio('🚜', 'Nenhuma colheita registrada', btnNovo('colheitas', 'Registrar colheita'))}</td></tr>`;
};

/* ═════════ FINANCEIRO ═════════ */
const CATEGORIAS = ['Venda', 'Serviço', 'Insumo', 'Equipamento', 'Mão de obra', 'Financiamento', 'Outro'];
PAGINAS.financeiro = () => {
  const rec = receitas(), des = despesas();
  $('conteudo').innerHTML = cabecalho('Lançamentos', '', btnCsv('lancamentos') + btnNovo('lancamentos', 'Lançamento')) + `
    <div class="metrics">
      ${metrica('Receitas', brl(rec), '', 'green')}${metrica('Despesas', brl(des), '', 'red', 'red')}
      ${metrica('Saldo', brl(rec - des), '', rec - des >= 0 ? 'green' : 'red')}
      <div class="metric amber"><div class="l">Saldo do filtro</div><div class="v" id="m-filtrado">—</div><div class="s" id="m-filtrado-n"></div></div>
    </div>
    <div class="card"><div class="controles">
      ${abas('lanc', [['todos', 'Todos'], ['receita', 'Receitas'], ['despesa', 'Despesas']])}
      <div class="abas"><select class="sel" id="f-cat" onchange="tabelaFinanceiro()"><option value="">Todas as categorias</option>${CATEGORIAS.map(c => `<option>${c}</option>`).join('')}</select>
      <input class="busca" id="busca" placeholder="Buscar..." oninput="tabelaFinanceiro()"></div></div>
      <div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Valor</th><th>Cultura</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  tabelaFinanceiro();
};
function tabelaFinanceiro() {
  const q = ($('busca').value || '').toLowerCase(), cat = $('f-cat').value;
  const d = S.lancamentos.filter(l => (filtro.lanc === 'todos' || l.tipo === filtro.lanc) && (!cat || l.categoria === cat) && (!q || l.descricao.toLowerCase().includes(q)));
  $('sub').textContent = `${d.length} de ${S.lancamentos.length} lançamento(s)`;
  const saldoF = soma(d.filter(l => l.tipo === 'receita'), l => l.valor) - soma(d.filter(l => l.tipo === 'despesa'), l => l.valor);
  $('m-filtrado').textContent = brl(saldoF); $('m-filtrado').className = 'v ' + (saldoF >= 0 ? 'green' : 'red'); $('m-filtrado-n').textContent = d.length + ' item(s)';
  $('tb').innerHTML = d.length ? d.map(l => `<tr>
    <td class="td-mono">${dataBR(l.data)}</td><td><span class="fw">${esc(l.descricao)}</span>${l.insumo_id ? '<br><span class="muted">gerado automaticamente pelo insumo</span>' : (l.forma_pagamento ? `<br><span class="muted">${esc(l.forma_pagamento)}</span>` : '')}</td>
    <td><span class="tag">${esc(l.categoria || '—')}</span></td><td>${l.tipo === 'receita' ? '<span class="badge b-green">Receita</span>' : '<span class="badge b-red">Despesa</span>'}</td>
    <td class="td-mono fw ${l.tipo === 'receita' ? 'pos' : 'neg'}">${brl(l.valor)}</td><td class="muted">${l.cultura_id ? esc(nomeCultura(l.cultura_id)) : '—'}</td><td>${l.insumo_id ? `<button class="btn btn-xs btn-ghost" onclick="irPara('insumos')" title="Gerado por um insumo. Para alterar, edite o insumo.">📦 Insumo</button>` : btnsLinha('lancamentos', l.id)}</td></tr>`).join('')
    : `<tr><td colspan="7">${vazio('💰', 'Nenhum lançamento encontrado', btnNovo('lancamentos', 'Lançamento'))}</td></tr>`;
};

/* ═════════ INSUMOS ═════════ */
const TIPOS_INSUMO = ['Fertilizante', 'Defensivo', 'Muda', 'Embalagem', 'Combustível', 'Lubrificante', 'Outro'];
PAGINAS.insumos = () => {
  const tot = soma(S.insumos, i => i.custo_total), area = soma(S.culturas, c => c.area);
  const porTipo = {}; S.insumos.forEach(i => { porTipo[i.tipo || 'Outro'] = (porTipo[i.tipo || 'Outro'] || 0) + i.custo_total; });
  const maior = Object.entries(porTipo).sort((a, b) => b[1] - a[1])[0];
  $('conteudo').innerHTML = cabecalho('Insumos', '', btnCsv('insumos') + btnNovo('insumos', 'Novo insumo')) + `
    <div class="nota">💡 Cada insumo cadastrado é lançado automaticamente como <b>despesa</b> no financeiro e já desconta do lucro. Se você editar ou apagar o insumo, a despesa acompanha.</div>
    <div class="metrics">
      ${metrica('Total gasto', brl(tot), S.insumos.length + ' item(s)', 'red', 'red')}
      ${metrica('Maior categoria', maior ? maior[0] : '—', maior ? brl(maior[1]) : '', 'amber', 'amber')}
      ${metrica('Custo por hectare', area ? brl(tot / area) : '—', '', 'blue', 'blue')}
    </div>
    <div class="card"><div class="controles">
      ${abas('insumo', [['todos', 'Todos'], ['Fertilizante', 'Fertilizantes'], ['Defensivo', 'Defensivos'], ['Muda', 'Mudas'], ['Embalagem', 'Embalagens']])}
      <input class="busca" id="busca" placeholder="Buscar insumo..." oninput="tabelaInsumos()"></div>
      <div class="tabela-wrap"><table><thead><tr><th>Insumo</th><th>Tipo</th><th>Qtd.</th><th>Custo total</th><th>Custo/un.</th><th>Data</th><th>Fornecedor</th><th>Cultura</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div>`;
  tabelaInsumos();
};
function tabelaInsumos() {
  const q = ($('busca').value || '').toLowerCase();
  const d = S.insumos.filter(i => (filtro.insumo === 'todos' || i.tipo === filtro.insumo) && (!q || i.nome.toLowerCase().includes(q)));
  $('sub').textContent = `${d.length} de ${S.insumos.length} insumo(s)`;
  $('tb').innerHTML = d.length ? d.map(i => `<tr>
    <td><span class="fw">${esc(i.nome)}</span>${i.nota_fiscal ? `<br><span class="muted">NF ${esc(i.nota_fiscal)}</span>` : ''}</td><td><span class="tag">${esc(i.tipo || '—')}</span></td>
    <td class="td-mono">${fmt(i.quantidade, 2)} ${esc(i.unidade || '')}</td><td class="td-mono neg fw">${brl(i.custo_total)}</td>
    <td class="td-mono muted">${i.quantidade ? brl(i.custo_total / i.quantidade) : '—'}</td><td class="td-mono">${dataBR(i.data_compra)}</td>
    <td class="muted">${esc(i.fornecedor || '—')}</td><td class="muted">${i.cultura_id ? esc(nomeCultura(i.cultura_id)) : '—'}</td><td>${btnsLinha('insumos', i.id)}</td></tr>`).join('')
    : `<tr><td colspan="9">${vazio('📦', 'Nenhum insumo encontrado', btnNovo('insumos', 'Novo insumo'))}</td></tr>`;
};

/* ═════════ RELATÓRIOS ═════════ */
PAGINAS.relatorios = () => {
  const rec = receitas(), des = despesas(), vol = soma(S.colheitas, h => h.volume_kg);
  const area = soma(S.culturas.filter(c => S.colheitas.some(h => h.cultura_id === c.id)), c => c.area);
  const ms = meses(12); let acc = 0;
  const linhas = ms.map(m => {
    const r = soma(S.lancamentos.filter(l => l.tipo === 'receita' && (l.data || '').startsWith(m.chave)), l => l.valor);
    const d = soma(S.lancamentos.filter(l => l.tipo === 'despesa' && (l.data || '').startsWith(m.chave)), l => l.valor);
    acc += r - d;
    return `<tr><td class="td-mono">${m.rotulo}</td><td class="td-mono pos">${brl(r)}</td><td class="td-mono neg">${brl(d)}</td><td class="td-mono fw ${r - d >= 0 ? 'pos' : 'neg'}">${brl(r - d)}</td><td class="td-mono fw ${acc >= 0 ? 'pos' : 'neg'}">${brl(acc)}</td></tr>`;
  }).join('');
  $('conteudo').innerHTML = cabecalho('Relatórios', 'Análises e indicadores da propriedade', `<button class="btn btn-ghost btn-sm" onclick="window.print()">🖨 Imprimir</button>`) + `
    <div class="metrics">
      ${metrica('Receita bruta', brl(rec), '', 'green')}${metrica('Custo total', brl(des), '', 'red', 'red')}
      ${metrica('Lucro líquido', brl(rec - des), '', rec - des >= 0 ? 'green' : 'red')}
      ${metrica('Margem líquida', rec ? fmt((rec - des) / rec * 100) + '%' : '—', '', 'amber', 'amber')}
      ${metrica('Produtividade', area ? fmt(vol / area, 0) + ' kg/ha' : '—', '', 'purple', 'purple')}
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div class="card-title">Receita por categoria</div></div><div class="chart-box sm"><canvas id="gCat"></canvas></div></div>
      <div class="card"><div class="card-head"><div class="card-title">Gasto por tipo de insumo</div></div><div class="chart-box sm"><canvas id="gIns"></canvas></div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">Produtividade por cultura (kg/ha)</div></div><div class="chart-box"><canvas id="gProd"></canvas></div></div>
    <div class="card"><div class="card-head"><div class="card-title">Resumo financeiro mensal</div></div>
      <div class="tabela-wrap"><table><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th><th>Acumulado</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
  const c = cores(), soma2 = (arr, kf, vf) => { const o = {}; arr.forEach(x => { const k = kf(x) || 'Outro'; o[k] = (o[k] || 0) + vf(x); }); return o; };
  const cat = soma2(S.lancamentos.filter(l => l.tipo === 'receita'), l => l.categoria, l => l.valor);
  grafico('gCat', { type: 'pie', data: { labels: Object.keys(cat), datasets: [{ data: Object.values(cat), backgroundColor: [c.verde, c.ambar, c.azul, c.roxo, c.verm], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: c.txt, font: { size: 10 }, boxWidth: 10 } } } } });
  const ins = soma2(S.insumos, i => i.tipo, i => i.custo_total);
  grafico('gIns', { type: 'bar', data: { labels: Object.keys(ins), datasets: [{ data: Object.values(ins), backgroundColor: c.verm, borderRadius: 5, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: eixos(c, kfmt) } });
  const prod = S.culturas.filter(cu => S.colheitas.some(h => h.cultura_id === cu.id) && cu.area > 0)
    .map(cu => [`${cu.nome} (${cu.gleba})`, soma(S.colheitas.filter(h => h.cultura_id === cu.id), h => h.volume_kg) / cu.area]);
  grafico('gProd', { type: 'bar', data: { labels: prod.map(p => p[0]), datasets: [{ label: 'kg/ha', data: prod.map(p => p[1]), backgroundColor: c.verde, borderRadius: 5, borderSkipped: false }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: eixos(c, v => fmt(v, 0) + ' kg/ha') } });
};

/* ═════════ PERFIL ═════════ */
PAGINAS.perfil = () => {
  const u = S.usuario, linha = (k, v) => `<div class="info-row"><span class="k">${k}</span><span>${esc(v || '—')}</span></div>`;
  const total = S.culturas.length + S.lancamentos.length + S.insumos.length + S.colheitas.length;
  $('conteudo').innerHTML = cabecalho('Meu perfil', 'Dados da conta e da propriedade', `<button class="btn btn-primary btn-sm" onclick="abrirForm('perfil')">Editar perfil</button>`) + `
    <div class="grid-2">
      <div class="card"><div class="perfil-head"><div class="avatar">${esc((u.nome || u.username).charAt(0).toUpperCase())}</div><div><div class="n">${esc(u.nome)}</div><div class="muted mono">@${esc(u.username)}</div></div></div>
        ${linha('Propriedade', u.propriedade)}${linha('E-mail', u.email)}${linha('Telefone', u.telefone)}${linha('Cidade', u.cidade)}${linha('Área total', u.area_total ? fmt(u.area_total) + ' ha' : '')}${linha('Conta criada em', dataBR((u.criado_em || '').slice(0, 10)))}</div>
      <div class="card"><div class="card-head"><div class="card-title">Banco de dados</div></div>
        <div class="nota">Seus dados ficam salvos no banco <code>digiagro.db</code> (SQLite) no servidor, vinculados à sua conta. Outros usuários não têm acesso a eles.</div>
        <div class="metrics" style="grid-template-columns:1fr 1fr;margin-bottom:0">
          ${metrica('Culturas', S.culturas.length)}${metrica('Colheitas', S.colheitas.length)}${metrica('Lançamentos', S.lancamentos.length)}${metrica('Insumos', S.insumos.length)}</div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">Backup e dados</div></div>
      <div class="page-actions"><button class="btn btn-ghost btn-sm" onclick="exportarBackup()">📥 Baixar backup (JSON)</button>
      <button class="btn btn-danger btn-sm" onclick="limparDados()">🗑 Apagar toda a minha produção (${total} registros)</button></div></div>`;
};

/* ═════════ FORMULÁRIOS (modal genérico) ═════════ */
const CAMPOS = {
  culturas: { titulo: 'cultura', campos: [
    { n: 'nome', r: 'Cultura', req: 1, ph: 'Ex: Uva, Pêssego' }, { n: 'gleba', r: 'Gleba', req: 1, ph: 'Ex: Gleba A' },
    { n: 'area', r: 'Área (ha)', t: 'number', step: '0.01' }, { n: 'status', r: 'Status', t: 'select', op: ['Plantio', 'Crescimento', 'Colheita', 'Concluído'] },
    { n: 'data_plantio', r: 'Data de plantio', t: 'date', hoje: 1 }, { n: 'previsao_colheita', r: 'Previsão de colheita', t: 'date' },
    { n: 'variedade', r: 'Variedade / cultivar', ph: 'Ex: Niágara, Bordô, Chimarrita' }, { n: 'producao_estimada', r: 'Produção estimada (kg)', t: 'number', step: '1' },
    { n: 'observacoes', r: 'Observações', t: 'textarea', full: 1 }] },
  lancamentos: { titulo: 'lançamento', campos: [
    { n: 'descricao', r: 'Descrição', req: 1, ph: 'Ex: Venda de uva' }, { n: 'tipo', r: 'Tipo', t: 'select', op: ['receita', 'despesa'] },
    { n: 'valor', r: 'Valor (R$)', t: 'number', step: '0.01', req: 1 }, { n: 'data', r: 'Data', t: 'date', req: 1, hoje: 1 },
    { n: 'categoria', r: 'Categoria', t: 'select', op: CATEGORIAS }, { n: 'cultura_id', r: 'Cultura vinculada', t: 'cultura' },
    { n: 'forma_pagamento', r: 'Forma de pagamento', t: 'select', op: ['À vista', 'Boleto', 'PIX', 'Cheque', 'Financiamento', 'Outro'] },
    { n: 'observacoes', r: 'Observações', t: 'textarea', full: 1 }] },
  insumos: { titulo: 'insumo', aviso: 'Ao salvar, o custo total é lançado como despesa no financeiro e já desconta do lucro.', campos: [
    { n: 'nome', r: 'Nome', req: 1, ph: 'Ex: Fertilizante NPK' }, { n: 'tipo', r: 'Tipo', t: 'select', op: TIPOS_INSUMO },
    { n: 'quantidade', r: 'Quantidade', t: 'number', step: '0.01' }, { n: 'unidade', r: 'Unidade', t: 'select', op: ['kg', 'L', 'sacos', 'unidades', 't', 'm³'] },
    { n: 'custo_total', r: 'Custo total (R$)', t: 'number', step: '0.01' }, { n: 'data_compra', r: 'Data da compra', t: 'date', hoje: 1 },
    { n: 'fornecedor', r: 'Fornecedor' }, { n: 'cultura_id', r: 'Cultura vinculada', t: 'cultura' },
    { n: 'nota_fiscal', r: 'Nota fiscal' }, { n: 'observacoes', r: 'Observações', t: 'textarea', full: 1 }] },
  colheitas: { titulo: 'colheita', campos: [
    { n: 'cultura_id', r: 'Cultura / gleba', t: 'cultura', req: 1, full: 1 },
    { n: 'data_colheita', r: 'Data da colheita', t: 'date', req: 1, hoje: 1 }, { n: 'volume_kg', r: 'Volume colhido (kg)', t: 'number', step: '0.1', req: 1 },
    { n: 'receita', r: 'Receita obtida (R$)', t: 'number', step: '0.01' }, { n: 'destino', r: 'Destino', t: 'select', op: ['Cooperativa', 'Vinícola', 'Indústria', 'Feira / venda direta', 'Armazém próprio', 'Exportação', 'Outro'] },
    { n: 'brix', r: 'Grau Brix (°Brix)', t: 'number', step: '0.1' }, { n: 'qualidade', r: 'Qualidade', t: 'select', op: ['Extra', 'Primeira', 'Segunda', 'Industrial'] },
    { n: 'maquina', r: 'Equipe / equipamento', full: 1, ph: 'Ex: Equipe de 8 colhedores' }, { n: 'observacoes', r: 'Observações', t: 'textarea', full: 1 }] },
  perfil: { titulo: 'perfil', campos: [
    { n: 'nome', r: 'Nome completo', req: 1 }, { n: 'propriedade', r: 'Propriedade', req: 1 },
    { n: 'email', r: 'E-mail', t: 'email' }, { n: 'telefone', r: 'Telefone' }, { n: 'cidade', r: 'Cidade' },
    { n: 'area_total', r: 'Área total (ha)', t: 'number', step: '0.1' },
    { n: 'senha', r: 'Nova senha (opcional, mín. 6)', t: 'password', full: 1 }] },
};
let formAtual = null;

function campoHTML(c, v) {
  let val = v;
  if (val == null) val = c.hoje ? hoje() : '';
  let ctl;
  if (c.t === 'select') ctl = `<select id="f_${c.n}">${c.op.map(o => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (c.t === 'cultura') ctl = `<select id="f_${c.n}">${c.req ? '' : '<option value="">— Nenhuma —</option>'}${S.culturas.map(x => `<option value="${x.id}" ${x.id === val ? 'selected' : ''}>${esc(x.nome)} (${esc(x.gleba)})</option>`).join('')}</select>`;
  else if (c.t === 'textarea') ctl = `<textarea id="f_${c.n}" placeholder="${esc(c.ph || '')}">${esc(val)}</textarea>`;
  else ctl = `<input id="f_${c.n}" type="${c.t || 'text'}" ${c.step ? `step="${c.step}" min="0"` : ''} placeholder="${esc(c.ph || '')}" value="${esc(val)}" ${c.t === 'password' ? 'autocomplete="new-password"' : ''}>`;
  return `<div class="field ${c.full ? 'full' : ''}"><label>${esc(c.r)}${c.req ? ' *' : ''}</label>${ctl}</div>`;
}

function abrirForm(rec, id = null) {
  if (rec === 'colheitas' && !S.culturas.length) { toast('Cadastre uma cultura antes de registrar colheitas.', 'warning'); return; }
  const cfg = CAMPOS[rec];
  const item = rec === 'perfil' ? S.usuario : (id ? S[rec].find(x => x.id === id) : null);
  formAtual = { rec, id };
  $('modal-box').innerHTML = `<form onsubmit="salvarForm(event)">
    <div class="modal-head"><span class="modal-title">${rec === 'perfil' ? 'Editar perfil' : (id ? 'Editar ' : 'Nov' + (['culturas', 'colheitas'].includes(rec) ? 'a ' : 'o ')) + cfg.titulo}</span>
      <button type="button" class="icon-btn" onclick="fecharModal()">✕</button></div>
    <div class="modal-body">${cfg.aviso ? `<div class="nota">💡 ${esc(cfg.aviso)}</div>` : ''}<div class="form-grid">${cfg.campos.map(c => campoHTML(c, item ? item[c.n] : null)).join('')}</div></div>
    <div class="modal-foot"><button type="button" class="btn btn-ghost" onclick="fecharModal()">Cancelar</button><button class="btn btn-primary" id="btn-salvar">Salvar</button></div></form>`;
  $('modal').classList.add('open');
  setTimeout(() => { const p = $('modal-box').querySelector('input,select'); if (p) p.focus(); }, 50);
}
function fecharModal() { $('modal').classList.remove('open'); formAtual = null; }

async function salvarForm(ev) {
  ev.preventDefault();
  const { rec, id } = formAtual, corpo = {};
  for (const c of CAMPOS[rec].campos) {
    const v = $('f_' + c.n).value.trim();
    if (c.req && !v) { toast(`Preencha: ${c.r}`, 'error'); $('f_' + c.n).focus(); return; }
    corpo[c.n] = v === '' ? null : (c.t === 'number' || c.t === 'cultura' ? Number(v) : v);
  }
  $('btn-salvar').disabled = true;
  try {
    if (rec === 'perfil') { S.usuario = await api('PUT', 'eu', corpo); atualizarUsuarioNaTela(); }
    else await api(id ? 'PUT' : 'POST', rec + (id ? '/' + id : ''), corpo);
    await carregarDados(); fecharModal(); irPara(S.pagina);
    toast(rec === 'perfil' ? 'Perfil atualizado!' : rec === 'insumos' && corpo.custo_total > 0 ? `Insumo salvo! Despesa de ${brl(corpo.custo_total)} lançada no financeiro.` : (id ? 'Alterações salvas!' : 'Cadastro salvo!'));
  } catch (e) { toast(e.message, 'error'); const b = $('btn-salvar'); if (b) b.disabled = false; }
}

async function apagar(rec, id) {
  const item = S[rec].find(x => x.id === id);
  const nome = rec === 'culturas' ? `${item.nome} (${item.gleba})` : (item.descricao || item.nome || nomeCultura(item.cultura_id));
  const extra = rec === 'culturas' ? ' As colheitas dessa cultura também serão apagadas; lançamentos e insumos ligados a ela ficam sem cultura.'
    : rec === 'insumos' ? ' A despesa lançada no financeiro por esse insumo também será removida.' : '';
  if (!await confirmar('Apagar registro', `Apagar "${nome}"?${extra}`)) return;
  try { await api('DELETE', `${rec}/${id}`); await carregarDados(); irPara(S.pagina); toast('Registro apagado.', 'warning'); }
  catch (e) { toast(e.message, 'error'); }
}

async function limparDados() {
  if (!await confirmar('Apagar tudo', 'Isso apaga TODAS as suas culturas, colheitas, lançamentos e insumos do banco de dados. Sua conta continua existindo. Não dá para desfazer.')) return;
  try { await api('DELETE', 'dados'); await carregarDados(); irPara('perfil'); toast('Produção apagada.', 'warning'); }
  catch (e) { toast(e.message, 'error'); }
}

/* ───────── exportação ───────── */
function baixar(nome, conteudo, tipo) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome; a.click(); URL.revokeObjectURL(a.href);
}
function exportarCSV(rec) {
  const defs = {
    lancamentos: [['Data', 'data'], ['Descrição', 'descricao'], ['Tipo', 'tipo'], ['Categoria', 'categoria'], ['Valor', 'valor'], ['Cultura', r => r.cultura_id ? nomeCultura(r.cultura_id) : ''], ['Pagamento', 'forma_pagamento']],
    insumos: [['Insumo', 'nome'], ['Tipo', 'tipo'], ['Quantidade', 'quantidade'], ['Unidade', 'unidade'], ['Custo total', 'custo_total'], ['Data', 'data_compra'], ['Fornecedor', 'fornecedor'], ['Nota fiscal', 'nota_fiscal']],
    colheitas: [['Cultura/gleba', r => nomeCultura(r.cultura_id)], ['Data', 'data_colheita'], ['Volume (kg)', 'volume_kg'], ['Receita', 'receita'], ['Brix', 'brix'], ['Qualidade', 'qualidade'], ['Destino', 'destino']],
  }[rec];
  const cel = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [defs.map(d => cel(d[0])).join(';'), ...S[rec].map(r => defs.map(d => cel(typeof d[1] === 'function' ? d[1](r) : r[d[1]])).join(';'))];
  baixar(`digiagro_${rec}_${hoje()}.csv`, '\ufeff' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
  toast('CSV exportado!');
}
function exportarBackup() {
  const { culturas, lancamentos, insumos, colheitas } = S;
  baixar(`digiagro_backup_${hoje()}.json`, JSON.stringify({ exportado_em: new Date().toISOString(), usuario: S.usuario.username, dados: { culturas, lancamentos, insumos, colheitas } }, null, 2), 'application/json');
  toast('Backup baixado!');
}

Object.assign(ATUALIZAR, { culturas: tabelaCulturas, colheitas: tabelaColheitas, financeiro: tabelaFinanceiro, insumos: tabelaInsumos });

/* ───────── eventos globais e inicialização ───────── */
document.addEventListener('keydown', e => { if (e.key === 'Escape') { fecharModal(); $('confirma').classList.remove('open'); } });
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) fecharModal(); });

(async function iniciar() {
  aplicarTema(localStorage.getItem('digiagro_tema') || 'dark');
  if (!token) return;
  try { S.usuario = await api('GET', 'eu'); await carregarDados(); abrirApp(); }
  catch { encerrarSessao(); }
})();
