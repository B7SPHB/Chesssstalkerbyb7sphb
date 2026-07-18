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
  oceano: ['#e3eaf0', '#7c98b3'], roxo: ['#e9e2f7', '#8b6fc9'], noturno: ['#8f96a8', '#3e4557'],
  cinza: ['#dee1e6', '#8b929f'], rosa: ['#f7e0e6', '#c98ba0'], cafe: ['#e8d0aa', '#8a5a3b'],
  gelo: ['#eef4f8', '#a8c1d1'], floresta: ['#e3ead9', '#5f7f52']
};
const PIECE_CDN = 'https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/';
const SVG_SETS = ['cburnett','merida','alpha','maestro','staunty','tatiana',
  'fresca','gioco','governor','horsey','kosal','leipzig','pirouetti','chessnut','celtic','fantasy'];
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
            if (job.multi && m) {
              const mm = d.match(/multipv (\d+)/);
              const pv = d.match(/ pv (.+)$/);
              if (mm && pv) job.multi[+mm[1]] = { type: m[1], v: +m[2], pv: pv[1].split(' ') };
            }
          }
          if (job && d.startsWith('bestmove')) {
            const j = job; job = null;
            j.res({ best: d.split(' ')[1], score: j.score, multi: j.multi || null });
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
  function runMulti(fen, depth, n = 3) {
    const p = queue.then(() => new Promise(res => {
      if (!worker || !ready) { res(null); return; }
      job = { res, score: null, multi: {} };
      worker.postMessage('setoption name Skill Level value 20');
      worker.postMessage('setoption name MultiPV value ' + n);
      worker.postMessage('position fen ' + fen);
      worker.postMessage('go depth ' + depth);
    })).then(r => { if (worker) worker.postMessage('setoption name MultiPV value 1'); return r; });
    queue = p.catch(() => {});
    return p;
  }
  return { init, run, runMulti, get ok() { return ready; } };
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
function calibrateBot(elo, user, tc) {
  $('botElo').value = Math.min(2800, Math.max(400, elo));
  $('botEloV').textContent = $('botElo').value;
  $('botinfo').innerHTML = `Bot calibrado para <b>~${fmt(elo)} Elo</b> — média ponderada recente de <b>${esc(user)}</b>${tc ? ` no ritmo <b>${esc(tc)}</b>` : ''} (partidas novas pesam mais). Ajuste se quiser.`;
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
  const wpc = isNaN(num) ? 50 : Math.max(2, Math.min(98, 50 + 50 * (2 / (1 + Math.exp(-0.368 * Math.max(-15, Math.min(15, num)))) - 1)));
  $('evalFill').style.width = wpc + '%';
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
  renderFeed();
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
  $('gmGame').innerHTML = opts || '<option value="">—</option>';
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

/* ---------------- Utilidades de exportação ---------------- */
function sanNumbered(arr) { return arr.map((m, i) => i % 2 === 0 ? `${i / 2 + 1}. ${m}` : m).join(' '); }
function dlText(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------------- Extras do tabuleiro de análise ---------------- */
let anlTimer = null;
$('anlCopyFen').onclick = async () => {
  const fen = ANL.game.fen();
  try { await navigator.clipboard.writeText(fen); $('anlStatus').textContent = 'FEN copiado: ' + fen; }
  catch (e) { $('anlStatus').textContent = fen; }
};
$('anlPgnDl').onclick = () => {
  if (!ANL.moves.length) { $('anlStatus').textContent = 'Carregue uma partida primeiro.'; return; }
  dlText('partida_chesslens.pgn', `[Event "ChessLens"]\n[Site "ChessLens"]\n[Date "${new Date().toISOString().slice(0,10).replace(/-/g,'.')}"]\n[Result "*"]\n\n${sanNumbered(ANL.moves)} *\n`);
};
$('anlPlay').onclick = () => {
  if (anlTimer) { clearInterval(anlTimer); anlTimer = null; $('anlPlay').textContent = '▶ Auto'; return; }
  if (!ANL.moves.length) return;
  $('anlPlay').textContent = '⏸ Pausar';
  anlTimer = setInterval(() => {
    if (ANL.idx >= ANL.moves.length) { clearInterval(anlTimer); anlTimer = null; $('anlPlay').textContent = '▶ Auto'; return; }
    anlGoto(ANL.idx + 1);
  }, 900);
};
$('botPgnDl').onclick = () => {
  if (!game || !game.history().length) return;
  dlText('vs_bot_chesslens.pgn', `[Event "ChessLens vs Bot"]\n[Site "ChessLens"]\n[Date "${new Date().toISOString().slice(0,10).replace(/-/g,'.')}"]\n[White "${playerColor === 'w' ? 'Você' : 'Bot'}"]\n[Black "${playerColor === 'b' ? 'Você' : 'Bot'}"]\n[Result "*"]\n\n${sanNumbered(game.history())} *\n`);
};

/* ---------------- Ver abertura no tabuleiro (linha mais jogada) ---------------- */
window.loadOpening = fam => {
  const cand = FILTERED.filter(g => famName(g.opening) === fam);
  if (!cand.length) return;
  const colors = { w: 0, b: 0 }; cand.forEach(g => colors[g.color]++);
  const col = colors.w >= colors.b ? 'w' : 'b';
  const pool = cand.filter(g => g.color === col);
  const pm = {}; pool.forEach(g => { const k = g.moves.slice(0, 10).map(norm).join(' '); pm[k] = (pm[k] || 0) + 1; });
  const top = Object.entries(pm).sort((a, b) => b[1] - a[1])[0];
  if (!top) return;
  ANL.flip = col === 'b';
  anlSet(top[0].split(' '), `Sua linha mais jogada de ${fam} (${top[1]}x, de ${col === 'w' ? 'Brancas' : 'Pretas'})`);
  showPage('pg-board');
};

/* ---------------- Feed de atividade (Início) ---------------- */
function renderFeed() {
  const items = [];
  const dt = t => new Date(t).toLocaleDateString('pt-BR');
  HIST.an.slice(0, 4).forEach((h, i) => items.push({ d: h.d, html: `🔎 Análise de <b>${esc(h.u)}</b> — ${fmt(h.n)} partidas <span class="chip" onclick="histReopen(${i})">🔁 reabrir</span>` }));
  HIST.prec.slice(0, 3).forEach(h => items.push({ d: h.d, html: `🎯 Precisão <b class="${h.acc >= 80 ? 'good' : h.acc >= 60 ? 'warn' : 'bad'}">${h.acc}%</b> vs ${esc(h.opp)} (${esc(h.op)})` }));
  HIST.pgn.slice(0, 3).forEach((h, i) => items.push({ d: h.d, html: `📖 PGN salvo: ${esc(h.w)} × ${esc(h.b)} <span class="chip" onclick="histOpenPgn(${i})">♟ abrir</span>` }));
  BASE.slice(0, 3).forEach((h, i) => items.push({ d: h.d, html: `🗄 ChessBêse: ${esc(h.w)} × ${esc(h.b)} <span class="chip" onclick="baseOpen(${i})">♟ abrir</span>` }));
  HIST.pdf.slice(0, 2).forEach(h => items.push({ d: h.d, html: `📕 PDF lido: ${esc(h.name)}` }));
  items.sort((a, b) => b.d - a.d);
  $('feedOut').innerHTML = items.length ?
    '<ul class="plain">' + items.slice(0, 8).map(x => `<li><small style="color:var(--mut)">${dt(x.d)}</small> — ${x.html}</li>`).join('') + '</ul>'
    : '<p style="color:var(--mut)">Sua atividade aparecerá aqui: análises de jogadores, precisão no motor, PGNs e partidas do ChessBase.</p>';
}

/* ---------------- ChessBase: banco de partidas persistente ---------------- */
let BASE = (() => { try { return JSON.parse(localStorage.getItem('cl_base') || '[]'); } catch (e) { return []; } })();
function saveBase() { try { localStorage.setItem('cl_base', JSON.stringify(BASE)); } catch (e) { $('baseCount').textContent = '⚠ Banco cheio — exporte e limpe partidas antigas.'; } }
function baseAddGames(arr) {
  arr.forEach(g => BASE.unshift({
    w: g.w, b: g.b, res: g.res, date: g.date, event: g.event,
    mv: g.moves ? g.moves.join(' ') : g.mv, d: Date.now()
  }));
  BASE = BASE.slice(0, 400);
  saveBase(); renderBase(); renderFeed();
}
function renderBase() {
  const q = ($('baseSearch').value || '').toLowerCase();
  const rows = [];
  BASE.forEach((g, i) => {
    const blob = `${g.w} ${g.b} ${g.res} ${g.event} ${g.date}`.toLowerCase();
    if (!q || blob.includes(q)) rows.push([i, g]);
  });
  $('baseCount').textContent = `${fmt(BASE.length)} partida(s) no banco · ${fmt(rows.length)} exibida(s)` + (q ? ` para “${q}”` : '');
  $('baseList').innerHTML = rows.length ?
    '<table><tr><th>Data</th><th>Brancas</th><th>Pretas</th><th>Resultado</th><th>Evento</th><th></th></tr>' +
    rows.slice(0, 100).map(([i, g]) => `<tr><td>${esc(g.date)}</td><td>${esc(g.w)}</td><td>${esc(g.b)}</td><td>${esc(g.res)}</td><td>${esc(g.event)}</td>
      <td><span class="chip" onclick="baseOpen(${i})">♟ abrir</span><span class="chip" onclick="baseDel(${i})">🗑</span></td></tr>`).join('') + '</table>'
    : '<p style="color:var(--mut)">Nenhuma partida' + (q ? ' encontrada para essa busca.' : ' no banco — importe um .pgn acima.') + '</p>';
}
window.baseOpen = i => {
  const g = BASE[i]; if (!g) return;
  ANL.flip = false;
  anlSet(g.mv.split(' '), `${g.w} × ${g.b} (${g.res})`);
  showPage('pg-board');
};
window.baseDel = i => { BASE.splice(i, 1); saveBase(); renderBase(); renderFeed(); };
$('baseImport').onclick = async () => {
  const f = $('baseFileIn').files[0];
  if (!f) { $('baseCount').textContent = 'Escolha um arquivo .pgn primeiro.'; return; }
  const gs = parseMultiPgn(await f.text());
  baseAddGames(gs);
  $('baseCount').textContent = `✔ ${gs.length} partida(s) importada(s). ` + $('baseCount').textContent;
};
$('baseFromReader').onclick = () => {
  if (!PGN_GAMES.length) { $('baseCount').textContent = 'Carregue partidas na página Leitor PGN primeiro.'; return; }
  baseAddGames(PGN_GAMES);
};
$('baseExport').onclick = () => {
  if (!BASE.length) return;
  const txt = BASE.map(g =>
    `[Event "${g.event}"]\n[Date "${g.date}"]\n[White "${g.w}"]\n[Black "${g.b}"]\n[Result "${g.res}"]\n\n${sanNumbered(g.mv.split(' '))} ${g.res}\n`
  ).join('\n');
  dlText('chessbese.pgn', txt);
};
$('baseSearch').oninput = renderBase;

/* ---------------- Jogar online (desafio aberto no Lichess) ---------------- */
$('liveGo').onclick = async () => {
  const [lim, inc] = $('liveTc').value.split('+').map(Number);
  const label = $('liveTc').selectedOptions[0].text;
  $('liveOut').innerHTML = '<p style="color:var(--mut)">Criando desafio…</p>';
  try {
    const r = await fetch('https://lichess.org/api/challenge/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ 'clock.limit': lim, 'clock.increment': inc })
    });
    if (!r.ok) throw new Error('http ' + r.status);
    const d = await r.json();
    const url = (d.challenge && d.challenge.url) || d.url;
    if (!url) throw new Error('sem url');
    $('liveOut').innerHTML = `<p class="good">✔ Desafio ${esc(label)} criado!</p>
      <p style="margin:8px 0"><a href="${url}" target="_blank" style="font-size:1.05rem">${url}</a></p>
      <div class="row">
        <button class="primary" onclick="window.open('${url}','_blank')">▶ Entrar na partida</button>
        <button class="ghost" onclick="navigator.clipboard.writeText('${url}').then(()=>this.textContent='✔ copiado!')">📋 Copiar link para o oponente</button>
      </div>
      <p style="color:var(--mut);font-size:.85rem;margin-top:8px">Envie o link para qualquer pessoa do mundo (ou poste num grupo). Os dois primeiros que abrirem jogam entre si no Lichess — dá até para jogar sem conta.</p>`;
  } catch (e) {
    $('liveOut').innerHTML = '<p class="warn">⚠ Não foi possível criar o desafio agora. Tente de novo em instantes ou jogue direto no <a href="https://lichess.org" target="_blank">Lichess ↗</a>.</p>';
  }
};

/* ---------------- Módulos configuráveis (menu) ---------------- */
const MODS = [
  ['pg-prec','🎯 Precisão'], ['pg-open','📚 Aberturas'], ['pg-train','🏋️ Treino'],
  ['pg-board','♟ Tabuleiro'], ['pg-bot','🤖 Bot'], ['pg-pgn','📖 Leitor PGN'],
  ['pg-pdf','📕 Leitor PDF'], ['pg-base','🗄 ChessBêse'], ['pg-live','🌍 Jogar online'], ['pg-hist','📜 Histórico']
];
function renderMods() {
  const hid = PREF.modsOff || [];
  $('modList').innerHTML = MODS.map(([id, l]) =>
    `<label style="display:flex;gap:8px;align-items:center;font-size:.85rem;margin-bottom:4px;cursor:pointer">
      <input type="checkbox" ${hid.includes(id) ? '' : 'checked'} onchange="modToggle('${id}',this.checked)"> ${l}</label>`).join('');
  document.querySelectorAll('#drawer a[data-go]').forEach(a => {
    if (a.dataset.go !== 'pg-home') a.style.display = hid.includes(a.dataset.go) ? 'none' : 'block';
  });
}
window.modToggle = (id, on) => {
  let hid = (PREF.modsOff || []).filter(x => x !== id);
  if (!on) hid.push(id);
  savePref('modsOff', hid);
  renderMods();
};

/* ---------------- Nível GM: 3 linhas do motor (MultiPV) ---------------- */
function uciLineToSan(fen, pv, maxN = 8) {
  const t = new Chess(fen); const out = [];
  for (const u of pv.slice(0, maxN)) {
    const m = t.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
    if (!m) break; out.push(m.san);
  }
  return out.join(' ');
}
$('anlLines').onclick = async () => {
  $('anlLinesOut').innerHTML = '<p style="color:var(--mut)">Calculando as 3 melhores linhas (profundidade 16)…</p>';
  const ok = await Engine.init();
  if (!ok) { $('anlLinesOut').innerHTML = '<p class="warn">⚠ Motor indisponível neste navegador.</p>'; return; }
  const fen = ANL.game.fen(), sign = ANL.game.turn() === 'b' ? -1 : 1;
  const r = await Engine.runMulti(fen, 16, 3);
  if (!r || !r.multi || !Object.keys(r.multi).length) {
    $('anlLinesOut').innerHTML = '<p style="color:var(--mut)">Sem linhas — posição final?</p>'; return;
  }
  const rows = Object.keys(r.multi).sort().map(k => {
    const L = r.multi[k];
    const v = L.v * sign;
    const ev = L.type === 'mate' ? ('M' + Math.abs(L.v) + (v > 0 ? ' ♔' : ' ♚'))
      : ((v >= 0 ? '+' : '') + (v / 100).toFixed(2));
    return `<tr><td class="pct ${L.type === 'mate' ? (v > 0 ? 'good' : 'bad') : (v >= 30 ? 'good' : v <= -30 ? 'bad' : 'warn')}">${ev}</td>
      <td style="font-family:ui-monospace,monospace">${esc(uciLineToSan(fen, L.pv))}</td></tr>`;
  }).join('');
  $('anlLinesOut').innerHTML = '<table><tr><th>Avaliação</th><th>Linha principal (Stockfish d16)</th></tr>' + rows + '</table>';
};

/* ---------------- Nível GM: sparring de finais ---------------- */
const ENDGAMES = [
  ['Lucena — Brancas ganham', '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', 'Construa a ponte: Re1–e4, saia com o rei e bloqueie os xeques.'],
  ['Rei na 6ª + peão na 5ª — vitória técnica', '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', 'Rei na frente do peão sempre ganha: use a oposição e promova.'],
  ['Philidor — Pretas seguram o empate', '4k3/R7/8/3KP3/8/8/8/r7 b - - 0 1', 'Torre na 6ª fileira até o peão avançar; depois xeques infinitos por trás.'],
  ['Dama vs Torre — técnica de GM', '3k4/3r4/8/3QK3/8/8/8/8 w - - 0 1', 'Force o zugzwang para separar a torre do rei e ganhá-la com garfo.'],
];
$('egSel').innerHTML = ENDGAMES.map((e, i) => `<option value="${i}">${e[0]}</option>`).join('');
$('egStart').onclick = () => {
  const e = ENDGAMES[+$('egSel').value]; if (!e) return;
  botToken++;
  const g = new Chess();
  if (!g.load(e[1])) { $('egGoal').textContent = 'Posição inválida.'; return; }
  game = g; sel = null; thinking = false; lastMove = null; hint = null;
  playerColor = g.turn();
  $('botColor').value = playerColor;
  $('botElo').value = 2800; $('botEloV').textContent = '2800';
  $('botinfo').innerHTML = `🏰 <b>${e[0]}</b> — ${e[2]} <small style="color:var(--mut)">(Stockfish em força máxima)</small>`;
  $('egGoal').textContent = '✔ Posição enviada para a página Bot — boa luta!';
  Engine.init(); renderBoard(); updateBotStatus();
  showPage('pg-bot');
};

/* ---------------- Nível GM: adivinhe o lance ---------------- */
const GM = { game: null, moves: [], idx: 0, side: 'w', sel: null, score: 0, total: 0, active: false };
function renderGm() {
  const g = GM.game || new Chess();
  const legal = GM.sel ? g.moves({ square: GM.sel, verbose: true }).map(m => m.to) : null;
  drawBoard($('gmBoard'), g, { bottom: GM.side, sel: GM.sel, legal, click: gmClick });
  $('gmScore').innerHTML = GM.total ? `Acertos: <b class="${GM.score / GM.total >= 0.5 ? 'good' : 'warn'}">${GM.score}/${GM.total}</b>` : '';
}
function gmAdvance() {
  while (GM.idx < GM.moves.length && GM.game.turn() !== GM.side) {
    GM.game.move(GM.moves[GM.idx], { sloppy: true }); GM.idx++;
  }
  if (GM.idx >= GM.moves.length) gmEnd();
}
function gmClick(sq) {
  if (!GM.active || !GM.game || GM.game.turn() !== GM.side) return;
  const pc = GM.game.get(sq);
  if (GM.sel) {
    const mv = GM.game.moves({ square: GM.sel, verbose: true }).find(m => m.to === sq);
    if (mv) {
      const target = GM.moves[GM.idx];
      GM.total++;
      if (norm(mv.san) === norm(target)) { GM.score++; $('gmStatus').textContent = `✅ Exato: ${target}!`; }
      else $('gmStatus').textContent = `❌ Na partida foi jogado ${target} (você tentou ${mv.san}).`;
      GM.game.move(target, { sloppy: true }); GM.idx++; GM.sel = null;
      gmAdvance(); renderGm(); return;
    }
  }
  GM.sel = (pc && pc.color === GM.side) ? sq : null;
  renderGm();
}
function gmEnd() {
  GM.active = false;
  const pct = GM.total ? Math.round(100 * GM.score / GM.total) : 0;
  $('gmStatus').innerHTML = `<b>Fim! ${GM.score}/${GM.total} lances idênticos (${pct}%).</b> ${pct >= 40 ? 'Intuição afiada! 🔥' : 'Reveja a partida no Tabuleiro de análise para absorver os planos.'}`;
}
$('gmStart').onclick = () => {
  const g = FILTERED[+$('gmGame').value];
  if (!g) { $('gmStatus').textContent = 'Analise um jogador na página Início primeiro.'; return; }
  const t = new Chess(), ok = [];
  for (const s of g.moves) { const m = t.move(s, { sloppy: true }); if (!m) break; ok.push(m.san); }
  GM.game = new Chess(); GM.moves = ok; GM.idx = 0; GM.side = g.color;
  GM.sel = null; GM.score = 0; GM.total = 0; GM.active = true;
  gmAdvance(); renderGm();
  $('gmStatus').textContent = `Você joga de ${GM.side === 'w' ? 'Brancas' : 'Pretas'} — reproduza o que foi jogado na partida.`;
};

renderBase(); renderMods(); renderFeed(); renderGm();

/* ---------------- Roteador de páginas ---------------- */
const PAGE_TITLES = {
  'pg-home':'análise de jogador', 'pg-prec':'precisão Stockfish', 'pg-open':'aberturas & armadilhas',
  'pg-train':'treino', 'pg-board':'tabuleiro de análise', 'pg-bot':'bot',
  'pg-pgn':'leitor PGN', 'pg-pdf':'leitor PDF', 'pg-base':'ChessBêse', 'pg-live':'jogar online', 'pg-hist':'histórico'
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
