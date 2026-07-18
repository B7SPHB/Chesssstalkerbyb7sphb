// Verificação de sintaxe dos blocos novos/alterados da v4 (parse-only)
const $=id=>document.getElementById(id);
const norm=s=>s,famName=n=>n,movesFromPgn=t=>[],savePref=()=>{},initEngine=async()=>{},updateBotStatus=()=>{},clickSq=()=>{};
const THEMES={esmeralda:['#eee','#769656']},GLYPH={p:'♟'},LETTER={p:'P'},PREF={};
let FILTERED=[],game=null,sel=null,playerColor='w',lastMove=null,hint=null,hintMode=false,engine=null,engineReady=false,thinking=false;

const PIECE_CDN='https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/';
const SVG_SETS=['cburnett','merida','alpha','maestro','staunty','tatiana'];
const pieceUrl=(setName,pc)=>PIECE_CDN+setName+'/'+pc.color+pc.type.toUpperCase()+'.svg';
let svgFail=false;

function fakeHandler(){
    const onmessage=e=>{
      const d=typeof e.data==='string'?e.data:'';
      if(d==='uciok')engineReady=true;
      if(evalMode&&d.startsWith('info ')){
        const m=d.match(/score (cp|mate) (-?\d+)/);
        if(m)lastScore={type:m[1],v:+m[2]};
      }
      if(d.startsWith('bestmove')){
        const mv=d.split(' ')[1];
        if(evalMode){evalMode=false;showEval(mv);return;}
        if(!mv||mv==='(none)'||!game)return;
        if(hintMode){hintMode=false;hint=[mv.slice(0,2),mv.slice(2,4)];renderBoard();return;}
        game.move({from:mv.slice(0,2),to:mv.slice(2,4),promotion:mv[4]||'q'});
        lastMove=[mv.slice(0,2),mv.slice(2,4)];
        thinking=false;renderBoard();updateBotStatus();
      }
    };
    return onmessage;
}

function drawBoard(el,gm,o){
  el.innerHTML='';
  const th=THEMES[$('boardTheme').value]||THEMES.esmeralda;
  let set=$('pieceSet').value;
  if(set==='svg')set='cburnett';
  if(svgFail&&SVG_SETS.includes(set))set='uni';
  const files=['a','b','c','d','e','f','g','h'];
  const ranks=o.bottom==='w'?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];
  const fs=o.bottom==='w'?files:[...files].reverse();
  const frag=document.createDocumentFragment();
  for(const r of ranks)for(const f of fs){
    const sqName=f+r;
    const d=document.createElement('div');
    const isLight=(files.indexOf(f)+r)%2!==0;
    d.className='sq';
    d.style.background=isLight?th[0]:th[1];
    if(o.sel===sqName)d.classList.add('sel');
    if(o.legal&&o.legal.includes(sqName))d.classList.add('dot');
    if(o.lastMove&&(o.lastMove[0]===sqName||o.lastMove[1]===sqName))d.classList.add('last');
    if(o.hint&&(o.hint[0]===sqName||o.hint[1]===sqName))d.classList.add('hint');
    const pc=gm.get(sqName);
    if(pc){
      if(SVG_SETS.includes(set)){
        const img=document.createElement('img');
        img.src=pieceUrl(set,pc);
        img.alt=pc.type;
        img.onerror=()=>{if(!svgFail){svgFail=true;drawBoard(el,gm,o);}};
        d.appendChild(img);
      }else if(set==='txt'){
        d.textContent=LETTER[pc.type];d.classList.add('txtset',pc.color==='w'?'wp':'bp');
      }else{
        d.textContent=GLYPH[pc.type];d.classList.add(pc.color==='w'?'wp':'bp');
      }
    }
    if(o.click)d.onclick=()=>o.click(sqName);
    frag.appendChild(d);
  }
  el.appendChild(frag);
}
function renderBoard(){
  if(!game)return;
  const legal=sel?game.moves({square:sel,verbose:true}).map(m=>m.to):null;
  drawBoard($('board'),game,{bottom:playerColor,sel,legal,lastMove,hint,click:clickSq});
  const hist=game.history();
  $('moves').textContent=hist.map((m,i)=>i%2===0?`${i/2+1}. ${m}`:m).join('  ');
}

$('boardTheme').value=PREF.theme||'esmeralda';
{const ps=PREF.pieces==='svg'?'cburnett':(PREF.pieces||'cburnett');
 $('pieceSet').value=ps;
 if(!$('pieceSet').value)$('pieceSet').value='cburnett';}
$('boardTheme').onchange=()=>{savePref('theme',$('boardTheme').value);if(game)renderBoard();renderAnl();};
$('pieceSet').onchange=()=>{savePref('pieces',$('pieceSet').value);if(game)renderBoard();renderAnl();};

/* ---------- Tabuleiro de análise ---------- */
let ANL={game:new Chess(),moves:[],idx:0,flip:false,last:null};
let evalMode=false,lastScore=null;
function populateAnlGames(){
  const arr=FILTERED.slice(-100).reverse();
  $('anlGame').innerHTML=arr.map((g,i)=>{
    const d=g.ts?new Date(g.ts).toLocaleDateString('pt-BR'):'—';
    const res=g.result==='w'?'✅ V':(g.result==='l'?'❌ D':'➖ E');
    return `<option value="${FILTERED.length-1-i}">${d} · ${g.color==='w'?'♔':'♚'} vs ${g.opName||'?'} (${g.opRating||'—'}) · ${res} · ${famName(g.opening)}</option>`;
  }).join('')||'<option>—</option>';
}
function anlSet(moves,label){
  const t=new Chess(),ok=[];
  for(const s of moves){if(!t.move(s,{sloppy:true}))break;ok.push(s);}
  ANL.moves=ok;ANL.idx=0;ANL.last=null;ANL.game=new Chess();
  $('evalTxt').textContent='';
  renderAnl();
  $('anlStatus').textContent=`${label} — ${ok.length} meios-lances. Navegue com ◀ ▶ ou as setas do teclado.`;
}
function anlGoto(i){
  i=Math.max(0,Math.min(ANL.moves.length,i));
  const g=new Chess();let last=null;
  for(let k=0;k<i;k++){const m=g.move(ANL.moves[k],{sloppy:true});if(m)last=[m.from,m.to];}
  ANL.game=g;ANL.idx=i;ANL.last=last;
  $('evalTxt').textContent='';
  renderAnl();
}
function renderAnl(){
  if(!$('aboard'))return;
  drawBoard($('aboard'),ANL.game,{bottom:ANL.flip?'b':'w',lastMove:ANL.last});
  if(ANL.moves.length){
    const done=ANL.moves.slice(0,ANL.idx);
    $('anlStatus').textContent=(done.length?done.map((m,i)=>i%2===0?`${i/2+1}. ${m}`:m).join('  '):'Posição inicial')+`   (${ANL.idx}/${ANL.moves.length})`;
  }
}
$('anlLoad').onclick=()=>{
  const g=FILTERED[+$('anlGame').value];
  if(!g){$('anlStatus').textContent='Analise um jogador primeiro.';return;}
  ANL.flip=g.color==='b';
  anlSet(g.moves,`Partida vs ${g.opName||'?'}`);
};
$('anlLoadFen').onclick=()=>{
  const v=$('anlFen').value.trim();
  if(!v)return;
  if(/^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\s/.test(v)){
    const g=new Chess();
    if(g.load(v)){ANL.game=g;ANL.moves=[];ANL.idx=0;ANL.last=null;
      $('anlStatus').textContent='FEN carregado.';$('evalTxt').textContent='';renderAnl();}
    else $('anlStatus').textContent='FEN inválido.';
  }else{
    ANL.flip=false;anlSet(movesFromPgn(v),'Lances colados');
  }
};
$('anlStart').onclick=()=>anlGoto(0);
$('anlPrev').onclick=()=>anlGoto(ANL.idx-1);
$('anlNext').onclick=()=>anlGoto(ANL.idx+1);
$('anlEnd').onclick=()=>anlGoto(ANL.moves.length);
$('anlFlip').onclick=()=>{ANL.flip=!ANL.flip;renderAnl();};
document.addEventListener('keydown',e=>{
  if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;
  if($('results').classList.contains('hide'))return;
  if(e.key==='ArrowLeft'){anlGoto(ANL.idx-1);e.preventDefault();}
  if(e.key==='ArrowRight'){anlGoto(ANL.idx+1);e.preventDefault();}
});
function showEval(bestUci){
  let txt='',num=NaN;
  if(lastScore){
    const sign=ANL.game.turn()==='b'?-1:1;
    if(lastScore.type==='mate'){
      const mv=lastScore.v*sign;
      txt='M'+Math.abs(lastScore.v)+(mv>0?' (Brancas)':' (Pretas)');num=mv>0?99:-99;
    }else{num=lastScore.v*sign/100;txt=(num>=0?'+':'')+num.toFixed(2);}
  }
  let san='';
  if(bestUci&&bestUci!=='(none)'){
    const t=new Chess(ANL.game.fen());
    const m=t.move({from:bestUci.slice(0,2),to:bestUci.slice(2,4),promotion:bestUci[4]||'q'});
    if(m)san='  ·  melhor lance: '+m.san;
  }
  $('evalTxt').textContent=(txt||'—')+san;
  $('evalTxt').style.color=isNaN(num)?'var(--mut)':(num>0.3?'var(--good)':(num<-0.3?'var(--bad)':'var(--txt)'));
}
$('anlEval').onclick=()=>{
  if(engine&&engineReady){
    evalMode=true;lastScore=null;
    engine.postMessage('setoption name Skill Level value 20');
    engine.postMessage('position fen '+ANL.game.fen());
    engine.postMessage('go depth 14');
    $('evalTxt').textContent='avaliando…';$('evalTxt').style.color='var(--mut)';
  }else{
    $('evalTxt').textContent='carregando motor… clique de novo em 2s';
    $('evalTxt').style.color='var(--mut)';
    initEngine();
  }
};

/* ---------- Acesso rápido ---------- */
if(PREF.lastUser&&!$('user').value){
  $('user').value=PREF.lastUser;
  if(PREF.lastPlat)$('plat').value=PREF.lastPlat;
}
$('user').addEventListener('keydown',e=>{if(e.key==='Enter')$('go').click();});
