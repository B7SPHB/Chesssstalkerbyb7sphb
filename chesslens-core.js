'use strict';
/* =====================================================================
 * ChessLens · core.js
 * Núcleo da plataforma: utilidades, armazenamento local, coleta de dados
 * (Chess.com / Lichess / PGN), estatísticas, árvore de aberturas e
 * comparação com a base de mestres.
 * Requer: Chart.js, chess.js (CDN) e features.js (tabuleiros/motor).
 * ===================================================================== */

/* ---------------- Utilitários ---------------- */
const $ = id => document.getElementById(id);
const norm = s => s.replace(/[+#?!]/g, '');
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => (+n).toLocaleString('pt-BR');
const DIAS = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'Inter','Segoe UI',sans-serif";

/* ---------------- Armazenamento ---------------- */
const PREF = (() => { try { return JSON.parse(localStorage.getItem('cl_prefs') || '{}'); } catch (e) { return {}; } })();
function savePref(k, v) { PREF[k] = v; try { localStorage.setItem('cl_prefs', JSON.stringify(PREF)); } catch (e) {} }

const HIST = (() => {
  const base = { an: [], prec: [], pgn: [], pdf: [] };
  try { return Object.assign(base, JSON.parse(localStorage.getItem('cl_hist') || '{}')); }
  catch (e) { return base; }
})();
function saveHist() { try { localStorage.setItem('cl_hist', JSON.stringify(HIST)); } catch (e) {} }

/* ---------------- Barra de progresso ---------------- */
function setProg(f) {
  const p = $('pbar');
  if (f === null) { p.style.opacity = 0; setTimeout(() => { p.style.width = '0'; p.style.opacity = 1; }, 600); }
  else p.style.width = Math.min(100, Math.round(f * 100)) + '%';
}

/* ---------------- Banco de armadilhas ---------------- */
const TRAPS = [
 {name:"Mate Pastor", side:'w', seq:["e4","e5","Qh5"],
  desc:"Ataque direto a f7 com dama e bispo. Refuta-se com Nc6 e g6 — nunca ignore a ameaça."},
 {name:"Mate Pastor (Bc4 antes)", side:'w', seq:["e4","e5","Bc4","Nc6","Qh5"],
  desc:"Mesma ideia com o bispo primeiro. g6 expulsa a dama com ganho de tempo."},
 {name:"Fried Liver", side:'w', seq:["e4","e5","Nf3","Nc6","Bc4","Nf6","Ng5","d5","exd5","Nxd5","Nxf7"],
  desc:"Sacrifício em f7 após Nxd5?!. As pretas devem preferir 5...Na5 (Polerio) em vez de Nxd5."},
 {name:"Mate de Légal", side:'w', seq:["e4","e5","Nf3","Nc6","Bc4","d6","Nc3","Bg4","Nxe5"],
  desc:"Falso sacrifício de dama: se Bxd1?? segue Bxf7+ e Nd5#. Cuidado ao cravar cedo com o bispo."},
 {name:"Blackburne Shilling", side:'b', seq:["e4","e5","Nf3","Nc6","Bc4","Nd4","Nxe5","Qg5"],
  desc:"Nd4!? convida Nxe5?? — a dama entra em g5 ganhando material ou dando mate em f2/g2."},
 {name:"Gambito Stafford", side:'b', seq:["e4","e5","Nf3","Nf6","Nxe5","Nc6","Nxc6","dxc6"],
  desc:"Gambito venenoso da Petrov: desenvolvimento rápido e ideias de Ng4/Bc5 contra f2."},
 {name:"Gambito Englund", side:'b', seq:["d4","e5","dxe5","Nc6","Nf3","Qe7","Bf4","Qb4"],
  desc:"Qb4+ ataca b2 e f4. Brancas devem jogar Bd2 (não Nc3?? por Qxb2)."},
 {name:"Armadilha de Lasker (Albin)", side:'b', seq:["d4","d5","c4","e5","dxe5","d4","e3","Bb4","Bd2","dxe3"],
  desc:"O peão d4 é intocável: e3?? permite Bb4+ e o famoso sub-promoção fxg1=N+!."},
 {name:"Armadilha do Elefante (GDR)", side:'b', seq:["d4","d5","c4","e6","Nc3","Nf6","Bg5","Nbd7","cxd5","exd5","Nxd5","Nxd5"],
  desc:"Nxd5?? perde peça: após Nxd5 Bxd1, o lance intermediário Bb4+ recupera a dama com lucro."},
 {name:"Fishing Pole (Ruy López)", side:'b', seq:["e4","e5","Nf3","Nc6","Bb5","Nf6","O-O","Ng4"],
  desc:"Ng4 com h5: se h3?? hxg4! abre a coluna h para um ataque de mate direto."},
 {name:"Kieninger (Gambito Budapeste)", side:'b', seq:["d4","Nf6","c4","e5","dxe5","Ng4","Bf4","Nc6","Nf3","Bb4","Nbd2","Qe7","a3","Ngxe5"],
  desc:"Se axb4?? segue Nd3#: mate sufocado no meio do tabuleiro. Clássico do Budapeste."},
 {name:"Arca de Noé (Ruy López)", side:'b', seq:["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","d6","d4","b5","Bb3","Nxd4","Nxd4","exd4"],
  desc:"Se Qxd4?? então c5 e c4 aprisionam o bispo de b3 — a 'arca' fecha e a peça cai."},
];

/* ---------------- Parsing de PGN ---------------- */
function movesFromPgn(pgn) {
  const parts = pgn.split(/\n\s*\n/);
  let text = parts.length > 1 ? parts.slice(1).join(' ') : pgn;
  text = text.replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ')
             .replace(/\$\d+/g, ' ').replace(/\d+\.+/g, ' ')
             .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ');
  return text.split(/\s+/).filter(t => t && t !== '...');
}
function hdr(pgn, k) { const m = pgn.match(new RegExp('\\[' + k + ' "([^"]*)"')); return m ? m[1] : null; }
function famName(n) {
  if (!n) return 'Desconhecida';
  let f = n.split(':')[0].split(',')[0];
  f = f.replace(/\s+\d.*$/, '').trim();
  return f || 'Desconhecida';
}
function ecoUrlName(url) {
  if (!url) return null;
  const slug = url.split('/').pop().replace(/-/g, ' ');
  return slug.replace(/\s+\d.*$/, '').trim();
}

/* ---------------- Coleta: Chess.com ---------------- */
async function fetchChessCom(user, maxg, st) {
  const r = await fetch(`https://api.chess.com/pub/player/${user}/games/archives`);
  if (!r.ok) throw new Error('Usuário não encontrado no Chess.com');
  const months = (await r.json()).archives.reverse();
  const recs = [];
  for (let i = 0; i < months.length && recs.length < maxg; i += 8) {
    const batch = months.slice(i, i + 8);
    st(`Baixando arquivos mensais… (${fmt(recs.length)}/${fmt(maxg)} partidas)`);
    setProg(recs.length / maxg);
    const results = await Promise.all(batch.map(m => fetch(m).then(x => x.json()).catch(() => ({ games: [] }))));
    for (const res of results) {
      for (const g of (res.games || []).reverse()) {
        if (recs.length >= maxg) break;
        if (g.rules !== 'chess' || !g.pgn) continue;
        const isW = g.white.username.toLowerCase() === user.toLowerCase();
        const me = isW ? g.white : g.black, op = isW ? g.black : g.white;
        let res2 = 'd';
        if (me.result === 'win') res2 = 'w';
        else if (['checkmated','timeout','resigned','abandoned','lose'].includes(me.result)) res2 = 'l';
        recs.push({
          color: isW ? 'w' : 'b', result: res2, myRating: me.rating, opRating: op.rating,
          opName: op.username, tc: g.time_class, ts: g.end_time * 1000, url: g.url,
          moves: movesFromPgn(g.pgn),
          opening: ecoUrlName(hdr(g.pgn, 'ECOUrl')) || hdr(g.pgn, 'ECO') || 'Desconhecida',
          term: me.result === 'win' ? op.result : me.result
        });
      }
    }
  }
  return recs;
}

/* ---------------- Coleta: Lichess (streaming NDJSON) ---------------- */
function liParse(ln, user) {
  let g; try { g = JSON.parse(ln); } catch (e) { return null; }
  if (g.variant !== 'standard' || !g.moves) return null;
  const wn = (g.players.white.user?.name || '').toLowerCase();
  const isW = wn === user.toLowerCase();
  const me = isW ? g.players.white : g.players.black;
  let res = 'd';
  if (g.winner) res = (g.winner === 'white') === isW ? 'w' : 'l';
  const term = { mate:'checkmated', resign:'resigned', outoftime:'timeout', timeout:'abandoned' }[g.status] || g.status;
  return {
    color: isW ? 'w' : 'b', result: res, myRating: me.rating || 0,
    opRating: (isW ? g.players.black : g.players.white).rating || 0,
    opName: (isW ? g.players.black : g.players.white).user?.name || '?',
    tc: g.speed, ts: g.createdAt, url: `https://lichess.org/${g.id}`,
    moves: g.moves.split(' '), opening: g.opening ? g.opening.name : 'Desconhecida',
    term: res === 'l' ? term : (res === 'w' ? 'win' : 'draw')
  };
}
async function fetchLichess(user, maxg, st) {
  st('Conectando ao Lichess…');
  const r = await fetch(`https://lichess.org/api/games/user/${user}?max=${maxg}&opening=true`,
    { headers: { Accept: 'application/x-ndjson' } });
  if (r.status === 429) throw new Error('O Lichess limitou as requisições — aguarde 1 minuto e tente de novo.');
  if (!r.ok) throw new Error('Usuário não encontrado no Lichess');
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = ''; const recs = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const ln of lines) { const rec = liParse(ln, user); if (rec) recs.push(rec); }
    st(`Baixando do Lichess… ${fmt(recs.length)} partidas`);
    setProg(recs.length / maxg);
  }
  if (buf.trim()) { const rec = liParse(buf, user); if (rec) recs.push(rec); }
  return recs;
}

/* ---------------- Coleta: arquivo PGN (FIDE/OTB) ---------------- */
function parsePgnFile(text, user) {
  const games = text.split(/\n(?=\[Event )/).filter(s => s.includes('['));
  const u = user.toLowerCase(); const recs = [];
  for (const p of games) {
    const w = (hdr(p, 'White') || '').toLowerCase(), b = (hdr(p, 'Black') || '').toLowerCase();
    let isW; if (w.includes(u)) isW = true; else if (b.includes(u)) isW = false; else continue;
    const R = hdr(p, 'Result') || '*'; let res = 'd';
    if (R === '1-0') res = isW ? 'w' : 'l'; else if (R === '0-1') res = isW ? 'l' : 'w'; else if (R === '*') continue;
    recs.push({
      color: isW ? 'w' : 'b', result: res,
      myRating: +(hdr(p, isW ? 'WhiteElo' : 'BlackElo') || 0), opRating: +(hdr(p, isW ? 'BlackElo' : 'WhiteElo') || 0),
      opName: isW ? (hdr(p, 'Black') || '?') : (hdr(p, 'White') || '?'),
      tc: 'clássico', ts: Date.parse(hdr(p, 'Date')?.replace(/\./g, '-') || '') || 0, url: null,
      moves: movesFromPgn(p), opening: hdr(p, 'Opening') || hdr(p, 'ECO') || 'Desconhecida',
      term: res === 'l' ? 'perdeu' : '—'
    });
  }
  return recs;
}

/* ---------------- Estado global ---------------- */
let RAW = { recs: [], user: '', plat: '' }, FILTERED = [], SUM_A = null, BIG = false;
let TILT = { maxW: 0, maxL: 0, tilts: 0, alPct: 0, overall: 0 };
let charts = {};
function chart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  if (BIG) { cfg.options = cfg.options || {}; cfg.options.animation = false; }
  charts[id] = new Chart($(id), cfg);
}
const pctc = p => p >= 55 ? 'good' : (p < 45 ? 'bad' : 'warn');
const pcol = p => p >= 55 ? '#34d399' : (p < 45 ? '#fb7185' : '#fbbf24');
function wdl(arr) {
  const w = arr.filter(g => g.result === 'w').length, l = arr.filter(g => g.result === 'l').length, d = arr.length - w - l;
  return { w, d, l, n: arr.length, p: arr.length ? Math.round(100 * (w + d * 0.5) / arr.length) : 0 };
}
function downsample(arr, n) {
  if (arr.length <= n) return arr;
  const out = [], step = arr.length / n;
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]); return out;
}

/* ---------------- Resumo estatístico (reutilizável) ---------------- */
const termMap = { checkmated:'Xeque-mate', timeout:'Tempo', resigned:'Desistiu', abandoned:'Abandonou', stalemate:'Afogamento', perdeu:'Derrota (PGN)' };
function grpTrap(arr) {
  const m = {}; arr.forEach(({ t, g }) => { (m[t.name] = m[t.name] || { n: 0, g }).n++; m[t.name].g = g; });
  return Object.entries(m).sort((a, b) => b[1].n - a[1].n);
}
function openingRows(recs, color) {
  const map = {};
  recs.forEach(g => { if (g.color !== color) return; const f = famName(g.opening); (map[f] = map[f] || []).push(g); });
  return Object.entries(map).map(([k, v]) => ({ op: k, ...wdl(v) })).sort((a, b) => b.n - a.n);
}
function summary(recs) {
  const s = {};
  s.all = wdl(recs);
  const rated = recs.filter(g => g.myRating > 0);
  s.curRating = rated.length ? rated[rated.length - 1].myRating : 0;
  const recent = rated.slice(-30);
  s.recentN = recent.length;
  // Elo estimado profissional: ritmo mais jogado + média ponderada exponencial
  // (partidas recentes pesam mais; ritmos misturados não contaminam a média)
  const rated60 = rated.slice(-60);
  const tcCount = {}; rated60.forEach(g => { tcCount[g.tc] = (tcCount[g.tc] || 0) + 1; });
  const favRatedTc = Object.keys(tcCount).sort((a, b) => tcCount[b] - tcCount[a])[0] || null;
  const pool = favRatedTc ? rated60.filter(g => g.tc === favRatedTc) : rated60;
  if (pool.length) {
    let ws = 0, vs = 0;
    pool.forEach((g, i) => { const w = Math.pow(0.93, pool.length - 1 - i); ws += w; vs += w * g.myRating; });
    s.estElo = Math.round(vs / ws);
  } else {
    s.estElo = recent.length ? Math.round(recent.reduce((a, g) => a + g.myRating, 0) / recent.length) : 1200;
  }
  s.estEloTc = favRatedTc;
  s.avgOpp = rated.length ? Math.round(rated.reduce((a, g) => a + g.opRating, 0) / rated.length) : 0;
  const tcs = {}; recs.forEach(g => { (tcs[g.tc] = tcs[g.tc] || []).push(g); });
  s.tcRows = Object.entries(tcs).map(([k, v]) => ({ k, ...wdl(v) })).sort((a, b) => b.n - a.n);
  s.favTc = s.tcRows.length ? s.tcRows[0].k : '—';
  s.wW = wdl(recs.filter(g => g.color === 'w'));
  s.wB = wdl(recs.filter(g => g.color === 'b'));
  s.opW = openingRows(recs, 'w'); s.opB = openingRows(recs, 'b');
  const sig = [...s.opW, ...s.opB].filter(r => r.n >= 5);
  s.best = [...sig].sort((a, b) => b.p - a.p).slice(0, 3);
  s.worst = [...sig].sort((a, b) => a.p - b.p).slice(0, 3);
  s.losses = recs.filter(g => g.result === 'l');
  s.timeLossPct = s.losses.length ? Math.round(100 * s.losses.filter(g => g.term === 'timeout').length / s.losses.length) : 0;
  s.minis = s.losses.filter(g => g.moves.length <= 24);
  s.fell = []; s.used = [];
  recs.forEach(g => {
    const mv = g.moves.map(norm);
    for (const t of TRAPS) {
      if (t.seq.length <= mv.length && t.seq.every((x, i) => mv[i] === x)) {
        if (g.color === t.side) { if (g.result === 'w') s.used.push({ t, g }); }
        else if (g.result === 'l') s.fell.push({ t, g });
      }
    }
  });
  return s;
}

/* ---------------- Tabela de aberturas ---------------- */
function tbl(rows) {
  if (!rows.length) return '<p style="color:var(--mut)">Sem dados suficientes.</p>';
  let h = '<table><tr><th>Abertura</th><th>Jogos</th><th>V / E / D</th><th>Aproveitamento</th></tr>';
  for (const r of rows) {
    const pts = String(r.w + r.d * 0.5).replace('.5', '½');
    h += `<tr><td>${esc(r.op)} <span class="chip" onclick="loadOpening(decodeURIComponent('${encodeURIComponent(r.op)}'))" title="ver sua linha mais jogada no tabuleiro">♟</span></td><td>${r.n}</td><td>${r.w} / ${r.d} / ${r.l}</td>
    <td><span class="pct ${pctc(r.p)}">${r.p}%</span> <small style="color:var(--mut)">(${pts} de ${r.n} pts)</small><div class="bar"><i style="width:${r.p}%"></i></div></td></tr>`;
  }
  return h + '</table>';
}

/* ---------------- Horários e tilt ---------------- */
function renderTime(recs) {
  const hs = Array.from({ length: 24 }, () => []), ds = Array.from({ length: 7 }, () => []);
  recs.forEach(g => { if (!g.ts) return; const d = new Date(g.ts); hs[d.getHours()].push(g); ds[d.getDay()].push(g); });
  const hl = [], hv = [], hbg = [];
  hs.forEach((a, i) => { if (a.length >= 5) { const x = wdl(a); hl.push(i + 'h (' + a.length + ')'); hv.push(x.p); hbg.push(pcol(x.p)); } });
  chart('chHour', { type:'bar', data:{ labels: hl, datasets:[{ data: hv, backgroundColor: hbg, borderRadius: 5 }] },
    options:{ plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => c.parsed.y + '% de aproveitamento' } } },
      scales:{ y:{ min:0, max:100 } } } });
  const dl = [], dv = [], dbg = [];
  ds.forEach((a, i) => { if (a.length) { const x = wdl(a); dl.push(DIAS[i] + ' (' + a.length + ')'); dv.push(x.p); dbg.push(pcol(x.p)); } });
  chart('chDay', { type:'bar', data:{ labels: dl, datasets:[{ data: dv, backgroundColor: dbg, borderRadius: 5 }] },
    options:{ plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label: c => c.parsed.y + '% de aproveitamento' } } },
      scales:{ y:{ min:0, max:100 } } } });

  let curL = 0, maxL = 0, curW = 0, maxW = 0, tilts = 0, alW = 0, alN = 0, prev = null;
  recs.forEach(g => {
    if (prev === 'l') { alN++; if (g.result === 'w') alW++; }
    if (g.result === 'l') { curL++; curW = 0; if (curL === 3) tilts++; }
    else if (g.result === 'w') { curW++; curL = 0; }
    else { curL = 0; curW = 0; }
    maxL = Math.max(maxL, curL); maxW = Math.max(maxW, curW);
    prev = g.result;
  });
  const alPct = alN ? Math.round(100 * alW / alN) : 0;
  const overall = wdl(recs).p;
  TILT = { maxW, maxL, tilts, alPct, overall };
  $('tiltStats').innerHTML = [
    ['Maior sequência de vitórias', `<span class="good">${maxW}</span>`],
    ['Maior sequência de derrotas', `<span class="bad">${maxL}</span>`],
    ['Sessões de tilt (3+ derrotas seguidas)', tilts],
    ['Vitórias logo após derrota', `<span class="${pctc(alPct)}">${alPct}%</span> <small style="color:var(--mut)">(${alW} de ${alN})</small>`]
  ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('tiltAdvice').textContent =
    alPct < overall - 8 ? `Você rende ${overall - alPct} pontos percentuais a menos na partida seguinte a uma derrota — sinal claro de tilt. Regra prática: 2 derrotas seguidas, pausa de 15 minutos.` :
    tilts >= Math.max(3, recs.length / 40) ? 'Sequências de 3+ derrotas são frequentes. Considere parar a sessão após 2 derrotas seguidas.' :
    'Bom controle emocional: seu desempenho pós-derrota se mantém estável.';
}

/* ---------------- Duração e recordes ---------------- */
function renderLenRecords(recs) {
  const buckets = [[1,20,'≤20'],[21,40,'21–40'],[41,60,'41–60'],[61,80,'61–80'],[81,9999,'80+']];
  const W = [], D = [], L = [], lb = [];
  for (const [a, b, label] of buckets) {
    const set = recs.filter(g => { const m = Math.ceil(g.moves.length / 2); return m >= a && m <= b; });
    lb.push(label + ' lances');
    W.push(set.filter(g => g.result === 'w').length);
    D.push(set.filter(g => g.result === 'd').length);
    L.push(set.filter(g => g.result === 'l').length);
  }
  chart('chLen', { type:'bar', data:{ labels: lb, datasets:[
    { label:'Vitórias', data: W, backgroundColor:'#34d399', borderRadius:4 },
    { label:'Empates', data: D, backgroundColor:'#94a3b8', borderRadius:4 },
    { label:'Derrotas', data: L, backgroundColor:'#fb7185', borderRadius:4 }] },
    options:{ scales:{ x:{ stacked:true }, y:{ stacked:true } } } });

  const rated = recs.filter(g => g.myRating > 0);
  const peak = rated.length ? rated.reduce((a, g) => g.myRating > a.myRating ? g : a) : null;
  const upsets = recs.filter(g => g.result === 'w' && g.opRating > g.myRating && g.myRating > 0);
  const upset = upsets.length ? upsets.reduce((a, g) => (g.opRating - g.myRating) > (a.opRating - a.myRating) ? g : a) : null;
  const longest = recs.length ? recs.reduce((a, g) => g.moves.length > a.moves.length ? g : a) : null;
  const wins = recs.filter(g => g.result === 'w' && g.moves.length >= 4);
  const fastest = wins.length ? wins.reduce((a, g) => g.moves.length < a.moves.length ? g : a) : null;
  const lk = g => g && g.url ? ` <a href="${g.url}" target="_blank">ver ↗</a>` : '';
  $('records').innerHTML = '<ul class="plain">' +
    `<li>📈 <b>Pico de rating:</b> ${peak ? fmt(peak.myRating) + ' (' + new Date(peak.ts).toLocaleDateString('pt-BR') + ')' : '—'}</li>` +
    `<li>🗡 <b>Maior zebra:</b> ${upset ? 'venceu alguém <b class="good">+' + fmt(upset.opRating - upset.myRating) + '</b> acima (' + fmt(upset.opRating) + ')' + lk(upset) : '—'}</li>` +
    `<li>⚡ <b>Vitória mais rápida:</b> ${fastest ? Math.ceil(fastest.moves.length / 2) + ' lances' + lk(fastest) : '—'}</li>` +
    `<li>🐢 <b>Partida mais longa:</b> ${longest ? Math.ceil(longest.moves.length / 2) + ' lances' + lk(longest) : '—'}</li>` +
  '</ul>';
}

/* ---------------- Rivais ---------------- */
function renderRivals(recs) {
  const m = {};
  recs.forEach(g => { if (!g.opName || g.opName === '?') return; (m[g.opName] = m[g.opName] || []).push(g); });
  const rows = Object.entries(m).map(([k, v]) => ({ op: k, ...wdl(v) }))
    .filter(r => r.n >= 3).sort((a, b) => b.n - a.n).slice(0, 8);
  $('rivals').innerHTML = rows.length ?
    '<table><tr><th>Adversário</th><th>Jogos</th><th>V / E / D</th><th>Seu placar</th></tr>' +
    rows.map(r => `<tr><td>${esc(r.op)}</td><td>${r.n}</td><td>${r.w} / ${r.d} / ${r.l}</td>
      <td><span class="pct ${pctc(r.p)}">${r.p}%</span><div class="bar"><i style="width:${r.p}%"></i></div></td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhum adversário recorrente (3+ jogos) na amostra.</p>';
}

/* ---------------- Árvore de aberturas + mestres ---------------- */
let TREE = { color: 'w', path: [] };
const EXPLORER = 'https://explorer.lichess.ovh/masters';
async function fetchMasters(fen, movesN = 8) {
  const r = await fetch(`${EXPLORER}?fen=${encodeURIComponent(fen)}&moves=${movesN}&topGames=0`);
  if (!r.ok) throw new Error('explorer ' + r.status);
  return r.json();
}
function renderTree() {
  $('treeW').className = 'tgl' + (TREE.color === 'w' ? ' on' : '');
  $('treeB').className = 'tgl' + (TREE.color === 'b' ? ' on' : '');
  const recs = FILTERED.filter(g => g.color === TREE.color);
  const pool = recs.filter(g => TREE.path.every((m, i) => norm(g.moves[i] || '') === m));
  let bc = `<span class="crumb" onclick="treeJump(-1)">Início</span>`;
  TREE.path.forEach((m, i) => { bc += ` › <span class="crumb" onclick="treeJump(${i})">${i % 2 === 0 ? (i / 2 + 1) + '.' : ''}${m}</span>`; });
  const st = wdl(pool);
  bc += ` <span style="color:var(--mut)">— ${st.n} jogos, <b class="${pctc(st.p)}">${st.p}%</b> (${st.w}V/${st.d}E/${st.l}D)</span>`;
  $('treeBc').innerHTML = bc;

  // aviso de armadilhas alcançáveis nesta linha
  const reach = TRAPS.filter(t => TREE.path.every((m, i) => t.seq[i] === m) && t.seq.length > TREE.path.length);
  $('treeWarn').innerHTML = reach.length ?
    `⚠️ <span class="warn">Armadilha possível nesta linha:</span> ` +
    reach.slice(0, 3).map(t => `<span class="chip" onclick="loadTrap('${t.name}')">${t.name}</span>`).join(' ') : '';

  // tabuleiro acompanhando a linha
  { const g = new Chess(); let lm = null;
    for (const m of TREE.path) { const mm = g.move(m, { sloppy: true }); if (mm) lm = [mm.from, mm.to]; else break; }
    drawBoard($('tboard'), g, { bottom: TREE.color, lastMove: lm }); }

  const nm = {};
  pool.forEach(g => { const m = g.moves[TREE.path.length]; if (!m) return; const k = norm(m); (nm[k] = nm[k] || []).push(g); });
  const rows = Object.entries(nm).map(([k, v]) => ({ k, ...wdl(v) })).sort((a, b) => b.n - a.n);
  if (!rows.length) {
    $('treeBody').innerHTML = FILTERED.length ?
      '<p style="color:var(--mut)">Fim da linha — sem continuações registradas.</p>' :
      '<p style="color:var(--mut)">Analise um jogador na página Início para montar a árvore do repertório.</p>';
    return;
  }
  const turn = TREE.path.length % 2 === 0 ? 'Brancas jogam' : 'Pretas jogam';
  let h = `<p style="color:var(--mut);font-size:.85rem;margin-bottom:6px">${turn} — clique num lance para descer na árvore.</p>`;
  h += '<table><tr><th>Lance</th><th>Jogos</th><th>V / E / D</th><th>Resultado</th></tr>';
  for (const r of rows.slice(0, 12)) {
    const wPct = r.n ? 100 * r.w / r.n : 0, dPct = r.n ? 100 * r.d / r.n : 0;
    h += `<tr class="mv" onclick="treePush('${r.k}')"><td style="font-family:ui-monospace,monospace;font-weight:700">${r.k}</td>
     <td>${r.n}</td><td>${r.w} / ${r.d} / ${r.l}</td>
     <td><span class="pct ${pctc(r.p)}">${r.p}%</span>
       <div class="stack"><i style="width:${wPct}%;background:#34d399"></i><i style="width:${dPct}%;background:#94a3b8"></i><i style="flex:1;background:#fb7185"></i></div></td></tr>`;
  }
  $('treeBody').innerHTML = h + '</table>';
}
window.treeJump = i => { TREE.path = TREE.path.slice(0, i + 1); $('mastersOut').innerHTML = ''; renderTree(); };
window.treePush = m => { TREE.path.push(m); $('mastersOut').innerHTML = ''; renderTree(); };
$('treeW').onclick = () => { TREE = { color: 'w', path: [] }; $('mastersOut').innerHTML = ''; renderTree(); };
$('treeB').onclick = () => { TREE = { color: 'b', path: [] }; $('mastersOut').innerHTML = ''; renderTree(); };

$('treeMasters').onclick = async () => {
  const out = $('mastersOut');
  out.innerHTML = '<p style="color:var(--mut)">Consultando base de mestres…</p>';
  try {
    const g = new Chess();
    for (const m of TREE.path) { if (!g.move(m, { sloppy: true })) break; }
    const d = await fetchMasters(g.fen(), 10);
    if (!(d.moves || []).length) { out.innerHTML = '<p style="color:var(--mut)">Posição fora da base de mestres.</p>'; return; }
    const my = new Set();
    FILTERED.filter(x => x.color === TREE.color && TREE.path.every((m, i) => norm(x.moves[i] || '') === m))
      .forEach(x => { const nm = x.moves[TREE.path.length]; if (nm) my.add(norm(nm)); });
    let h = `<h2 style="font-size:.95rem;color:#c7d2fe;margin-bottom:8px">👑 O que os mestres jogam aqui${d.opening ? ` — ${esc(d.opening.name)}` : ''}</h2>`;
    h += '<table><tr><th>Lance</th><th>Partidas</th><th>Brancas / Empates / Pretas</th><th>Você joga?</th></tr>';
    for (const m of d.moves.slice(0, 8)) {
      const tot = m.white + m.draws + m.black;
      h += `<tr><td style="font-family:ui-monospace,monospace;font-weight:700">${esc(m.san)}</td><td>${fmt(tot)}</td>
        <td>${Math.round(100 * m.white / tot)}% / ${Math.round(100 * m.draws / tot)}% / ${Math.round(100 * m.black / tot)}%</td>
        <td>${my.has(norm(m.san)) ? '<span class="good">✔ sim</span>' : '<span style="color:var(--mut)">—</span>'}</td></tr>`;
    }
    h += '</table>';
    const sug = d.moves.slice(0, 3).find(m => !my.has(norm(m.san)));
    if (sug) h += `<p style="margin-top:8px;font-size:.9rem">💡 <b>Sugestão de repertório:</b> os mestres jogam <b>${esc(sug.san)}</b> nesta posição e você ainda não usa — experimente no Treinador (página Treino).</p>`;
    else h += `<p style="margin-top:8px;font-size:.9rem" class="good">Seu repertório já cobre os principais lances dos mestres aqui. 👏</p>`;
    out.innerHTML = h;
  } catch (e) {
    out.innerHTML = '<p style="color:var(--mut)">Não foi possível consultar agora (limite de requisições da base). Tente em instantes.</p>';
  }
};

/* ---------------- Análise principal ---------------- */
function analyze(recs, user) {
  if (!recs.length) throw new Error('Nenhuma partida encontrada com esses filtros.');
  recs.sort((a, b) => a.ts - b.ts);
  FILTERED = recs; BIG = recs.length > 800;
  const s = summary(recs); SUM_A = s;
  const all = s.all;

  $('overview').innerHTML = [
    ['Partidas', fmt(all.n)], ['Vitórias', fmt(all.w) + ` <small style="color:var(--mut)">(${Math.round(100 * all.w / all.n)}%)</small>`],
    ['Empates / Derrotas', all.d + ' / ' + all.l], ['Aproveitamento', `<span class="${pctc(all.p)}">${all.p}%</span>`],
    ['Rating atual', s.curRating ? fmt(s.curRating) : '—'], ['Elo estimado' + (s.estEloTc ? ' · ' + esc(s.estEloTc) : ''), fmt(s.estElo)],
    ['Ritmo favorito', s.favTc], ['Rival médio', s.avgOpp ? fmt(s.avgOpp) : '—']
  ].map(([l, v]) => `<div class="stat"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('ovNote').innerHTML = `<b>Como ler os números:</b> aproveitamento = (vitórias + ½ × empates) ÷ partidas. Aqui: (${all.w} + ${all.d}÷2) ÷ ${fmt(all.n)} = <b>${all.p}%</b>. Vitórias secas: ${Math.round(100 * all.w / all.n)}% (${fmt(all.w)} de ${fmt(all.n)}). Derrotas: ${Math.round(100 * all.l / all.n)}% (${fmt(all.l)} de ${fmt(all.n)}).`;

  chart('chWDL', { type:'doughnut', data:{ labels:['Vitórias','Empates','Derrotas'],
    datasets:[{ data:[all.w, all.d, all.l], backgroundColor:['#34d399','#94a3b8','#fb7185'], borderWidth:0 }] },
    options:{ plugins:{ legend:{ labels:{ color: Chart.defaults.color } } }, cutout:'62%' } });

  const rated = downsample(recs.filter(g => g.myRating > 0), 300);
  chart('chRating', { type:'line', data:{ labels: rated.map(g => new Date(g.ts).toLocaleDateString('pt-BR')),
    datasets:[{ data: rated.map(g => g.myRating), borderColor:'#8b5cf6',
      backgroundColor:'rgba(139,92,246,.12)', fill:true, pointRadius:0, tension:.3, borderWidth:2 }] },
    options:{ plugins:{ legend:{ display:false } }, scales:{ x:{ ticks:{ maxTicksLimit:8 } } } } });

  $('colorPerf').innerHTML = `<table><tr><th>Cor</th><th>Jogos</th><th>V/E/D</th><th>%</th></tr>
   <tr><td>♔ Brancas</td><td>${s.wW.n}</td><td>${s.wW.w}/${s.wW.d}/${s.wW.l}</td><td class="pct ${pctc(s.wW.p)}">${s.wW.p}%</td></tr>
   <tr><td>♚ Pretas</td><td>${s.wB.n}</td><td>${s.wB.w}/${s.wB.d}/${s.wB.l}</td><td class="pct ${pctc(s.wB.p)}">${s.wB.p}%</td></tr></table>`;
  let tch = '<table><tr><th>Ritmo</th><th>Jogos</th><th>%</th></tr>';
  s.tcRows.forEach(r => tch += `<tr><td>${esc(r.k)}</td><td>${r.n}</td><td><span class="pct ${pctc(r.p)}">${r.p}%</span> <small style="color:var(--mut)">(${r.w}V/${r.d}E/${r.l}D)</small></td></tr>`);
  $('tcPerf').innerHTML = tch + '</table>';

  renderTime(recs);
  renderLenRecords(recs);
  renderRivals(recs);

  $('opWhite').innerHTML = tbl(s.opW.slice(0, 10));
  $('opBlack').innerHTML = tbl(s.opB.slice(0, 10));
  $('bestOp').innerHTML = tbl(s.best);
  $('worstOp').innerHTML = tbl(s.worst);

  TREE = { color: 'w', path: [] };
  renderTree();

  const pm = {};
  s.losses.forEach(g => {
    const k = g.moves.slice(0, 8).map(norm).join(' ');
    if (g.moves.length >= 6) { (pm[k] = pm[k] || { n: 0, g }).n++; pm[k].g = g; }
  });
  const topLose = Object.entries(pm).sort((a, b) => b[1].n - a[1].n).slice(0, 6).filter(([, v]) => v.n >= 2);
  $('loseLines').innerHTML = topLose.length ?
    '<table><tr><th>Sequência inicial</th><th>Derrotas</th><th>Abertura</th><th></th></tr>' +
    topLose.map(([k, v]) => `<tr><td style="font-family:ui-monospace,monospace">${k}</td><td class="bad">${v.n}</td>
      <td>${esc(famName(v.g.opening))}</td><td><span class="chip" onclick="loadLine('${k}')">♟ ver no tabuleiro</span> ${v.g.url ? `<a href="${v.g.url}" target="_blank">exemplo ↗</a>` : ''}</td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhum padrão repetido de derrota nas primeiras jogadas — as derrotas estão espalhadas por linhas diferentes.</p>';

  const trapHtml = (arr, emptyMsg, cls) => {
    const gr = grpTrap(arr);
    return gr.length ? '<ul class="plain">' + gr.map(([n, v]) =>
      `<li><b class="${cls}">${n}</b> — ${v.n}x <span class="chip" onclick="loadTrap('${n}')">♟ ver no tabuleiro</span> ${v.g.url ? `· <a href="${v.g.url}" target="_blank">partida ↗</a>` : ''}</li>`).join('') + '</ul>'
      : `<p style="color:var(--mut)">${emptyMsg}</p>`;
  };
  $('trapFall').innerHTML = trapHtml(s.fell, 'Nenhuma armadilha conhecida detectada nas derrotas. 👏', 'bad');
  $('trapUse').innerHTML = trapHtml(s.used, 'Nenhuma armadilha do banco aplicada com sucesso.', 'good');

  const tm = {}; s.losses.forEach(g => { const k = termMap[g.term] || g.term; tm[k] = (tm[k] || 0) + 1; });
  chart('chLoss', { type:'bar', data:{ labels: Object.keys(tm),
    datasets:[{ data: Object.values(tm), backgroundColor:'#fb7185', borderRadius:5 }] },
    options:{ plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ precision:0 } } } } });

  $('miniatures').innerHTML = s.minis.length ?
    '<table><tr><th>Lances</th><th>Abertura</th><th>Fim</th><th></th></tr>' +
    s.minis.slice(0, 8).map(g => `<tr><td>${Math.ceil(g.moves.length / 2)}</td><td>${esc(famName(g.opening))}</td>
     <td>${termMap[g.term] || g.term}</td><td>${g.url ? `<a href="${g.url}" target="_blank">ver ↗</a>` : ''}</td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhuma derrota em 12 lances ou menos. Sólido! 💪</p>';

  const S = [], W = [];
  if (s.best.length && s.best[0].p >= 60) S.push(`Excelente com <b>${esc(s.best[0].op)}</b>: ${s.best[0].p}% em ${s.best[0].n} jogos — mantenha no repertório.`);
  if (s.wW.p - s.wB.p >= 10) S.push(`Muito mais forte de <b>Brancas</b> (${s.wW.p}% vs ${s.wB.p}%).`);
  else if (s.wB.p - s.wW.p >= 10) S.push(`Muito mais forte de <b>Pretas</b> (${s.wB.p}% vs ${s.wW.p}%).`);
  const bestTc = s.tcRows.filter(r => r.n >= 10).sort((a, b) => b.p - a.p)[0];
  if (bestTc && bestTc.p >= 55) S.push(`Melhor ritmo: <b>${esc(bestTc.k)}</b> (${bestTc.p}%).`);
  if (s.timeLossPct <= 10 && s.losses.length >= 10) S.push(`Ótimo controle do relógio: só ${s.timeLossPct}% das derrotas foram por tempo.`);
  if (s.used.length) S.push(`Sabe aplicar armadilhas (${s.used.length} vitórias com padrões táticos conhecidos).`);
  if (!S.length) S.push('Desempenho equilibrado, sem destaque estatístico claro — analise mais partidas para refinar.');

  if (s.worst.length && s.worst[0].p <= 40) W.push(`<b>${esc(s.worst[0].op)}</b> é o ponto crítico: apenas ${s.worst[0].p}% em ${s.worst[0].n} jogos. Estude a linha ou troque de abertura.`);
  if (s.timeLossPct >= 25) W.push(`<b>${s.timeLossPct}% das derrotas são por tempo</b> — administre melhor o relógio ou jogue ritmos mais longos.`);
  if (s.fell.length) W.push(`Caiu em armadilhas conhecidas ${s.fell.length}x (${grpTrap(s.fell)[0][0]} é a mais frequente).`);
  if (s.minis.length >= 3) W.push(`${s.minis.length} derrotas em ≤ 12 lances — revise os princípios de abertura (desenvolvimento, segurança do rei, f7/f2).`);
  const worstTc = s.tcRows.filter(r => r.n >= 10).sort((a, b) => a.p - b.p)[0];
  if (worstTc && worstTc.p <= 45) W.push(`Pior ritmo: <b>${esc(worstTc.k)}</b> (${worstTc.p}%).`);
  if (!W.length) W.push('Nenhuma fraqueza estatística evidente na amostra analisada. 👏');
  $('strengths').innerHTML = S.map(x => `<li>${x}</li>`).join('');
  $('weaknesses').innerHTML = W.map(x => `<li>${x}</li>`).join('');

  // integrações com as demais páginas (features.js)
  populateGameSelects();
  calibrateBot(s.estElo, user, s.estEloTc);
  genPlan();
  $('results').classList.remove('hide');
}

/* ---------------- Filtros, relatório e link ---------------- */
function populateFilters(recs) {
  const tcs = [...new Set(recs.map(g => g.tc))];
  $('fTc').innerHTML = '<option value="all">Todos</option>' + tcs.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  $('fColor').value = 'all'; $('fFrom').value = ''; $('fTo').value = '';
}
function applyFilters(recs) {
  const tc = $('fTc').value, col = $('fColor').value, from = $('fFrom').value, to = $('fTo').value;
  return recs.filter(g => (tc === 'all' || g.tc === tc) && (col === 'all' || g.color === col)
    && (!from || g.ts >= Date.parse(from)) && (!to || g.ts <= Date.parse(to) + 86399999));
}
$('fApply').onclick = () => {
  try {
    analyze(applyFilters(RAW.recs), RAW.user);
    $('status').textContent = `✔ Filtros aplicados: ${fmt(FILTERED.length)} de ${fmt(RAW.recs.length)} partidas.`;
  } catch (e) { $('status').textContent = '⚠ ' + e.message; }
};
$('doPrint').onclick = () => window.print();
$('shareBtn').onclick = async () => {
  const u = `${location.origin}${location.pathname}?plat=${RAW.plat}&user=${encodeURIComponent(RAW.user)}&n=${$('maxg').value}`;
  try { await navigator.clipboard.writeText(u); $('status').textContent = '✔ Link copiado! Envie para qualquer pessoa.'; }
  catch (e) { $('status').textContent = u; }
};

/* ---------------- Comparação de jogadores ---------------- */
function cmpRow(label, a, b, higherBetter) {
  let ca = '', cb = '';
  if (typeof a === 'number' && typeof b === 'number' && higherBetter !== null) {
    if (a !== b) { const aw = higherBetter ? a > b : a < b; ca = aw ? 'good' : 'bad'; cb = aw ? 'bad' : 'good'; }
  }
  return `<tr><td style="color:var(--mut)">${label}</td><td class="${ca}">${a}</td><td class="${cb}">${b}</td></tr>`;
}
$('cmpGo').onclick = async () => {
  const u = $('cmpUser').value.trim(), plat = $('cmpPlat').value;
  const st = m => $('cmpStatus').textContent = m;
  if (!u) { st('Informe o username do rival.'); return; }
  if (!SUM_A) { st('Analise um jogador primeiro.'); return; }
  try {
    $('cmpGo').disabled = true;
    const maxg = Math.min(+$('maxg').value, 500);
    const recsB = plat === 'chesscom' ? await fetchChessCom(u, maxg, st) : await fetchLichess(u, maxg, st);
    setProg(null);
    if (!recsB.length) throw new Error('Nenhuma partida encontrada para o rival.');
    recsB.sort((a, b) => a.ts - b.ts);
    const A = SUM_A, B = summary(recsB);
    const nm = (o, alt) => o && o.length ? `${o[0].op} (${o[0].p}%)` : alt;
    $('cmpBody').innerHTML = `<table>
      <tr><th></th><th>${esc(RAW.user)}</th><th>${esc(u)}</th></tr>
      ${cmpRow('Partidas analisadas', A.all.n, B.all.n, null)}
      ${cmpRow('Aproveitamento (%)', A.all.p, B.all.p, true)}
      ${cmpRow('Rating atual', A.curRating, B.curRating, true)}
      ${cmpRow('Elo médio recente', A.estElo, B.estElo, true)}
      ${cmpRow('% com Brancas', A.wW.p, B.wW.p, true)}
      ${cmpRow('% com Pretas', A.wB.p, B.wB.p, true)}
      ${cmpRow('Ritmo favorito', esc(A.favTc), esc(B.favTc), null)}
      ${cmpRow('Melhor abertura', esc(nm(A.best, '—')), esc(nm(B.best, '—')), null)}
      ${cmpRow('Pior abertura', esc(nm(A.worst, '—')), esc(nm(B.worst, '—')), null)}
      ${cmpRow('% derrotas por tempo', A.timeLossPct, B.timeLossPct, false)}
      ${cmpRow('Derrotas rápidas (≤12 lances)', A.minis.length, B.minis.length, false)}
      ${cmpRow('Caiu em armadilhas', A.fell.length, B.fell.length, false)}
      ${cmpRow('Aplicou armadilhas', A.used.length, B.used.length, true)}
    </table>
    <p style="color:var(--mut);font-size:.85rem;margin-top:8px">Dica: os pontos fracos do rival (pior abertura, armadilhas em que cai) são o seu plano de jogo.</p>`;
    st(`✔ Comparação com ${u} concluída (${fmt(B.all.n)} partidas).`);
  } catch (e) { st('⚠ ' + e.message); }
  finally { $('cmpGo').disabled = false; setProg(null); }
};

/* ---------------- Fluxo principal ---------------- */
$('plat').onchange = () => { $('pgnbox').classList.toggle('hide', $('plat').value !== 'pgn'); };
$('go').onclick = async () => {
  const plat = $('plat').value, user = $('user').value.trim(), maxg = +$('maxg').value, st = m => $('status').textContent = m;
  try {
    if (!user) throw new Error('Informe o username (ou o nome usado no PGN).');
    st('Buscando partidas…'); $('go').disabled = true;
    let recs;
    if (plat === 'chesscom') recs = await fetchChessCom(user, maxg, st);
    else if (plat === 'lichess') recs = await fetchLichess(user, maxg, st);
    else {
      const f = $('pgnfile').files[0];
      if (!f) throw new Error('Selecione um arquivo .pgn.');
      recs = parsePgnFile(await f.text(), user);
    }
    if (!recs.length) throw new Error('Nenhuma partida padrão encontrada para esse jogador.');
    RAW = { recs, user, plat };
    savePref('lastUser', user); savePref('lastPlat', plat);
    const rec = (PREF.recent || []).filter(x => !(x.u === user && x.p === plat));
    rec.unshift({ u: user, p: plat }); savePref('recent', rec.slice(0, 6)); renderRecent();
    HIST.an.unshift({ u: user, p: plat, n: recs.length, d: Date.now() });
    HIST.an = HIST.an.slice(0, 30); saveHist(); renderHistAll();
    populateFilters(recs);
    st(`Analisando ${fmt(recs.length)} partidas…`);
    setProg(1);
    analyze(recs, user);
    st(`✔ ${fmt(recs.length)} partidas analisadas.`);
  } catch (e) { st('⚠ ' + e.message); }
  finally { $('go').disabled = false; setProg(null); }
};
