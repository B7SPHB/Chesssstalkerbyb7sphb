'use strict';
/* =====================================================================
 * ChessLens · features.js
 * Tabuleiros, motor Stockfish (fila de trabalhos), bot, tabuleiro de
 * análise, precisão por lance, treinador de aberturas, leitores PGN/PDF,
 * históricos, plano de treino, roteador de páginas e inicialização.
 * Carregado após core.js.
 * ===================================================================== */

/* ---------------- Temas e peças do tabuleiro ---------------- */
const THEMES = {
  esmeralda: ['#eeeed2', '#769656'], madeira: ['#f0d9b5', '#b58863'],
  oceano: ['#e3eaf0', '#7c98b3'], roxo: ['#e9e2f7', '#8b6fc9'], noturno: ['#8f96a8', '#3e4557']
};
const PIECE_CDN = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/';
const SVG_SETS = ['cburnett', 'merida', 'alpha', 'maestro', 'staunty', 'tatiana'];
const pieceUrl = (setName, pc) => PIECE_CDN + setName + '/' + pc.color + pc.type.toUpperCase() + '.svg';
const GLYPH = { p:'♟', n:'♞', b:'♝', r:'♜', q:'♛', k:'♚' };
const LETTER = { p:'P', n:'N', b:'B', r:'R', q:'Q', k:'K' };
let svgFail = false;

/* ---------------- Renderizador genérico de tabuleiro ---------------- */
function drawBoard(el, gm, o) {
  if (!el) return;
  el.innerHTML = '';
  const th = THEMES[$('boardTheme').value] || THEMES.esmeralda;
  let set = $('pieceSet').value;
  if (set === 'svg') set = 'cburnett';
  if (svgFail && SVG_SETS.includes(set)) set = 'uni';
  const files = ['a','b','c','d','e','f','g','h'];
  const ranks = o.bottom === 'w' ? [8,7,6,5,4,3,2,1] : [1,2,3,4,5,6,7,8];
  const fs = o.bottom === 'w' ? files : [...files].reverse();
  const frag = document.createDocumentFragment();
  for (const r of ranks) for (const f of fs) {
    const sqName = f + r;
    const d = document.createElement('div');
    const isLight = (files.indexOf(f) + r) % 2 !== 0;
    d.className = 'sq';
    d.style.background = isLight ? th[0] : th[1];
    if (o.sel === sqName) d.classList.add('sel');
    if (o.legal && o.legal.includes(sqName)) d.classList.add('dot');
    if (o.lastMove && (o.lastMove[0] === sqName || o.lastMove[1] === sqName)) d.classList.add('last');
    if (o.hint && (o.hint[0] === sqName || o.hint[1] === sqName)) d.classList.add('hint');
    const pc = gm.get(sqName);
    if (pc) {
      if (SVG_SETS.includes(set)) {
        const img = document.createElement('img');
        img.src = pieceUrl(set, pc);
        img.alt = pc.type;
        img.onerror = () => { if (!svgFail) { svgFail = true; drawBoard(el, gm, o); } };
        d.appendChild(img);
      } else if (set === 'txt') {
        d.textContent = LETTER[pc.type]; d.classList.add('txtset', pc.color === 'w' ? 'wp' : 'bp');
      } else {
        d.textContent = GLYPH[pc.type]; d.classList.add(pc.color === 'w' ? 'wp' : 'bp');
      }
    }
    if (o.click) d.onclick = () => o.click(sqName);
    frag.appendChild(d);
  }
  el.appendChild(frag);
}

/* ---------------- Motor Stockfish (fila de trabalhos) ---------------- */
const Engine = (() => {
  let worker = null, ready = false, job = null, failed = false;
  let queue = Promise.resolve();
  async function init() {
    if (ready) return true;
    if (failed) return false;
    if (!worker) {
      try {
        const code = await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js')).text();
        worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
        worker.onmessage = e => {
          const d = typeof e.data === 'string' ? e.data : '';
          if (d === 'uciok') ready = true;
          if (job && d.startsWith('info ')) {
            const m = d.match(/score (cp|mate) (-?\d+)/);
            if (m) job.score = { type: m[1], v: +m[2] };
          }
          if (job && d.startsWith('bestmove')) {
            const j = job; job = null;
            j.res({ best: d.split(' ')[1], score: j.score });
          }
        };
        worker.postMessage('uci');
      } catch (err) { failed = true; return false; }
    }
    for (let i = 0; i < 50 && !ready; i++) await sleep(100);
    if (!ready) failed = true;
    return ready;
  }
  function run(fen, go, skill = 20) {
    const p = queue.then(() => new Promise(res => {
      if (!worker || !ready) { res(null); return; }
      job = { res, score: null };
      worker.postMessage('setoption name Skill Level value ' + skill);
      worker.postMessage('position fen ' + fen);
      worker.postMessage(go);
    }));
    queue = p.catch(() => {});
    return p;
  }
  return { init, run, get ok() { return ready; } };
})();

/* ---------------- Bot com força calibrada ---------------- */
let game = null, sel = null, playerColor = 'w', thinking = false, lastMove = null, hint = null, botToken = 0;
function skillFromElo(elo) { return Math.max(0, Math.min(20, Math.round((elo - 500) / 115))); }

function renderBoard() {
  if (!game) return;
  const legal = sel ? game.moves({ square: sel, verbose: true }).map(m => m.to) : null;
  drawBoard($('board'), game, { bottom: playerColor, sel, legal, lastMove, hint, click: clickSq });
  const hist = game.history();
  $('moves').textContent = hist.map((m, i) => i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m).join('  ');
}
async function engineMove() {
  if (!game || game.game_over()) return;
  const tok = botToken; thinking = true; updateBotStatus();
  const elo = +$('botElo').value, sk = skillFromElo(elo);
  await Engine.init();
  let done = false;
  if (Engine.ok) {
    const r = await Engine.run(game.fen(), 'go movetime ' + (150 + sk * 60), sk);
    if (tok === botToken && game && r && r.best && r.best !== '(none)') {
      const m = game.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] || 'q' });
      if (m) { lastMove = [m.from, m.to]; done = true; }
    }
  }
  if (!done && tok === botToken && game && !game.game_over() && game.turn() !== playerColor) {
    const ms = game.moves({ verbose: true });
    let pick;
    if (elo < 900) pick = ms[Math.floor(Math.random() * ms.length)];
    else {
      const val = { p:1, n:3, b:3, r:5, q:9 };
      ms.sort((a, b) => ((val[b.captured] || 0) + (b.san.includes('+') ? .5 : 0)) - ((val[a.captured] || 0) + (a.san.includes('+') ? .5 : 0)));
      const k = Math.max(1, Math.round(ms.length * (1 - Math.min(1, (elo - 900) / 1900))));
      pick = ms[Math.floor(Math.random() * k)];
    }
    if (pick) { const m = game.move(pick.san); if (m) lastMove = [m.from, m.to]; }
  }
  if (tok !== botToken) return;
  thinking = false; renderBoard(); updateBotStatus();
}
function clickSq(sq) {
  if (thinking || !game || game.game_over()) return;
  if (game.turn() !== playerColor) return;
  hint = null;
  const pc = game.get(sq);
  if (sel) {
    const mv = game.moves({ square: sel, verbose: true }).find(m => m.to === sq);
    if (mv) {
      game.move({ from: sel, to: sq, promotion: 'q' }); lastMove = [sel, sq]; sel = null;
      renderBoard(); updateBotStatus();
      if (!game.game_over()) setTimeout(engineMove, 250);
      return;
    }
  }
  sel = (pc && pc.color === playerColor) ? sq : null;
  renderBoard();
}
function updateBotStatus() {
  const s = $('botstatus');
  if (!game) return;
  if (game.in_checkmate()) s.innerHTML = game.turn() === playerColor ? '<span class="bad">Xeque-mate — o bot venceu.</span>' : '<span class="good">Xeque-mate — você venceu! 🏆</span>';
  else if (game.in_draw() || game.in_stalemate()) s.textContent = 'Empate.';
  else if (thinking) s.textContent = 'Bot pensando…';
  else s.textContent = (game.turn() === playerColor ? 'Sua vez' : 'Vez do bot') + (game.in_check() ? ' — xeque!' : '');
}
function newBotGame() {
  botToken++;
  game = new Chess(); sel = null; thinking = false; lastMove = null; hint = null;
  playerColor = $('botColor').value;
  renderBoard(); updateBotStatus();
  Engine.init();
  if (playerColor === 'b') setTimeout(engineMove, 400);
}
function calibrateBot(elo, user) {
  $('botElo').value = Math.min(2800, Math.max(400, elo));
  $('botEloV').textContent = $('botElo').value;
  $('botinfo').innerHTML = `Bot calibrado para <b>~${fmt(elo)} Elo</b> (média recente de <b>${esc(user)}</b>). Ajuste no controle se quiser.`;
  newBotGame();
}
$('botStart').onclick = newBotGame;
$('botElo').oninput = () => $('botEloV').textContent = $('botElo').value;
$('botUndo').onclick = () => {
  if (!game || thinking) return;
  game.undo(); if (game.turn() !== playerColor) game.undo();
  sel = null; lastMove = null; hint = null; renderBoard(); updateBotStatus();
};
$('botHint').onclick = async () => {
  if (!game || thinking || game.game_over() || game.turn() !== playerColor) return;
  await Engine.init();
  if (Engine.ok) {
    const r = await Engine.run(game.fen(), 'go movetime 400', 20);
    if (r && r.best && r.best !== '(none)') { hint = [r.best.slice(0, 2), r.best.slice(2, 4)]; renderBoard(); }
  } else {
    const ms = game.moves({ verbose: true });
    const val = { p:1, n:3, b:3, r:5, q:9 };
    ms.sort((a, b) => ((val[b.captured] || 0)) - ((val[a.captured] || 0)));
    if (ms[0]) { hint = [ms[0].from, ms[0].to]; renderBoard(); }
  }
};

/* ---------------- Tabuleiro de análise ---------------- */
let ANL = { game: new Chess(), moves: [], idx: 0, flip: false, last: null };
function anlSet(moves, label) {
  const t = new Chess(), ok = [];
  for (const s of moves) { const m = t.move(s, { sloppy: true }); if (!m) break; ok.push(m.san); }
  ANL.moves = ok; ANL.idx = 0; ANL.last = null; ANL.game = new Chess();
  $('evalTxt').textContent = '';
  renderAnl();
  $('anlStatus').textContent = `${label} — ${ok.length} meios-lances. Navegue com ◀ ▶ ou as setas do teclado.`;
}
function anlGoto(i) {
  i = Math.max(0, Math.min(ANL.moves.length, i));
  const g = new Chess(); let last = null;
  for (let k = 0; k < i; k++) { const m = g.move(ANL.moves[k], { sloppy: true }); if (m) last = [m.from, m.to]; }
  ANL.game = g; ANL.idx = i; ANL.last = last;
  $('evalTxt').textContent = '';
  renderAnl();
}
function renderAnl() {
  drawBoard($('aboard'), ANL.game, { bottom: ANL.flip ? 'b' : 'w', lastMove: ANL.last });
  if (ANL.moves.length) {
    const done = ANL.moves.slice(0, ANL.idx);
    $('anlStatus').textContent = (done.length ? done.map((m, i) => i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m).join('  ') : 'Posição inicial') + `   (${ANL.idx}/${ANL.moves.length})`;
  }
}
$('anlLoad').onclick = () => {
  const g = FILTERED[+$('anlGame').value];
  if (!g) { $('anlStatus').textContent = 'Analise um jogador primeiro (página Início).'; return; }
  ANL.flip = g.color === 'b';
  anlSet(g.moves, `Partida vs ${g.opName || '?'}`);
};
$('anlLoadFen').onclick = () => {
  const v = $('anlFen').value.trim();
  if (!v) return;
  if (/^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\s/.test(v)) {
    const g = new Chess();
    if (g.load(v)) {
      ANL.game = g; ANL.moves = []; ANL.idx = 0; ANL.last = null;
      $('anlStatus').textContent = 'FEN carregado.'; $('evalTxt').textContent = ''; renderAnl();
    } else $('anlStatus').textContent = 'FEN inválido.';
  } else { ANL.flip = false; anlSet(movesFromPgn(v), 'Lances colados'); }
};
$('anlStart').onclick = () => anlGoto(0);
$('anlPrev').onclick = () => anlGoto(ANL.idx - 1);
$('anlNext').onclick = () => anlGoto(ANL.idx + 1);
$('anlEnd').onclick = () => anlGoto(ANL.moves.length);
$('anlFlip').onclick = () => { ANL.flip = !ANL.flip; renderAnl(); };
function showEval(r) {
  let txt = '', num = NaN;
  if (r && r.score) {
    const sign = ANL.game.turn() === 'b' ? -1 : 1;
    if (r.score.type === 'mate') {
      const mv = r.score.v * sign;
      txt = 'M' + Math.abs(r.score.v) + (mv > 0 ? ' (Brancas)' : ' (Pretas)'); num = mv > 0 ? 99 : -99;
    } else { num = r.score.v * sign / 100; txt = (num >= 0 ? '+' : '') + num.toFixed(2); }
  }
  let san = '';
  if (r && r.best && r.best !== '(none)') {
    const t = new Chess(ANL.game.fen());
    const m = t.move({ from: r.best.slice(0, 2), to: r.best.slice(2, 4), promotion: r.best[4] || 'q' });
    if (m) san = '  ·  melhor lance: ' + m.san;
  }
  $('evalTxt').textContent = (txt || '—') + san;
  $('evalTxt').style.color = isNaN(num) ? 'var(--mut)' : (num > 0.3 ? 'var(--good)' : (num < -0.3 ? 'var(--bad)' : 'var(--txt)'));
}
$('anlEval').onclick = async () => {
  $('evalTxt').textContent = 'avaliando…'; $('evalTxt').style.color = 'var(--mut)';
  const ok = await Engine.init();
  if (!ok) { $('evalTxt').textContent = 'motor indisponível neste navegador'; return; }
  const r = await Engine.run(ANL.game.fen(), 'go depth 14', 20);
  showEval(r);
};

/* ---------------- Precisão por lance (Stockfish) ---------------- */
const PREC = { plies: [], abort: false, running: false };
const winPct = cp => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1500, Math.min(1500, cp)))) - 1);
function phaseOf(ply, fen) {
  if (ply < 20) return 'Abertura';
  const pieces = fen.split(' ')[0].replace(/[^nbrqNBRQ]/g, '').length;
  return pieces <= 6 ? 'Final' : 'Meio-jogo';
}
$('precCancel').onclick = () => { PREC.abort = true; };
$('precGo').onclick = async () => {
  const g = FILTERED[+$('precGame').value];
  if (!g) { $('precProg').textContent = '⚠ Analise um jogador na página Início e escolha uma partida.'; return; }
  if (PREC.running) return;
  $('precGo').disabled = true; $('precCancel').classList.remove('hide');
  $('precProg').textContent = 'Iniciando o Stockfish…';
  const ok = await Engine.init();
  if (!ok) {
    $('precProg').textContent = '⚠ Não foi possível iniciar o Stockfish neste navegador.';
    $('precGo').disabled = false; $('precCancel').classList.add('hide'); return;
  }
  PREC.abort = false; PREC.running = true;
  const mt = +$('precDepth').value;
  const t = new Chess(), plies = [];
  for (const s of g.moves) { const m = t.move(s, { sloppy: true }); if (!m) break; plies.push({ san: m.san, color: m.color }); }
  const t2 = new Chess(), fens = [t2.fen()];
  for (const p of plies) { t2.move(p.san, { sloppy: true }); fens.push(t2.fen()); }

  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    if (PREC.abort) break;
    $('precProg').textContent = `Avaliando posição ${i + 1} de ${fens.length}… (~${Math.round((fens.length - i) * mt / 1000)}s restantes)`;
    setProg((i + 1) / fens.length);
    const r = await Engine.run(fens[i], 'go movetime ' + mt, 20);
    let cp = 0;
    if (r && r.score) cp = r.score.type === 'mate' ? (r.score.v > 0 ? 10000 : -10000) : r.score.v;
    evals.push(fens[i].split(' ')[1] === 'w' ? cp : -cp);
  }
  setProg(null); PREC.running = false;
  $('precGo').disabled = false; $('precCancel').classList.add('hide');
  if (PREC.abort || evals.length < 2) { $('precProg').textContent = 'Análise cancelada.'; return; }
  $('precProg').textContent = '✔ Análise concluída.';

  const rows = []; const acc = { w: [], b: [] };
  const phases = { 'Abertura': 0, 'Meio-jogo': 0, 'Final': 0 };
  for (let i = 0; i < plies.length && i + 1 < evals.length; i++) {
    const c = plies[i].color;
    const before = c === 'w' ? winPct(evals[i]) : 100 - winPct(evals[i]);
    const after = c === 'w' ? winPct(evals[i + 1]) : 100 - winPct(evals[i + 1]);
    const loss = Math.max(0, before - after);
    acc[c].push(Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669)));
    let tag = '';
    if (loss >= 30) tag = '??'; else if (loss >= 20) tag = '?'; else if (loss >= 10) tag = '?!';
    if (tag) {
      const phase = phaseOf(i, fens[i]);
      if (c === g.color) phases[phase]++;
      rows.push({ i, san: plies[i].san, c, loss, tag, phase, ev0: evals[i], ev1: evals[i + 1] });
    }
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const accW = avg(acc.w), accB = avg(acc.b);
  PREC.plies = plies.map(p => p.san);
  renderPrecOut(g, accW, accB, rows, phases);
  HIST.prec.unshift({ d: Date.now(), opp: g.opName || '?', op: famName(g.opening),
    acc: Math.round(g.color === 'w' ? accW : accB), ph: phases, err: rows.filter(r => r.c === g.color).length });
  HIST.prec = HIST.prec.slice(0, 40); saveHist(); renderHistAll(); renderPrecPhase();
};
function renderPrecOut(g, accW, accB, rows, phases) {
  const myC = g.color, tagCls = { '??': 'tagBl', '?': 'tagMi', '?!': 'tagIn' };
  const myRows = rows.filter(r => r.c === myC);
  const evs = v => ((v >= 0 ? '+' : '') + (v / 100).toFixed(2));
  let h = `<div class="grid c4">
    <div class="stat"><div class="v">${Math.round(myC === 'w' ? accW : accB)}%</div><div class="l">Precisão do jogador (${myC === 'w' ? 'Brancas' : 'Pretas'})</div></div>
    <div class="stat"><div class="v">${Math.round(myC === 'w' ? accB : accW)}%</div><div class="l">Precisão do adversário</div></div>
    <div class="stat"><div class="v"><span class="tagBl">${myRows.filter(r => r.tag === '??').length}</span> · <span class="tagMi">${myRows.filter(r => r.tag === '?').length}</span> · <span class="tagIn">${myRows.filter(r => r.tag === '?!').length}</span></div><div class="l">?? · ? · ?! do jogador</div></div>
    <div class="stat"><div class="v">${Math.ceil(g.moves.length / 2)}</div><div class="l">Lances na partida</div></div>
  </div>`;
  if (!myRows.length) h += '<p style="margin-top:12px" class="good">Nenhum erro significativo do jogador — partida limpa. 👏</p>';
  else {
    h += '<p style="margin-top:12px;color:var(--mut);font-size:.85rem">Δ vitória = pontos percentuais de chance de vitória perdidos no lance. Clique em “ver posição” para estudar o momento exato.</p>';
    h += '<table><tr><th>Lance</th><th>Jogada</th><th>Gravidade</th><th>Δ vitória</th><th>Aval. antes → depois</th><th>Fase</th><th></th></tr>';
    for (const r of myRows) {
      const n = Math.floor(r.i / 2) + 1 + (r.c === 'b' ? '…' : '.');
      h += `<tr><td>${n}</td><td style="font-family:ui-monospace,monospace;font-weight:700">${r.san}</td>
        <td class="${tagCls[r.tag]}">${r.tag}</td><td class="bad">−${Math.round(r.loss)}%</td>
        <td style="font-family:ui-monospace,monospace">${evs(r.ev0)} → ${evs(r.ev1)}</td><td>${r.phase}</td>
        <td><span class="chip" onclick="precView(${r.i})">♟ ver posição</span></td></tr>`;
    }
    h += '</table>';
  }
  h += `<p style="margin-top:10px;color:var(--mut);font-size:.85rem">Erros do adversário: ${rows.length - myRows.length}. Modelo de precisão no estilo Lichess (perda de expectativa de vitória).</p>`;
  $('precOut').innerHTML = h;
}
window.precView = i => {
  ANL.flip = false;
  anlSet(PREC.plies, 'Partida analisada (precisão)');
  anlGoto(i + 1);
  showPage('pg-board');
};
function renderPrecPhase() {
  if (!HIST.prec.length) return;
  const tot = { 'Abertura': 0, 'Meio-jogo': 0, 'Final': 0 };
  HIST.prec.forEach(p => { if (p.ph) Object.keys(tot).forEach(k => tot[k] += p.ph[k] || 0); });
  const sum = tot['Abertura'] + tot['Meio-jogo'] + tot['Final'];
  if (!sum) { $('precPhase').innerHTML = '<p style="color:var(--mut)">Sem erros graves registrados — analise mais partidas com o motor.</p>'; return; }
  const worst = Object.entries(tot).sort((a, b) => b[1] - a[1])[0][0];
  const tip = {
    'Abertura': 'revise o repertório na página Aberturas e treine contra a teoria no Treinador.',
    'Meio-jogo': 'treine tática diariamente (garfos, cravadas, ataques duplos) e calcule 2 lances candidatos antes de mover.',
    'Final': 'estude os finais essenciais: torre e peão (Lucena/Philidor), oposição de reis e regra do quadrado.'
  };
  $('precPhase').innerHTML = `<div class="grid c4">${Object.entries(tot).map(([k, v]) =>
    `<div class="stat"><div class="v ${k === worst ? 'bad' : ''}">${v}</div><div class="l">erros graves — ${k} (${Math.round(100 * v / sum)}%)</div></div>`).join('')}
    <div class="stat"><div class="v">${HIST.prec.length}</div><div class="l">partidas analisadas no motor</div></div></div>
    <p style="margin-top:10px;font-size:.9rem"><b class="bad">${worst}</b> é a fase em que o jogo mais escapa: ${tip[worst]}</p>`;
}

/* ---------------- Treinador de aberturas (base de mestres) ---------------- */
const TR = { game: null, color: 'w', sel: null, score: 0, total: 0, active: false, busy: false, cache: {} };
async function trBook(fen) {
  if (TR.cache[fen]) return TR.cache[fen];
  try { const d = await fetchMasters(fen, 6); TR.cache[fen] = d; return d; }
  catch (e) { return { moves: [] }; }
}
function renderTr() {
  const g = TR.game || new Chess();
  const legal = TR.sel ? g.moves({ square: TR.sel, verbose: true }).map(m => m.to) : null;
  drawBoard($('trBoard'), g, { bottom: TR.color, sel: TR.sel, legal, click: trClick });
  $('trScore').innerHTML = TR.total ? `Teoria: <b class="${TR.score / TR.total >= 0.7 ? 'good' : 'warn'}">${TR.score}/${TR.total}</b>` : '';
}
async function trOpp() {
  const d = await trBook(TR.game.fen());
  const ms = (d.moves || []).slice(0, 4);
  if (!ms.length) { trEnd('Fim do livro — o rival não tem mais teoria.'); return; }
  const tot = ms.reduce((a, m) => a + m.white + m.draws + m.black, 0);
  let r = Math.random() * tot, pick = ms[0];
  for (const m of ms) { r -= (m.white + m.draws + m.black); if (r <= 0) { pick = m; break; } }
  TR.game.move(pick.san, { sloppy: true });
  renderTr();
  const nd = await trBook(TR.game.fen());
  TR.busy = false;
  const opn = nd.opening && nd.opening.name ? ` (${nd.opening.name})` : '';
  if (!(nd.moves || []).length) { trEnd(`Rival jogou ${pick.san}. Fim do livro.`); return; }
  $('trStatus').textContent = `Rival jogou ${pick.san}${opn}. Sua vez — o que diz a teoria?`;
}
async function trClick(sq) {
  if (!TR.active || TR.busy || !TR.game || TR.game.turn() !== TR.color) return;
  const pc = TR.game.get(sq);
  if (TR.sel) {
    const mv = TR.game.moves({ square: TR.sel, verbose: true }).find(m => m.to === sq);
    if (mv) {
      const book = TR.cache[TR.game.fen()] || { moves: [] };
      TR.game.move({ from: TR.sel, to: sq, promotion: 'q' }); TR.sel = null; TR.busy = true;
      const idx = (book.moves || []).findIndex(m => norm(m.san) === norm(mv.san));
      TR.total++;
      let msg;
      if (idx >= 0 && idx < 3) { TR.score++; msg = `✅ ${mv.san} — na teoria (${idx + 1}º lance mais jogado pelos mestres).`; }
      else if (idx >= 0) msg = `🟡 ${mv.san} é jogável, mas os mestres preferem ${book.moves[0].san}.`;
      else msg = `❌ ${mv.san} está fora do livro. Mestres jogam: ${(book.moves || []).slice(0, 3).map(m => m.san).join(', ') || '—'}.`;
      $('trStatus').textContent = msg + ' Aguardando resposta…';
      renderTr();
      if (TR.total >= 12) { trEnd(msg); return; }
      await sleep(700);
      await trOpp();
      renderTr();
      return;
    }
  }
  TR.sel = (pc && pc.color === TR.color) ? sq : null;
  renderTr();
}
function trEnd(msg) {
  TR.active = false; TR.busy = false;
  const pct = TR.total ? Math.round(100 * TR.score / TR.total) : 0;
  $('trStatus').innerHTML = `${esc(msg)}<br><b>Resultado: ${TR.score} de ${TR.total} lances teóricos (${pct}%).</b> ${pct >= 70 ? 'Repertório sólido! 💪' : 'Repita a sessão até passar de 70%.'}`;
  renderTr();
}
$('trStart').onclick = async () => {
  TR.game = new Chess(); TR.color = $('trColor').value; TR.sel = null; TR.score = 0; TR.total = 0; TR.active = true; TR.busy = true;
  $('trStatus').textContent = 'Consultando a base de mestres…'; renderTr();
  if (TR.color === 'b') { await trOpp(); }
  else { await trBook(TR.game.fen()); TR.busy = false; $('trStatus').textContent = 'Sua vez — jogue o que a teoria recomenda.'; }
  renderTr();
};

/* ---------------- Leitor de PGN ---------------- */
let PGN_GAMES = [];
function parseMultiPgn(text) {
  return text.split(/\n(?=\[Event )/).map(s => s.trim())
    .filter(s => s.startsWith('[') || /^\d+\./.test(s))
    .map(p => ({
      w: hdr(p, 'White') || '?', b: hdr(p, 'Black') || '?', res: hdr(p, 'Result') || '*',
      date: hdr(p, 'Date') || '—', event: hdr(p, 'Event') || '—', moves: movesFromPgn(p)
    }))
    .filter(g => g.moves.length >= 2);
}
function renderPgnList() {
  $('pgnList').innerHTML = PGN_GAMES.length ?
    '<table><tr><th>#</th><th>Brancas</th><th>Pretas</th><th>Resultado</th><th>Data</th><th>Evento</th><th></th></tr>' +
    PGN_GAMES.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.w)}</td><td>${esc(g.b)}</td><td>${esc(g.res)}</td>
      <td>${esc(g.date)}</td><td>${esc(g.event)}</td>
      <td><span class="chip" onclick="pgnOpen(${i})">♟ abrir</span><span class="chip" onclick="pgnSave(${i})">💾 salvar</span></td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhum PGN carregado.</p>';
}
$('pgnLoadBtn').onclick = async () => {
  let text = '';
  const f = $('pgnFileIn').files[0];
  if (f) text = await f.text();
  else text = $('pgnText').value;
  if (!text.trim()) { $('pgnList').innerHTML = '<p style="color:var(--mut)">Cole um PGN ou escolha um arquivo.</p>'; return; }
  PGN_GAMES = parseMultiPgn(text);
  renderPgnList();
};
window.pgnOpen = i => {
  const g = PGN_GAMES[i]; if (!g) return;
  ANL.flip = false;
  anlSet(g.moves, `${g.w} vs ${g.b} (${g.res})`);
  showPage('pg-board');
};
window.pgnSave = i => {
  const g = PGN_GAMES[i]; if (!g) return;
  HIST.pgn.unshift({ w: g.w, b: g.b, res: g.res, date: g.date, event: g.event, mv: g.moves.join(' '), d: Date.now() });
  HIST.pgn = HIST.pgn.slice(0, 50); saveHist(); renderHistAll();
  $('pgnList').firstChild && ($('pgnList').firstChild.dataset = {});
};

/* ---------------- Leitor de PDF (pdf.js sob demanda) ---------------- */
let pdfDoc = null, pdfPageN = 1;
async function ensurePdfJs() {
  if (window.pdfjsLib) return true;
  try {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  } catch (e) { return false; }
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return true;
  }
  return false;
}
async function renderPdf() {
  if (!pdfDoc) return;
  const page = await pdfDoc.getPage(pdfPageN);
  const vp = page.getViewport({ scale: 1.4 });
  const c = $('pdfCanvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  $('pdfPage').textContent = pdfPageN + ' / ' + pdfDoc.numPages;
}
$('pdfFileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $('pdfStatus').textContent = 'Carregando leitor…';
  if (!await ensurePdfJs()) { $('pdfStatus').textContent = '⚠ Não foi possível carregar o leitor de PDF.'; return; }
  try {
    const buf = await f.arrayBuffer();
    pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
    pdfPageN = 1; await renderPdf();
    $('pdfStatus').textContent = `📕 ${f.name} — use os botões (ou estude com o Tabuleiro de análise aberto).`;
    HIST.pdf.unshift({ name: f.name, d: Date.now(), pages: pdfDoc.numPages });
    HIST.pdf = HIST.pdf.slice(0, 30); saveHist(); renderHistAll();
  } catch (err) { $('pdfStatus').textContent = '⚠ PDF inválido ou protegido.'; }
};
$('pdfPrev').onclick = () => { if (pdfDoc && pdfPageN > 1) { pdfPageN--; renderPdf(); } };
$('pdfNext').onclick = () => { if (pdfDoc && pdfPageN < pdfDoc.numPages) { pdfPageN++; renderPdf(); } };

/* ---------------- Históricos ---------------- */
function renderHistAll() {
  const dt = t => new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  $('histAn').innerHTML = HIST.an.length ?
    '<table><tr><th>Quando</th><th>Jogador</th><th>Plataforma</th><th>Partidas</th><th></th></tr>' +
    HIST.an.map((h, i) => `<tr><td>${dt(h.d)}</td><td>${esc(h.u)}</td><td>${h.p === 'chesscom' ? 'Chess.com' : h.p === 'lichess' ? 'Lichess' : 'PGN'}</td><td>${fmt(h.n)}</td>
      <td><span class="chip" onclick="histReopen(${i})">🔁 reabrir</span></td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhuma análise de jogador ainda.</p>';
  $('histPrec').innerHTML = HIST.prec.length ?
    '<table><tr><th>Quando</th><th>Contra</th><th>Abertura</th><th>Precisão</th><th>Erros (?!/?/??)</th></tr>' +
    HIST.prec.map(h => `<tr><td>${dt(h.d)}</td><td>${esc(h.opp)}</td><td>${esc(h.op)}</td>
      <td class="pct ${h.acc >= 80 ? 'good' : h.acc >= 60 ? 'warn' : 'bad'}">${h.acc}%</td><td>${h.err}</td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhuma análise de precisão ainda.</p>';
  $('histPgn').innerHTML = HIST.pgn.length ?
    '<table><tr><th>Salvo em</th><th>Brancas</th><th>Pretas</th><th>Resultado</th><th></th></tr>' +
    HIST.pgn.map((h, i) => `<tr><td>${dt(h.d)}</td><td>${esc(h.w)}</td><td>${esc(h.b)}</td><td>${esc(h.res)}</td>
      <td><span class="chip" onclick="histOpenPgn(${i})">♟ abrir</span></td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhum PGN salvo. Salve partidas na página Leitor PGN.</p>';
  $('histPdf').innerHTML = HIST.pdf.length ?
    '<table><tr><th>Aberto em</th><th>Arquivo</th><th>Páginas</th></tr>' +
    HIST.pdf.map(h => `<tr><td>${dt(h.d)}</td><td>${esc(h.name)}</td><td>${h.pages}</td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhum PDF aberto ainda. (Por privacidade, só o nome fica registrado — o arquivo não é armazenado.)</p>';
}
window.histReopen = i => {
  const h = HIST.an[i]; if (!h) return;
  showPage('pg-home');
  $('user').value = h.u; $('plat').value = h.p === 'pgn' ? 'chesscom' : h.p;
  if (h.p !== 'pgn') $('go').click();
};
window.histOpenPgn = i => {
  const h = HIST.pgn[i]; if (!h) return;
  ANL.flip = false;
  anlSet(h.mv.split(' '), `${h.w} vs ${h.b}`);
  showPage('pg-board');
};
window.histClear = k => {
  if (!confirm('Limpar este histórico?')) return;
  HIST[k] = []; saveHist(); renderHistAll();
};

/* ---------------- Plano de treino ---------------- */
function genPlan() {
  if (!SUM_A) { $('planOut').innerHTML = '<p style="color:var(--mut)">Analise um jogador na página Início primeiro.</p>'; return; }
  const s = SUM_A, items = [];
  s.worst.slice(0, 2).forEach(o => {
    if (o.p <= 48) items.push(`Corrigir <b>${esc(o.op)}</b> (${o.p}% em ${o.n} jogos): reveja onde as derrotas começam na árvore e fixe a linha certa contra a teoria. <span class="chip" onclick="goTree()">🌳 árvore</span> <span class="chip" onclick="goTrain()">📖 treinador</span>`);
  });
  if (s.fell.length) {
    const top = grpTrap(s.fell)[0];
    items.push(`Nunca mais cair na <b>${esc(top[0])}</b> (aconteceu ${top[1].n}x): repasse a sequência até decorar a refutação. <span class="chip" onclick="loadTrap('${top[0]}')">♟ rever armadilha</span>`);
  }
  if (s.timeLossPct >= 20) items.push(`<b>${s.timeLossPct}%</b> das derrotas são no relógio: reserve 30% do tempo para os últimos 15 lances e jogue 1 partida de ritmo mais longo por semana.`);
  if (TILT.alPct && TILT.alPct < TILT.overall - 8) items.push(`Tilt detectado (${TILT.alPct}% de aproveitamento pós-derrota vs ${TILT.overall}% geral): após 2 derrotas seguidas, pause 15 minutos. Sem exceção.`);
  if (s.minis.length >= 3) items.push(`${s.minis.length} derrotas em ≤ 12 lances: antes do lance 10, confira sempre — rei seguro? f7/f2 defendidos? todas as peças desenvolvidas?`);
  if (HIST.prec.length) {
    const tot = { 'Abertura': 0, 'Meio-jogo': 0, 'Final': 0 };
    HIST.prec.forEach(p => { if (p.ph) Object.keys(tot).forEach(k => tot[k] += p.ph[k] || 0); });
    const sum = tot['Abertura'] + tot['Meio-jogo'] + tot['Final'];
    if (sum) {
      const worst = Object.entries(tot).sort((a, b) => b[1] - a[1])[0][0];
      items.push(`O motor mostra que <b>${worst}</b> concentra ${Math.round(100 * Object.entries(tot).sort((a, b) => b[1] - a[1])[0][1] / sum)}% dos seus erros graves — priorize essa fase no estudo. <span class="chip" onclick="showPage('pg-prec')">🎯 ver detalhes</span>`);
    }
  } else {
    items.push(`Rode a <b>análise de precisão</b> em 3–5 partidas para descobrir em que fase o jogo escapa. <span class="chip" onclick="showPage('pg-prec')">🎯 analisar agora</span>`);
  }
  items.push('Rotina semanal sugerida: <b>seg/qua/sex</b> 20 min de tática · <b>ter/qui</b> 15 min de repertório no Treinador · <b>sáb</b> 1 partida longa + análise de precisão · <b>dom</b> descanso.');
  $('planOut').innerHTML = '<ol style="padding-left:20px">' + items.map(t => `<li style="margin-bottom:12px">${t}</li>`).join('') + '</ol>';
}
$('planGen').onclick = genPlan;
window.goTree = () => showPage('pg-open');
window.goTrain = () => showPage('pg-train');

/* ---------------- Galeria de armadilhas ---------------- */
function renderTrapsGallery() {
  $('trapsGallery').innerHTML = TRAPS.map(t =>
    `<div style="padding:12px 0;border-bottom:1px solid var(--line)">
      <b>${t.name}</b> <small style="color:var(--mut)">— favorece as ${t.side === 'w' ? 'Brancas' : 'Pretas'}</small>
      <span class="chip" onclick="loadTrap('${t.name}')">♟ ver no tabuleiro</span><br>
      <span style="font-family:ui-monospace,monospace;font-size:.82rem;color:var(--mut)">${t.seq.join(' ')}</span><br>
      <small style="color:var(--mut)">${t.desc || ''}</small>
    </div>`).join('');
}

/* ---------------- Integrações entre páginas ---------------- */
function populateGameSelects() {
  const arr = FILTERED.slice(-100).reverse();
  const opts = arr.map((g, i) => {
    const d = g.ts ? new Date(g.ts).toLocaleDateString('pt-BR') : '—';
    const res = g.result === 'w' ? '✅ V' : (g.result === 'l' ? '❌ D' : '➖ E');
    return `<option value="${FILTERED.length - 1 - i}">${d} · ${g.color === 'w' ? '♔' : '♚'} vs ${esc(g.opName || '?')} (${g.opRating || '—'}) · ${res} · ${esc(famName(g.opening))}</option>`;
  }).join('');
  $('anlGame').innerHTML = opts || '<option value="">—</option>';
  $('precGame').innerHTML = opts || '<option value="">—</option>';
}
window.loadLine = s => { ANL.flip = false; anlSet(s.split(' '), 'Linha carregada'); showPage('pg-board'); };
window.loadTrap = n => {
  const t = TRAPS.find(x => x.name === n); if (!t) return;
  ANL.flip = t.side === 'b';
  anlSet(t.seq.slice(), 'Armadilha: ' + n);
  showPage('pg-board');
};
window.quickGo = (u, p) => { showPage('pg-home'); $('user').value = u; $('plat').value = p; $('go').click(); };
function renderRecent() {
  const r = PREF.recent || [];
  $('recentBox').classList.toggle('hide', !r.length);
  $('recentChips').innerHTML = r.map(x => `<span class="chip" onclick="quickGo('${esc(x.u)}','${x.p}')">🕑 ${esc(x.u)} · ${x.p === 'chesscom' ? 'Chess.com' : 'Lichess'}</span>`).join('');
}
function applyUi() {
  document.documentElement.setAttribute('data-theme', PREF.uiTheme || 'dark');
  document.documentElement.style.setProperty('--font', "'" + (PREF.uiFont || 'Inter') + "'");
  Chart.defaults.color = (PREF.uiTheme === 'light') ? '#5b6478' : '#94a3b8';
}
function repaintBoards() {
  if (game) renderBoard();
  renderAnl(); renderTr();
  if (FILTERED.length) renderTree();
  else { const g = new Chess(); drawBoard($('tboard'), g, { bottom: 'w' }); }
}

/* ---------------- Roteador de páginas ---------------- */
const PAGE_TITLES = {
  'pg-home':'análise de jogador', 'pg-prec':'precisão Stockfish', 'pg-open':'aberturas & armadilhas',
  'pg-train':'treino', 'pg-board':'tabuleiro de análise', 'pg-bot':'bot',
  'pg-pgn':'leitor PGN', 'pg-pdf':'leitor PDF', 'pg-hist':'histórico'
};
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('act', p.id === id));
  document.querySelectorAll('#drawer a[data-go]').forEach(a => a.classList.toggle('act', a.dataset.go === id));
  $('topSub').textContent = PAGE_TITLES[id] || '';
  $('drawer').classList.remove('open'); $('scrim').classList.remove('on');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.showPage = showPage;

/* ---------------- Animações de entrada ---------------- */
function revealInit() {
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); }
  }), { threshold: .06 });
  document.querySelectorAll('.card').forEach(c => { c.classList.add('reveal'); io.observe(c); });
}

/* ---------------- Inicialização ---------------- */
(function init() {
  // menu lateral
  $('menuBtn').onclick = () => { $('drawer').classList.toggle('open'); $('scrim').classList.toggle('on'); };
  $('scrim').onclick = () => { $('drawer').classList.remove('open'); $('scrim').classList.remove('on'); };
  document.querySelectorAll('#drawer a[data-go]').forEach(a => a.onclick = () => showPage(a.dataset.go));

  // hub: exemplos e recentes
  const EXAMPLES = [['hikaru','chesscom'],['magnuscarlsen','chesscom'],['DrNykterstein','lichess'],['penguingm1','lichess']];
  $('examples').innerHTML = EXAMPLES.map(([u, p]) =>
    `<span class="chip" onclick="quickGo('${u}','${p}')">${u} · ${p === 'chesscom' ? 'Chess.com' : 'Lichess'}</span>`).join('');
  renderRecent();

  // aparência
  $('uiTheme').value = PREF.uiTheme || 'dark';
  $('uiFont').value = PREF.uiFont || 'Inter';
  $('uiTheme').onchange = () => { savePref('uiTheme', $('uiTheme').value); applyUi(); if (FILTERED.length) analyze(FILTERED, RAW.user); };
  $('uiFont').onchange = () => { savePref('uiFont', $('uiFont').value); applyUi(); };
  applyUi();

  // tabuleiro
  $('boardTheme').value = PREF.theme || 'esmeralda';
  { const ps = PREF.pieces === 'svg' ? 'cburnett' : (PREF.pieces || 'cburnett');
    $('pieceSet').value = ps; if (!$('pieceSet').value) $('pieceSet').value = 'cburnett'; }
  $('boardTheme').onchange = () => { savePref('theme', $('boardTheme').value); repaintBoards(); };
  $('pieceSet').onchange = () => { savePref('pieces', $('pieceSet').value); repaintBoards(); };

  // teclado no tabuleiro de análise
  document.addEventListener('keydown', e => {
    if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    const pg = document.querySelector('.page.act');
    if (!pg || pg.id !== 'pg-board') return;
    if (e.key === 'ArrowLeft') { anlGoto(ANL.idx - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { anlGoto(ANL.idx + 1); e.preventDefault(); }
  });

  // acesso rápido
  if (PREF.lastUser && !$('user').value) {
    $('user').value = PREF.lastUser;
    if (PREF.lastPlat) $('plat').value = PREF.lastPlat;
  }
  $('user').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });

  // conteúdo inicial
  revealInit();
  renderAnl();
  renderTr();
  newBotGame();
  renderTrapsGallery();
  renderHistAll();
  renderPrecPhase();
  { const g = new Chess(); drawBoard($('tboard'), g, { bottom: 'w' }); }

  // link compartilhado (?user=&plat=&n=)
  const qp = new URLSearchParams(location.search);
  if (qp.get('user')) {
    $('user').value = qp.get('user');
    if (qp.get('plat')) $('plat').value = qp.get('plat');
    if (qp.get('n')) $('maxg').value = qp.get('n');
    setTimeout(() => $('go').click(), 200);
  }
})();
