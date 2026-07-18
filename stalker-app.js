'use strict';
/* =====================================================================
 * Stalker · stalker-app.js
 * Motor Stockfish, tabuleiros, visualizador, Twin Bot, análise profunda
 * com mapa de calor, estatísticas de finais, radar psicológico e lendas.
 * Carregado após stalker-core.js.
 * ===================================================================== */

/* ---------- tabuleiro ---------- */
const LIGHT='#eeeed2',DARK='#769656';
const PIECE_CDN='https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/';
const GLYPH={p:'♟',n:'♞',b:'♝',r:'♜',q:'♛',k:'♚'};
let svgFail=false;
function drawBoard(el,gm,o){
  if(!el)return;
  el.innerHTML='';
  const files=['a','b','c','d','e','f','g','h'];
  const ranks=o.bottom==='w'?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];
  const fs=o.bottom==='w'?files:[...files].reverse();
  const frag=document.createDocumentFragment();
  for(const r of ranks)for(const f of fs){
    const sq=f+r,d=document.createElement('div');
    d.className='sq';
    d.style.background=((files.indexOf(f)+r)%2!==0)?LIGHT:DARK;
    if(o.sel===sq)d.classList.add('sel');
    if(o.legal&&o.legal.includes(sq))d.classList.add('dot');
    if(o.lastMove&&(o.lastMove[0]===sq||o.lastMove[1]===sq))d.classList.add('last');
    const pc=gm.get(sq);
    if(pc){
      if(!svgFail){
        const img=document.createElement('img');
        img.src=PIECE_CDN+pc.color+pc.type.toUpperCase()+'.svg';
        img.alt=pc.type;
        img.onerror=()=>{if(!svgFail){svgFail=true;drawBoard(el,gm,o);}};
        d.appendChild(img);
      }else{d.textContent=GLYPH[pc.type];d.classList.add(pc.color==='w'?'wp':'bp');}
    }
    if(o.click)d.onclick=()=>o.click(sq);
    frag.appendChild(d);
  }
  el.appendChild(frag);
}

/* ---------- motor Stockfish (fila) ---------- */
const Engine=(()=>{
  let worker=null,ready=false,job=null,failed=false,queue=Promise.resolve();
  async function init(){
    if(ready)return true;
    if(failed)return false;
    if(!worker){
      try{
        const code=await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js')).text();
        worker=new Worker(URL.createObjectURL(new Blob([code],{type:'application/javascript'})));
        worker.onmessage=e=>{
          const d=typeof e.data==='string'?e.data:'';
          if(d==='uciok')ready=true;
          if(job&&d.startsWith('info ')){
            const m=d.match(/score (cp|mate) (-?\d+)/);
            if(m)job.score={type:m[1],v:+m[2]};
          }
          if(job&&d.startsWith('bestmove')){
            const j=job;job=null;
            j.res({best:d.split(' ')[1],score:j.score});
          }
        };
        worker.postMessage('uci');
      }catch(e){failed=true;return false;}
    }
    for(let i=0;i<50&&!ready;i++)await sleep(100);
    if(!ready)failed=true;
    return ready;
  }
  function run(fen,go,skill=20){
    const p=queue.then(()=>new Promise(res=>{
      if(!worker||!ready){res(null);return;}
      job={res,score:null};
      worker.postMessage('setoption name Skill Level value '+skill);
      worker.postMessage('position fen '+fen);
      worker.postMessage(go);
    }));
    queue=p.catch(()=>{});
    return p;
  }
  return {init,run,get ok(){return ready;}};
})();
const skillFromElo=e=>Math.max(0,Math.min(20,Math.round((e-550)/112)));
const winPct=cp=>50+50*(2/(1+Math.exp(-0.00368208*Math.max(-1500,Math.min(1500,cp))))-1);

/* ---------- visualizador ---------- */
const V={moves:[],idx:0,flip:false,last:null};
function vRender(){
  const g=new Chess();let last=null;
  for(let k=0;k<V.idx;k++){const m=g.move(V.moves[k],{sloppy:true});if(m)last=[m.from,m.to];}
  drawBoard($('vboard'),g,{bottom:V.flip?'b':'w',lastMove:last});
  const done=V.moves.slice(0,V.idx);
  $('vStatus').textContent=(done.length?done.map((m,i)=>i%2===0?`${i/2+1}. ${m}`:m).join('  '):'Posição inicial')+`  (${V.idx}/${V.moves.length})`;
}
function vLoad(moves,label,flip){
  const t=new Chess(),ok=[];
  for(const s of moves){const m=t.move(s,{sloppy:true});if(!m)break;ok.push(m.san);}
  V.moves=ok;V.idx=Math.min(ok.length,8);V.flip=!!flip;
  $('vLabel').textContent='— '+label;
  vRender();
  $('secViewer').scrollIntoView({behavior:'smooth',block:'center'});
}
$('vStart').onclick=()=>{V.idx=0;vRender();};
$('vPrev').onclick=()=>{V.idx=Math.max(0,V.idx-1);vRender();};
$('vNext').onclick=()=>{V.idx=Math.min(V.moves.length,V.idx+1);vRender();};
$('vEnd').onclick=()=>{V.idx=V.moves.length;vRender();};
$('vFlip').onclick=()=>{V.flip=!V.flip;vRender();};
document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.key==='ArrowLeft'){V.idx=Math.max(0,V.idx-1);vRender();e.preventDefault();}
  if(e.key==='ArrowRight'){V.idx=Math.min(V.moves.length,V.idx+1);vRender();e.preventDefault();}
});

/* ---------- SK: pontes para os cliques ---------- */
window.SK={
  viewTrap(name){
    const t=TRAPS.find(x=>x.name===name);if(!t)return;
    vLoad(t.seq,'Armadilha: '+name,t.side==='b');
  },
  viewOpening(op,color){
    if(!P)return;
    const pool=P.recs.filter(g=>g.color===color&&(g.opening===op||famName(g.opening)===op));
    if(!pool.length)return;
    const pm={};pool.forEach(g=>{const k=g.moves.slice(0,12).map(norm).join(' ');pm[k]=(pm[k]||0)+1;});
    const top=Object.entries(pm).sort((a,b)=>b[1]-a[1])[0];
    vLoad(top[0].split(' '),`Linha dele: ${op} (${top[1]}x)`,color==='w');
  },
  viewGame(i){
    const g=P&&P.recs[i];if(!g)return;
    vLoad(g.moves,`vs ${g.opName} (${g.result==='w'?'venceu':g.result==='l'?'perdeu':'empatou'})`,g.color==='b');
  }
};

/* ---------- radar psicológico ---------- */
let psyChart=null;
function renderPsyChart(p){
  if(psyChart)psyChart.destroy();
  psyChart=new Chart($('chPsy'),{type:'radar',
    data:{labels:p.psy.map(d=>d.k.toUpperCase()),
      datasets:[{data:p.psy.map(d=>d.score),backgroundColor:'rgba(139,92,246,.25)',
        borderColor:'#8b5cf6',pointBackgroundColor:'#4ade80',borderWidth:2}]},
    options:{plugins:{legend:{display:false}},
      scales:{r:{min:0,max:100,ticks:{display:false},grid:{color:'rgba(148,143,176,.15)'},
        angleLines:{color:'rgba(148,143,176,.15)'},pointLabels:{font:{size:9}}}}}});
}

/* ---------- Twin Bot ---------- */
const TW={game:null,color:'b',sel:null,busy:false,token:0,last:null};
function twRender(){
  const g=TW.game||new Chess();
  const legal=TW.sel?g.moves({square:TW.sel,verbose:true}).map(m=>m.to):null;
  drawBoard($('twinBoard'),g,{bottom:TW.color==='w'?'b':'w',sel:TW.sel,legal,lastMove:TW.last,click:twClick});
}
function twinBookMove(){
  if(!P)return null;
  const hist=TW.game.history().map(norm);
  if(hist.length>24)return null;
  const cand={};
  for(const g of P.recs){
    if(g.color!==TW.color)continue;
    let ok=true;
    for(let i=0;i<hist.length;i++)if(norm(g.moves[i]||'')!==hist[i]){ok=false;break;}
    if(ok&&g.moves[hist.length]){const k=norm(g.moves[hist.length]);cand[k]=(cand[k]||0)+1;}
  }
  const arr=Object.entries(cand),tot=arr.reduce((a,x)=>a+x[1],0);
  if(tot<2)return null;
  let r=Math.random()*tot;
  for(const [k,n] of arr){r-=n;if(r<=0)return{san:k,n,tot};}
  return null;
}
async function twMove(){
  if(!TW.game||TW.game.game_over())return;
  const tok=TW.token;TW.busy=true;
  $('twinStatus').textContent='O gêmeo está pensando…';
  const book=twinBookMove();
  if(book){
    await sleep(500);
    if(tok!==TW.token)return;
    const m=TW.game.move(book.san,{sloppy:true});
    if(m){TW.last=[m.from,m.to];TW.busy=false;twRender();
      $('twinBook').innerHTML=`📖 <span class="good">no livro dele</span>: ${m.san} (${book.n} de ${book.tot} partidas)`;
      twStatus();return;}
  }
  $('twinBook').innerHTML='🧮 fora do livro — Stockfish no Elo dele';
  await Engine.init();
  let done=false;
  if(Engine.ok){
    const sk=skillFromElo(P?P.estElo:1200);
    const r=await Engine.run(TW.game.fen(),'go movetime '+(150+sk*60),sk);
    if(tok===TW.token&&r&&r.best&&r.best!=='(none)'){
      const m=TW.game.move({from:r.best.slice(0,2),to:r.best.slice(2,4),promotion:r.best[4]||'q'});
      if(m){TW.last=[m.from,m.to];done=true;}
    }
  }
  if(!done&&tok===TW.token&&!TW.game.game_over()&&TW.game.turn()===TW.color){
    const ms=TW.game.moves({verbose:true});
    const pick=ms[Math.floor(Math.random()*ms.length)];
    if(pick){TW.game.move(pick.san);TW.last=[pick.from,pick.to];}
  }
  if(tok!==TW.token)return;
  TW.busy=false;twRender();twStatus();
}
function twStatus(){
  const g=TW.game;if(!g)return;
  if(g.in_checkmate())$('twinStatus').innerHTML=g.turn()===TW.color?'<span class="good">Xeque-mate — você venceu o gêmeo! Agora vá vencer o original. 🏆</span>':'<span class="bad">O gêmeo venceu — estude o plano e tente de novo.</span>';
  else if(g.in_draw())$('twinStatus').textContent='Empate.';
  else $('twinStatus').textContent=(g.turn()===TW.color?'Vez do gêmeo':'Sua vez')+(g.in_check()?' — xeque!':'');
}
function twClick(sq){
  if(!TW.game||TW.busy||TW.game.game_over())return;
  if(TW.game.turn()===TW.color)return;
  const pc=TW.game.get(sq);
  if(TW.sel){
    const mv=TW.game.moves({square:TW.sel,verbose:true}).find(m=>m.to===sq);
    if(mv){TW.game.move({from:TW.sel,to:sq,promotion:'q'});TW.last=[TW.sel,sq];TW.sel=null;
      twRender();twStatus();
      if(!TW.game.game_over())setTimeout(twMove,250);
      return;}
  }
  TW.sel=(pc&&pc.color!==TW.color)?sq:null;
  twRender();
}
$('twinStart').onclick=()=>{
  if(!P){$('twinStatus').textContent='Stalkeie um jogador primeiro.';return;}
  TW.token++;TW.game=new Chess();TW.sel=null;TW.last=null;TW.busy=false;
  TW.color=$('twinColor').value==='w'?'b':'w'; // gêmeo joga a cor oposta à sua
  $('twinBook').textContent='';
  twRender();twStatus();
  Engine.init();
  if(TW.game.turn()===TW.color)setTimeout(twMove,400);
};

/* ---------- Análise profunda + mapa de calor ---------- */
let DEEP={abort:false};
function heatRender(counts){
  const files=['a','b','c','d','e','f','g','h'];
  const max=Math.max(1,...Object.values(counts));
  let h='';
  for(let r=8;r>=1;r--)for(const f of files){
    const sq=f+r,c=counts[sq]||0;
    const base=((files.indexOf(f)+r)%2!==0)?'rgba(238,238,210,.10)':'rgba(20,18,33,.6)';
    h+=`<div style="background:${c?`rgba(251,113,133,${0.15+0.8*c/max})`:base}">${c?sq:''}</div>`;
  }
  $('heatBoard').innerHTML=h;
}
$('deepGo').onclick=async()=>{
  if(!P){$('deepProg').textContent='Stalkeie um jogador primeiro.';return;}
  $('deepGo').disabled=true;
  $('deepProg').textContent='Iniciando o Stockfish…';
  const ok=await Engine.init();
  if(!ok){$('deepProg').textContent='⚠ Motor indisponível neste navegador.';$('deepGo').disabled=false;return;}
  const N=+$('deepN').value;
  const games=[...P.recs].filter(g=>g.moves.length>=30).sort((a,b)=>b.ts-a.ts).slice(0,N);
  if(!games.length){$('deepProg').textContent='Sem partidas longas o bastante.';$('deepGo').disabled=false;return;}
  const phases={Abertura:[],['Meio-jogo']:[],Final:[]};
  const heat={};let firstErrs=[],clutchG=[],clutchB=[],pieceCnt={},errCnt=0,plyTot=0,plyDone=0;
  games.forEach(g=>plyTot+=Math.min(g.moves.length,90)+1);
  for(const g of games){
    const t=new Chess(),plies=[];
    for(const s of g.moves.slice(0,90)){const m=t.move(s,{sloppy:true});if(!m)break;plies.push(m);}
    const t2=new Chess(),fens=[t2.fen()];
    for(const m of plies){t2.move(m.san,{sloppy:true});fens.push(t2.fen());}
    const evals=[];
    for(let i=0;i<fens.length;i++){
      plyDone++;setProg(plyDone/plyTot);
      $('deepProg').textContent=`Stockfish analisando… posição ${plyDone} de ${plyTot}`;
      const r=await Engine.run(fens[i],'go movetime 120',20);
      let cp=0;if(r&&r.score)cp=r.score.type==='mate'?(r.score.v>0?10000:-10000):r.score.v;
      evals.push(fens[i].split(' ')[1]==='w'?cp:-cp);
    }
    let firstErr=null;
    for(let i=0;i<plies.length&&i+1<evals.length;i++){
      if(plies[i].color!==g.color)continue;
      const c=g.color;
      const before=c==='w'?winPct(evals[i]):100-winPct(evals[i]);
      const after=c==='w'?winPct(evals[i+1]):100-winPct(evals[i+1]);
      const loss=Math.max(0,before-after);
      const acc=Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*loss)-3.1669));
      const pieces=fens[i].split(' ')[0].replace(/[^nbrqNBRQ]/g,'').length;
      const phase=i<20?'Abertura':(pieces<=6?'Final':'Meio-jogo');
      phases[phase].push(acc);
      (before>=55?clutchG:before<=45?clutchB:[]).push(acc);
      if(loss>=20){
        errCnt++;heat[plies[i].to]=(heat[plies[i].to]||0)+1;
        pieceCnt[plies[i].piece]=(pieceCnt[plies[i].piece]||0)+1;
        if(firstErr===null)firstErr=Math.floor(i/2)+1;
      }
    }
    if(firstErr!==null)firstErrs.push(firstErr);
  }
  setProg(null);$('deepGo').disabled=false;
  $('deepProg').textContent=`✔ ${games.length} partidas analisadas pelo motor.`;
  const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)/a.length):null;
  const pieceNames={p:'Peões',n:'Cavalo',b:'Bispo',r:'Torre',q:'Dama',k:'Rei'};
  const worstPiece=Object.entries(pieceCnt).sort((a,b)=>b[1]-a[1])[0];
  $('deepOut').innerHTML=`<div class="grid g3">${Object.entries(phases).map(([k,v])=>
    `<div class="stat"><div class="v ${avg(v)>=80?'good':avg(v)>=65?'warn':'bad'}">${avg(v)??'—'}%</div><div class="l">Precisão — ${k}</div></div>`).join('')}</div>`;
  $('deepStats').innerHTML='<ul class="plain">'+
    `<li>⚡ <b>Primeiro erro grave (média):</b> lance #${firstErrs.length?Math.round(firstErrs.reduce((a,b)=>a+b,0)/firstErrs.length):'—'}</li>`+
    `<li>🎭 <b>Clutch factor:</b> ganhando ${avg(clutchG)??'—'}% de precisão · perdendo ${avg(clutchB)??'—'}% ${avg(clutchG)!==null&&avg(clutchB)!==null?(avg(clutchB)<avg(clutchG)-8?'— <span class="bad">desmorona quando fica pior</span>':'— <span class="good">luta bem por baixo</span>'):''}</li>`+
    `<li>♟ <b>Peça problemática:</b> ${worstPiece?pieceNames[worstPiece[0]]+' ('+worstPiece[1]+' erros graves)':'—'}</li>`+
    `<li>💥 <b>Erros graves no total:</b> ${errCnt} em ${games.length} partidas</li>`+
  '</ul>';
  heatRender(heat);
};

/* ---------- Estatísticas de finais ---------- */
$('endGo').onclick=()=>{
  if(!P){$('endOut').innerHTML='<p style="color:var(--mut)">Stalkeie um jogador primeiro.</p>';return;}
  $('endGo').disabled=true;
  $('endOut').innerHTML='<p style="color:var(--mut)">Classificando finais…</p>';
  const cap=Math.min(P.recs.length,400);
  const types={};let i=0;
  const step=()=>{
    const end=Math.min(i+25,cap);
    for(;i<end;i++){
      const g=P.recs[i];
      if(g.moves.length<40)continue;
      const t=new Chess();
      const cnt={q:2,r:4,b:4,n:4};let tot=14,typ=null;
      for(const s of g.moves){
        const m=t.move(s,{sloppy:true});if(!m)break;
        if(m.captured&&cnt[m.captured]!==undefined){cnt[m.captured]--;tot--;}
        if(m.promotion&&cnt[m.promotion]!==undefined){cnt[m.promotion]++;tot++;}
        if(tot<=6){
          typ=cnt.q>0?(tot===cnt.q?'Finais de Damas':'Damas + peças'):
              cnt.r>0?(tot===cnt.r?'Finais de Torres':'Torres + menores'):
              (cnt.b>0&&cnt.n>0)?'Menores (B+C)':
              cnt.b>0?'Finais de Bispos':cnt.n>0?'Finais de Cavalos':'Finais de Peões';
          break;
        }
      }
      if(typ)(types[typ]=types[typ]||[]).push(g);
    }
    if(i<cap){$('endOut').innerHTML=`<p style="color:var(--mut)">Classificando… ${i}/${cap}</p>`;setTimeout(step,0);return;}
    const rows=Object.entries(types).map(([k,v])=>({k,...wdl(v),recs:v})).sort((a,b)=>b.n-a.n);
    if(!rows.length){$('endOut').innerHTML='<p style="color:var(--mut)">Poucos finais na amostra.</p>';$('endGo').disabled=false;return;}
    const best=[...rows].filter(r=>r.n>=4).sort((a,b)=>b.p-a.p)[0];
    const worst=[...rows].filter(r=>r.n>=4).sort((a,b)=>a.p-b.p)[0];
    $('endOut').innerHTML=
      `<div class="grid g2" style="margin-bottom:12px">
        <div class="stat"><div class="l">💪 Ponto forte</div><div class="v good">${best?best.p+'%':'—'}</div><div class="l">${best?best.k+' ('+best.n+' jogos)':''}</div></div>
        <div class="stat"><div class="l">🧨 Ponto fraco — force isto!</div><div class="v bad">${worst?worst.p+'%':'—'}</div><div class="l">${worst?worst.k+' ('+worst.n+' jogos)':''}</div></div>
      </div>
      <table><tr><th>Tipo de final</th><th>Jogos</th><th>V/E/D</th><th>Conversão</th><th>Exemplos</th></tr>`+
      rows.map(r=>`<tr><td>${r.k}</td><td>${r.n}</td><td>${r.w}/${r.d}/${r.l}</td>
        <td><span class="pct ${pcls(r.p)}">${r.p}%</span><div class="bar"><i style="width:${r.p}%"></i></div></td>
        <td>${r.recs.slice(-3).map(g=>g.url?`<a href="${g.url}" target="_blank">↗</a>`:'').join(' ')}</td></tr>`).join('')+'</table>';
    $('endGo').disabled=false;
  };
  step();
};

/* ---------- Galeria de Lendas ---------- */
const LEGENDS=[
 {ini:'PM',name:'Paul Morphy',pais:'EUA',
  estilo:'Desenvolvimento acelerado e ataques ao rei antes de o rival terminar de acordar. O pai do xadrez posicionalmente justificado no ataque.',
  abert:'Italiana · Gambito Evans · 1.e4 e5',
  dicas:['Desenvolva TODAS as peças antes de atacar','Abra linhas quando estiver à frente em desenvolvimento','Rei no centro = alvo'],
  linha:['e4','e5','Nf3','d6','d4','Bg4','dxe5','Bxf3','Qxf3','dxe5','Bc4','Nf6','Qb3','Qe7','Nc3','c6','Bg5','b5','Nxb5'],
  lLabel:'A Partida da Ópera (1858) — ataque modelo'},
 {ini:'BF',name:'Bobby Fischer',pais:'EUA',
  estilo:'Precisão implacável e preparação de abertura décadas à frente. Transformava vantagens mínimas em pontos inteiros.',
  abert:'1.e4 ("best by test") · Najdorf · Ataque Sozin',
  dicas:['Estude finais de torre — metade dos seus finais serão eles','Repertório estreito e profundo vence amplo e raso','Jogue sempre contra o plano do rival'],
  linha:['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6','Bc4'],
  lLabel:'Ataque Sozin contra a Najdorf — a arma dele'},
 {ini:'GK',name:'Garry Kasparov',pais:'RUS',
  estilo:'Dinamismo máximo: iniciativa vale mais que material. Preparação de abertura como arma de guerra.',
  abert:'Siciliana Najdorf · Índia do Rei · Gambito da Dama recusado',
  dicas:['Calcule as linhas críticas até o fim','A iniciativa justifica sacrifícios de peão','Prepare surpresas específicas para cada rival — o espírito deste site'],
  linha:['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O','Be2','e5'],
  lLabel:'Índia do Rei — o campo de batalha favorito'},
 {ini:'MT',name:'Mikhail Tal',pais:'URS',
  estilo:'O Mago de Riga: sacrifícios que ninguém consegue refutar com o relógio andando. Caos calculado.',
  abert:'1.e4 · Siciliana aberta · Ataques com Bxh7/Nxf7',
  dicas:['Um sacrifício incorreto que o rival não refuta é correto','Leve o jogo para onde só você enxerga','Complique quando estiver pior'],
  linha:['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','e6','Nc3','Qc7','g3'],
  lLabel:'Siciliana Taimanov — terreno de sacrifícios'},
 {ini:'JC',name:'José Raúl Capablanca',pais:'CUB',
  estilo:'A máquina de xadrez: técnica pura, finais perfeitos e zero lances desnecessários. Ficou 8 anos sem perder.',
  abert:'Gambito da Dama · Ruy López · simplificação vencedora',
  dicas:['Aprenda finais ANTES de aberturas','Troque peças quando tiver estrutura melhor','Simplicidade é a sofisticação máxima'],
  linha:['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O','Nf3','Nbd7'],
  lLabel:'Gambito da Dama clássico — o território dele'},
 {ini:'MB',name:'Mikhail Botvinnik',pais:'URS',
  estilo:'O patriarca da escola soviética: preparação científica, posições fechadas e estratégia de longo prazo.',
  abert:'Francesa Winawer · Inglesa · Sistema Botvinnik',
  dicas:['Analise as próprias partidas sem piedade — como a página Análise Profunda faz','Treine com propósito específico','Estruturas de peões ditam os planos'],
  linha:['c4','e5','Nc3','Nf6','g3','d5','cxd5','Nxd5','Bg2','Nb6','Nf3','Nc6','O-O','Be7','d3','O-O'],
  lLabel:'Sistema Inglês/Botvinnik — aperto posicional'},
];
function renderLegends(){
  $('legendChips').innerHTML=LEGENDS.map((l,i)=>
    `<div class="lgd" onclick="SK.legend(${i})"><b>${l.ini}</b><span>${l.name.split(' ').pop()}</span><small>${l.pais}</small></div>`).join('');
}
SK.legend=i=>{
  const l=LEGENDS[i];if(!l)return;
  $('legendOut').innerHTML=`<div class="card" style="margin:0">
    <h2>${l.ini} · ${esc(l.name)} <small>(${l.pais})</small></h2>
    <p style="font-size:.92rem;margin-bottom:8px">${l.estilo}</p>
    <p style="font-size:.85rem;color:var(--mut);margin-bottom:8px"><b>Repertório:</b> ${l.abert}</p>
    <ul class="plain">${l.dicas.map(d=>`<li>💎 ${d}</li>`).join('')}</ul>
    <p style="margin-top:10px"><span class="chip" onclick="SK.legendLine(${i})">♟ ${l.lLabel}</span></p>
  </div>`;
};
SK.legendLine=i=>{const l=LEGENDS[i];vLoad(l.linha,l.name+' — '+l.lLabel,false);};

/* ---------- inicialização ---------- */
(function init(){
  vRender();
  twRender();
  renderLegends();
  heatRender({});
  const qp=new URLSearchParams(location.search);
  if(qp.get('user')){
    $('user').value=qp.get('user');
    if(qp.get('plat'))$('plat').value=qp.get('plat');
    setTimeout(()=>$('go').click(),200);
  }
})();
