'use strict';
/* =====================================================================
 * Stalker · stalker-core.js
 * Coleta (Chess.com/Lichess com relógios), métricas de previsibilidade,
 * psicologia, tempo, repertório, armadilhas, nêmesis e renderização.
 * ===================================================================== */

/* ---------- utilidades ---------- */
const $=id=>document.getElementById(id);
const norm=s=>s.replace(/[+#?!]/g,'');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>(+n).toLocaleString('pt-BR');
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,Math.round(v)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
Chart.defaults.color='#948fb0';
Chart.defaults.font.family="'Inter',sans-serif";
function setProg(f){const p=$('pbar');
  if(f===null){p.style.opacity=0;setTimeout(()=>{p.style.width='0';p.style.opacity=1},600);}
  else p.style.width=Math.min(100,Math.round(f*100))+'%';}

/* ---------- 21 armadilhas monitoradas ---------- */
const TRAPS=[
 {name:"Mate Pastor",side:'w',seq:["e4","e5","Qh5"]},
 {name:"Mate Pastor (Bc4)",side:'w',seq:["e4","e5","Bc4","Nc6","Qh5"]},
 {name:"Fried Liver",side:'w',seq:["e4","e5","Nf3","Nc6","Bc4","Nf6","Ng5","d5","exd5","Nxd5","Nxf7"]},
 {name:"Mate de Légal",side:'w',seq:["e4","e5","Nf3","Nc6","Bc4","d6","Nc3","Bg4","Nxe5"]},
 {name:"Blackburne Shilling",side:'b',seq:["e4","e5","Nf3","Nc6","Bc4","Nd4","Nxe5","Qg5"]},
 {name:"Gambito Stafford",side:'b',seq:["e4","e5","Nf3","Nf6","Nxe5","Nc6","Nxc6","dxc6"]},
 {name:"Gambito Englund",side:'b',seq:["d4","e5","dxe5","Nc6","Nf3","Qe7","Bf4","Qb4"]},
 {name:"Lasker (Albin)",side:'b',seq:["d4","d5","c4","e5","dxe5","d4","e3","Bb4","Bd2","dxe3"]},
 {name:"Armadilha do Elefante",side:'b',seq:["d4","d5","c4","e6","Nc3","Nf6","Bg5","Nbd7","cxd5","exd5","Nxd5","Nxd5"]},
 {name:"Fishing Pole",side:'b',seq:["e4","e5","Nf3","Nc6","Bb5","Nf6","O-O","Ng4"]},
 {name:"Kieninger (Budapeste)",side:'b',seq:["d4","Nf6","c4","e5","dxe5","Ng4","Bf4","Nc6","Nf3","Bb4","Nbd2","Qe7","a3","Ngxe5"]},
 {name:"Arca de Noé",side:'b',seq:["e4","e5","Nf3","Nc6","Bb5","a6","Ba4","d6","d4","b5","Bb3","Nxd4","Nxd4","exd4"]},
 {name:"Halosar (BDG)",side:'w',seq:["d4","d5","e4","dxe4","Nc3","Nf6","f3","exf3","Qxf3"]},
 {name:"Gambito Rousseau",side:'b',seq:["e4","e5","Nf3","Nc6","Bc4","f5"]},
 {name:"Mortimer",side:'b',seq:["e4","e5","Nf3","Nc6","Bb5","Nf6","d3","Ne7"]},
 {name:"Siberiana (Smith-Morra)",side:'b',seq:["e4","c5","d4","cxd4","c3","dxc3","Nxc3","Nc6","Nf3","e6","Bc4","Qc7","O-O","Nf6","Qe2","Ng4"]},
 {name:"Petrov Qe2",side:'w',seq:["e4","e5","Nf3","Nf6","Nxe5","Nxe4","Qe2"]},
 {name:"Gambito Tennison",side:'w',seq:["Nf3","d5","e4","dxe4","Ng5"]},
 {name:"Caro-Kann Nd6#",side:'w',seq:["e4","c6","d4","d5","Nc3","dxe4","Nxe4","Nd7","Qe2"]},
 {name:"Mate do Louco",side:'b',seq:["f3","e5","g4","Qh4"]},
 {name:"Punição da Damiano",side:'w',seq:["e4","e5","Nf3","f6","Nxe5","fxe5","Qh5"]},
];

/* ---------- parsing ---------- */
function movesFromPgn(pgn){
  const parts=pgn.split(/\n\s*\n/);
  let t=parts.length>1?parts.slice(1).join(' '):pgn;
  t=t.replace(/\{[^}]*\}/g,' ').replace(/\([^)]*\)/g,' ')
     .replace(/\$\d+/g,' ').replace(/\d+\.+/g,' ').replace(/(1-0|0-1|1\/2-1\/2|\*)/g,' ');
  return t.split(/\s+/).filter(x=>x&&x!=='...');
}
function hdr(p,k){const m=p.match(new RegExp('\\['+k+' "([^"]*)"'));return m?m[1]:null;}
function famName(n){if(!n)return'Desconhecida';let f=n.split(':')[0].split(',')[0];f=f.replace(/\s+\d.*$/,'').trim();return f||'Desconhecida';}
function ecoUrlName(u){if(!u)return null;const s=u.split('/').pop().replace(/-/g,' ');return s.replace(/\s+\d.*$/,'').trim();}
function hmsToSec(s){const p=s.split(':').map(parseFloat);return p.length===3?p[0]*3600+p[1]*60+p[2]:(p[0]*60+(p[1]||0));}
function clocksFromPgn(pgn){const out=[];const re=/\[%clk ([0-9:.]+)\]/g;let m;while((m=re.exec(pgn)))out.push(hmsToSec(m[1]));return out;}

/* ---------- coleta ---------- */
async function fetchChessCom(user,maxg,st){
  const r=await fetch(`https://api.chess.com/pub/player/${user}/games/archives`);
  if(!r.ok)throw new Error('Usuário não encontrado no Chess.com');
  const months=(await r.json()).archives.reverse();
  const recs=[];
  for(let i=0;i<months.length&&recs.length<maxg;i+=8){
    st(`Baixando… ${fmt(recs.length)}/${fmt(maxg)}`);setProg(recs.length/maxg);
    const rs=await Promise.all(months.slice(i,i+8).map(m=>fetch(m).then(x=>x.json()).catch(()=>({games:[]}))));
    for(const res of rs)for(const g of (res.games||[]).reverse()){
      if(recs.length>=maxg)break;
      if(g.rules!=='chess'||!g.pgn)continue;
      const isW=g.white.username.toLowerCase()===user.toLowerCase();
      const me=isW?g.white:g.black,op=isW?g.black:g.white;
      let r2='d';
      if(me.result==='win')r2='w';
      else if(['checkmated','timeout','resigned','abandoned','lose'].includes(me.result))r2='l';
      recs.push({color:isW?'w':'b',result:r2,myRating:me.rating,opRating:op.rating,opName:op.username,
        tc:g.time_class,ts:g.end_time*1000,url:g.url,moves:movesFromPgn(g.pgn),
        clksAll:clocksFromPgn(g.pgn),
        opening:ecoUrlName(hdr(g.pgn,'ECOUrl'))||hdr(g.pgn,'ECO')||'Desconhecida',
        eco:hdr(g.pgn,'ECO')||'',term:me.result==='win'?op.result:me.result});
    }
  }
  return recs;
}
function liParse(ln,user){
  let g;try{g=JSON.parse(ln)}catch(e){return null}
  if(g.variant!=='standard'||!g.moves)return null;
  const isW=(g.players.white.user?.name||'').toLowerCase()===user.toLowerCase();
  const me=isW?g.players.white:g.players.black;
  let res='d';if(g.winner)res=(g.winner==='white')===isW?'w':'l';
  const term={mate:'checkmated',resign:'resigned',outoftime:'timeout',timeout:'abandoned'}[g.status]||g.status;
  return {color:isW?'w':'b',result:res,myRating:me.rating||0,
    opRating:(isW?g.players.black:g.players.white).rating||0,
    opName:(isW?g.players.black:g.players.white).user?.name||'?',
    tc:g.speed,ts:g.createdAt,url:`https://lichess.org/${g.id}`,
    moves:g.moves.split(' '),clksAll:(g.clocks||[]).map(c=>c/100),
    opening:g.opening?g.opening.name:'Desconhecida',eco:g.opening?g.opening.eco:'',
    term:res==='l'?term:(res==='w'?'win':'draw')};
}
async function fetchLichess(user,maxg,st){
  st('Conectando ao Lichess…');
  const r=await fetch(`https://lichess.org/api/games/user/${user}?max=${maxg}&opening=true&clocks=true`,
    {headers:{Accept:'application/x-ndjson'}});
  if(r.status===429)throw new Error('Lichess limitou as requisições — aguarde 1 minuto.');
  if(!r.ok)throw new Error('Usuário não encontrado no Lichess');
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='';const recs=[];
  for(;;){const {done,value}=await rd.read();if(done)break;
    buf+=dec.decode(value,{stream:true});
    const ls=buf.split('\n');buf=ls.pop();
    for(const ln of ls){const rec=liParse(ln,user);if(rec)recs.push(rec);}
    st(`Baixando… ${fmt(recs.length)} partidas`);setProg(recs.length/maxg);}
  if(buf.trim()){const rec=liParse(buf,user);if(rec)recs.push(rec);}
  return recs;
}

/* ---------- estatística básica ---------- */
function wdl(a){const w=a.filter(g=>g.result==='w').length,l=a.filter(g=>g.result==='l').length,d=a.length-w-l;
  return{w,d,l,n:a.length,p:a.length?Math.round(100*(w+d*0.5)/a.length):0};}
const pcls=p=>p>=55?'good':(p<45?'bad':'warn');

/* ---------- perfil global ---------- */
let P=null;
function buildProfile(recs,user){
  recs.sort((a,b)=>a.ts-b.ts);
  const p={recs,user,all:wdl(recs)};
  const rated=recs.filter(g=>g.myRating>0);
  p.curRating=rated.length?rated[rated.length-1].myRating:0;
  // rating por ritmo (último visto)
  p.perSpeed={};rated.forEach(g=>p.perSpeed[g.tc]=g.myRating);
  // Elo estimado (ritmo favorito + peso exponencial)
  const r60=rated.slice(-60),tcC={};r60.forEach(g=>tcC[g.tc]=(tcC[g.tc]||0)+1);
  p.estEloTc=Object.keys(tcC).sort((a,b)=>tcC[b]-tcC[a])[0]||null;
  const pool=p.estEloTc?r60.filter(g=>g.tc===p.estEloTc):r60;
  if(pool.length){let ws=0,vs=0;pool.forEach((g,i)=>{const w=Math.pow(.93,pool.length-1-i);ws+=w;vs+=w*g.myRating;});p.estElo=Math.round(vs/ws);}
  else p.estElo=1200;
  // tilt / sequências
  let curL=0,maxL=0,curW=0,maxW=0,tilts=0,alW=0,alN=0,prev=null;
  recs.forEach(g=>{
    if(prev==='l'){alN++;if(g.result==='w')alW++;}
    if(g.result==='l'){curL++;curW=0;if(curL===3)tilts++;}
    else if(g.result==='w'){curW++;curL=0;}else{curL=0;curW=0;}
    maxL=Math.max(maxL,curL);maxW=Math.max(maxW,curW);prev=g.result;});
  p.maxL=maxL;p.maxW=maxW;p.tilts=tilts;
  p.postLoss={n:alN,w:alW,pct:alN?Math.round(100*alW/alN):0};
  p.overall=p.all.p;
  const losses=recs.filter(g=>g.result==='l');p.losses=losses;
  p.timeoutLossPct=losses.length?Math.round(100*losses.filter(g=>g.term==='timeout').length/losses.length):0;
  p.resignEarlyPct=losses.length?Math.round(100*losses.filter(g=>g.term==='resigned'&&g.moves.length<=50).length/losses.length):0;
  p.minis=losses.filter(g=>g.moves.length<=24);
  // relógio
  p.time=computeTime(recs);
  // aberturas por família e por variante completa
  const grp=(sel,key)=>{const m={};recs.forEach(g=>{if(g.color!==sel)return;const k=key(g);(m[k]=m[k]||[]).push(g);});
    return Object.entries(m).map(([k,v])=>({op:k,g:v[v.length-1],...wdl(v),recs:v})).sort((a,b)=>b.n-a.n);};
  p.famW=grp('w',g=>famName(g.opening));p.famB=grp('b',g=>famName(g.opening));
  p.fullW=grp('w',g=>g.opening);p.fullB=grp('b',g=>g.opening);
  // padrões repetitivos: fatia dos 3 prefixos (8 meios-lances) mais comuns
  const pref={};recs.forEach(g=>{const k=g.color+':'+g.moves.slice(0,8).map(norm).join(' ');pref[k]=(pref[k]||0)+1;});
  const top3=Object.values(pref).sort((a,b)=>b-a).slice(0,3).reduce((a,b)=>a+b,0);
  p.patternShare=recs.length?Math.round(100*top3/recs.length):0;
  // concentração de repertório (fatia dos 2 principais por cor)
  const conc=rows=>{const t=rows.reduce((a,r)=>a+r.n,0)||1;return Math.round(100*rows.slice(0,2).reduce((a,r)=>a+r.n,0)/t);};
  p.repConc=Math.round((conc(p.famW)+conc(p.famB))/2);
  // armadilhas
  p.fell=[];p.used=[];
  recs.forEach(g=>{const mv=g.moves.map(norm);
    for(const t of TRAPS)if(t.seq.length<=mv.length&&t.seq.every((x,i)=>mv[i]===x)){
      if(g.color===t.side){if(g.result==='w')p.used.push({t,g});}
      else if(g.result==='l')p.fell.push({t,g});}});
  // nêmesis / presa
  const om={};recs.forEach(g=>{if(!g.opName||g.opName==='?')return;(om[g.opName]=om[g.opName]||[]).push(g);});
  p.rivals=Object.entries(om).map(([k,v])=>({op:k,...wdl(v),g:v[v.length-1]})).filter(r=>r.n>=2).sort((a,b)=>b.n-a.n);
  const sig=p.rivals.filter(r=>r.n>=2);
  p.nemesis=sig.length?[...sig].sort((a,b)=>a.p-b.p)[0]:null;
  p.prey=sig.length?[...sig].sort((a,b)=>b.p-a.p)[0]:null;
  // sinais do Stalker Score (0-100: quanto maior, mais explorável)
  const gap=Math.max(0,p.overall-p.postLoss.pct);
  p.sig={
    rep:clamp((p.repConc-25)*1.7),
    tempo:clamp(p.timeoutLossPct*1.6+(p.time.pctLow||0)*.9),
    tilt:clamp(gap*3+p.maxL*4+p.tilts*3),
    pad:clamp(p.patternShare*2.4)
  };
  p.score=clamp(p.sig.rep*.3+p.sig.tempo*.22+p.sig.tilt*.28+p.sig.pad*.2);
  p.verdict=p.score>=70?'Altamente previsível — com preparação, ele cai.':
    p.score>=45?'Jogador moderadamente previsível. Algumas tendências exploráveis.':
    'Pouco previsível — confie no seu próprio jogo.';
  // psicologia (0-100, maior = mais resiliente)
  const ratings=rated.slice(-40).map(g=>g.myRating);
  const mean=ratings.length?ratings.reduce((a,b)=>a+b,0)/ratings.length:0;
  const sd=ratings.length?Math.sqrt(ratings.reduce((a,b)=>a+(b-mean)**2,0)/ratings.length):0;
  p.psy=[
    {k:'Estabilidade',score:clamp(100-sd*1.4),raw:Math.round(sd)+' pts de oscilação',bad:'Instável',good:'Sólida'},
    {k:'Tilt',score:clamp(100-p.tilts*7-p.maxL*4),raw:p.tilts+' sessões de tilt',bad:'Propenso ao tilt',good:'Controlado'},
    {k:'Pós-derrota',score:clamp(p.postLoss.pct*1.4),raw:p.postLoss.pct+'% de vitórias após derrota',bad:'Com dificuldade',good:'Reage bem'},
    {k:'Tempo esgotado',score:clamp(100-p.timeoutLossPct*1.6),raw:p.timeoutLossPct+'% das derrotas no tempo',bad:'Cai de bandeira',good:'Boa'},
    {k:'Série',score:clamp(100-p.maxL*8),raw:'série máx: '+p.maxL+' derrotas',bad:'Sequências longas',good:'Corta cedo'},
    {k:'Desistências',score:clamp(100-p.resignEarlyPct),raw:p.resignEarlyPct+'% desistem cedo',bad:'Desiste cedo',good:'Luta até o fim'}
  ];
  // card estilo FIFA
  const fastWins=recs.filter(g=>g.result==='w'&&g.moves.length<=30).length;
  const mates=recs.filter(g=>g.result==='w'&&g.term==='checkmated').length;
  p.card={
    ovr:clamp((p.estElo-400)/24,5,99),
    atk:clamp(35+100*fastWins/Math.max(1,p.all.w)*0.6+100*mates/Math.max(1,p.all.w)*0.4,5,99),
    def:clamp(92-100*p.minis.length/Math.max(1,losses.length)*0.9-p.fell.length*3,5,99),
    tempo:clamp(95-p.timeoutLossPct*1.2-(p.time.pctLow||0)*0.4,5,99),
    mente:clamp(p.psy.reduce((a,d)=>a+d.score,0)/6,5,99)
  };
  // fraquezas / forças por variante (mín. 3 jogos)
  const weak=rows=>rows.filter(r=>r.n>=3).sort((a,b)=>a.p-b.p).slice(0,3);
  const strong=rows=>rows.filter(r=>r.n>=3).sort((a,b)=>b.p-a.p).slice(0,2);
  p.weakW=weak(p.fullW);p.strongW=strong(p.fullW);
  p.weakB=weak(p.fullB);p.strongB=strong(p.fullB);
  p.recent=recs.slice(-8).reverse();
  return p;
}

/* ---------- relógio ---------- */
function computeTime(recs){
  let games=0,low=0,thinkSum=0,thinkN=0,inst=0,instN=0;
  for(const g of recs){
    if(!g.clksAll||g.clksAll.length<10)continue;
    const off=g.color==='w'?0:1,own=[];
    for(let i=off;i<g.clksAll.length;i+=2)own.push(g.clksAll[i]);
    if(own.length<5)continue;
    games++;
    if(Math.min(...own)<30)low++;
    let found=false;
    for(let i=1;i<own.length;i++){
      const spent=Math.max(0,own[i-1]-own[i]);
      if(!found&&spent>8){thinkSum+=i+1;thinkN++;found=true;}
      if(i>=6){instN++;if(spent<1)inst++;}
    }
  }
  return games?{games,pctLow:Math.round(100*low/games),
    thinkAvg:thinkN?(thinkSum/thinkN).toFixed(1):null,
    instPct:instN?Math.round(100*inst/instN):0,
    cover:Math.round(100*games/recs.length)}:{games:0};
}

/* ---------- renderização ---------- */
function render(p){
  P=p;
  // player card
  const ini=p.user.slice(0,2).toUpperCase();
  const months=p.recs.length?Math.max(1,Math.round((Date.now()-p.recs[0].ts)/2629800000)):0;
  const speeds=['bullet','blitz','rapid','classical','daily','rápida','correspondence'];
  const spHtml=Object.entries(p.perSpeed).sort((a,b)=>speeds.indexOf(a[0])-speeds.indexOf(b[0]))
    .map(([k,v])=>`<div><b>${fmt(v)}</b><span>${esc(k)}</span></div>`).join('');
  $('pcard').innerHTML=`
    <div id="pAva">${esc(ini)}</div>
    <div style="flex:1;min-width:200px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:1.3rem;font-weight:700">${esc(p.user)}</div>
      <div style="color:var(--mut);font-size:.85rem">${fmt(p.all.n)} partidas · ${months} meses ·
        <span class="good">${p.all.w}W</span> <span style="color:var(--mut)">${p.all.d}D</span> <span class="bad">${p.all.l}L</span>
        · aproveitamento <b class="${pcls(p.all.p)}">${p.all.p}%</b></div>
      <div class="sub" style="margin-top:8px">${spHtml}</div>
    </div>
    <div class="ovr"><div class="n">${p.card.ovr}</div><span style="font-size:.7rem;color:var(--mut)">OVR</span></div>
    <div class="sub">
      <div><b>${p.card.atk}</b><span>ATK</span></div><div><b>${p.card.def}</b><span>DEF</span></div>
      <div><b>${p.card.tempo}</b><span>TEMPO</span></div><div><b>${p.card.mente}</b><span>MENTE</span></div>
    </div>`;
  // score
  $('scoreVal').textContent=p.score;
  $('ring').style.background=`conic-gradient(${p.score>=70?'#fb7185':p.score>=45?'#fbbf24':'#4ade80'} ${p.score*3.6}deg, rgba(148,143,176,.15) 0)`;
  $('scoreVerdict').innerHTML=`<b>${p.verdict}</b>`;
  const sigs=[['Repertório limitado',p.sig.rep],['Apuro de tempo',p.sig.tempo],['Tilta facilmente',p.sig.tilt],['Padrões repetitivos',p.sig.pad]];
  $('scoreSignals').innerHTML=sigs.map(([l,v])=>
    `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:.85rem"><span>${l}</span><b>${v}</b></div>
     <div class="bar red"><i style="width:${v}%"></i></div></div>`).join('');
  // plano de vitória
  renderPlan(p);
  renderWeak('w');
  renderPsyList(p);renderPsyChart(p);
  renderTime2(p);
  renderRep(p);
  renderTraps2(p);
  renderVs(p);
  renderRecent(p);
  $('twinStatus').textContent=`Gêmeo pronto: livro com ${fmt(p.all.n)} partidas reais · força ~${fmt(p.estElo)} Elo${p.estEloTc?' ('+esc(p.estEloTc)+')':''}.`;
  $('profile').classList.remove('hide');
}

function renderPlan(p){
  const hunter=p.postLoss.pct<p.overall-8||p.maxL>=6;
  $('beatMode').innerHTML=hunter?
    `<b class="bad">Modo Caçador:</b> ele desmorona depois de perder (${p.postLoss.pct}% pós-derrota vs ${p.overall}% geral, série máx ${p.maxL}). Não arrisque demais — mantenha a tensão e espere o erro. Se vencer a primeira, <b>a revanche é o seu melhor momento</b>.`:
    `<b class="good">Modo Espelho:</b> ele é emocionalmente estável — vença no tabuleiro: explore a pior abertura e o relógio.`;
  const items=[];
  const wA=[...p.weakW,...p.weakB].sort((a,b)=>a.p-b.p)[0];
  if(wA){
    const lado=p.fullW.includes(wA)?'de Brancas':'de Pretas';
    items.push([`Leve-o para <b>${esc(wA.op)}</b> — ele perde ${Math.round(100*wA.l/wA.n)}% ${lado} (${wA.n} partidas).`,
      `<span class="chip" onclick="SK.viewOpening(decodeURIComponent('${encodeURIComponent(wA.op)}'),'${p.fullW.includes(wA)?'w':'b'}')">♟ Jogue esta variante</span>`]);
  }
  if(p.fell.length){
    const cnt={};p.fell.forEach(({t})=>cnt[t.name]=(cnt[t.name]||0)+1);
    const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
    items.push([`Prepare armadilhas de abertura — caiu em ${p.fell.length} (${esc(top[0])} ${top[1]}x). Vulnerável.`,
      `<span class="chip" onclick="SK.viewTrap('${top[0]}')">♟ ver armadilha</span>`]);
  }
  if(p.timeoutLossPct>=12||p.time.pctLow>=15)
    items.push([`Pressione o relógio${p.time.thinkAvg?` após o lance ${Math.round(p.time.thinkAvg)}`:''} — ${p.timeoutLossPct}% das derrotas são no tempo e ele fica abaixo de 0:30 em ${p.time.pctLow||0}% das partidas.`,'']);
  if(hunter)
    items.push([`Explorar o tilt: busque várias partidas consecutivas — série máx de ${p.maxL} derrotas, joga ${Math.max(0,p.overall-p.postLoss.pct)} pontos pior após perder.`,'']);
  if(p.minis.length>=3)
    items.push([`Ataque cedo com ideias diretas: ${p.minis.length} derrotas dele em ≤ 12 lances.`,'']);
  items.push([`Jogue sólido: a nota de previsibilidade dele é <b>${p.score}/100</b> — ${p.score>=45?'siga o plano e deixe-o errar primeiro':'sem padrão claro, jogue o seu jogo'}.`,'']);
  $('checklist').innerHTML='<ul class="plain">'+items.map(([t,c],i)=>`<li>☑️ ${t} ${c}</li>`).join('')+'</ul>';
}

let WK='w';
function renderWeak(side){
  WK=side;
  $('wkW').className='tgl'+(side==='w'?' on':'');
  $('wkB').className='tgl'+(side==='b'?' on':'');
  const weak=side==='w'?P.weakW:P.weakB,strong=side==='w'?P.strongW:P.strongB;
  const lbl=side==='w'?'Brancas':'Pretas';
  const card=(r,isWeak)=>{
    const lp=Math.round(100*r.l/r.n),wp=Math.round(100*r.w/r.n);
    const when=r.g&&r.g.ts?('jogada há '+Math.max(1,Math.round((Date.now()-r.g.ts)/604800000))+' sem'):'';
    return `<div class="stat" style="text-align:left">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <b style="font-size:.92rem">${r.eco||''} ${esc(r.op)}</b>
        <span class="pct ${isWeak?'bad':'good'}" style="font-size:1.2rem">${isWeak?lp+'%':wp+'%'}</span></div>
      <div style="font-size:.75rem;color:var(--mut)">${isWeak?'Perde':'Ganha'} · ${r.n} partidas${r.n<10?' · amostra baixa':''} ${when?'· '+when:''}</div>
      ${isWeak?`<span class="chip" onclick="SK.viewOpening(decodeURIComponent('${encodeURIComponent(r.op)}'),'${side}')">♟ Jogue esta variante</span>`:''}
    </div>`;};
  $('weakOut').innerHTML=
    `<h3 class="bad" style="font-size:.88rem;margin-bottom:8px">Fraquezas — repertório dele de ${lbl}</h3>
     <div class="grid g3">${weak.length?weak.map(r=>card(r,true)).join(''):'<p style="color:var(--mut)">Sem variantes com 3+ jogos.</p>'}</div>
     <h3 class="good" style="font-size:.88rem;margin:14px 0 8px">Forças — evite estas variantes</h3>
     <div class="grid g3">${strong.length?strong.map(r=>card(r,false)).join(''):'<p style="color:var(--mut)">—</p>'}</div>`;
}

function renderPsyList(p){
  $('psyList').innerHTML='<ul class="plain">'+p.psy.map(d=>{
    const lbl=d.score>=70?d.good:(d.score>=40?'Média':d.bad);
    const cls=d.score>=70?'good':(d.score>=40?'warn':'bad');
    return `<li><div style="display:flex;justify-content:space-between"><span><b>${d.k}</b> <small style="color:var(--mut)">${d.raw}</small></span>
      <b class="${cls}">${d.score} · ${lbl}</b></div><div class="bar"><i style="width:${d.score}%"></i></div></li>`;}).join('')+'</ul>';
}

function renderTime2(p){
  const t=p.time;
  $('timeOut').innerHTML=t.games?
    `<div class="grid g4">
      <div class="stat"><div class="v">${t.thinkAvg||'—'}</div><div class="l">lance onde começa a pensar (média)</div></div>
      <div class="stat"><div class="v ${t.pctLow>=25?'bad':''}">${t.pctLow}%</div><div class="l">partidas abaixo de 0:30</div></div>
      <div class="stat"><div class="v">${t.instPct}%</div><div class="l">lances instantâneos fora da teoria</div></div>
      <div class="stat"><div class="v ${p.timeoutLossPct>=20?'bad':''}">${p.timeoutLossPct}%</div><div class="l">derrotas no tempo</div></div>
    </div>
    <p style="color:var(--mut);font-size:.8rem;margin-top:8px">${fmt(t.games)} partidas com dados de relógio (${t.cover}% da amostra).</p>`
    :'<p style="color:var(--mut)">Sem dados de relógio nesta amostra.</p>';
}

function renderRep(p){
  const tblR=(rows,title)=>{
    const tot=rows.reduce((a,r)=>a+r.n,0)||1;
    return `<h3 style="font-size:.88rem;margin-bottom:8px;color:#c4b5fd">${title}</h3>
    <table><tr><th>Linha</th><th>Uso</th><th>Score</th></tr>`+
    rows.slice(0,8).map(r=>`<tr><td>${esc(r.op)} <span class="chip" onclick="SK.viewOpening(decodeURIComponent('${encodeURIComponent(r.op)}'),'${title.includes('Brancas')?'w':'b'}')">♟</span></td>
      <td>${Math.round(100*r.n/tot)}%<div class="bar"><i style="width:${Math.round(100*r.n/tot)}%"></i></div></td>
      <td class="pct ${pcls(r.p)}">${r.p}%</td></tr>`).join('')+'</table>';};
  $('repW').innerHTML=tblR(p.famW,'Com Brancas');
  $('repB').innerHTML=tblR(p.famB,'Com Pretas');
}

function renderTraps2(p){
  const grp=arr=>{const m={};arr.forEach(({t,g})=>{(m[t.name]=m[t.name]||{n:0,g,t}).n++;m[t.name].g=g;});
    return Object.values(m).sort((a,b)=>b.n-a.n);};
  const li=(arr,mode)=>arr.length?'<ul class="plain">'+grp(arr).map(x=>{
    const when=x.g.ts?new Date(x.g.ts).toLocaleDateString('pt-BR',{day:'numeric',month:'short'}):'';
    return `<li><b>${esc(x.t.name)}</b> <small style="color:var(--mut)">${x.n}x · ${when}</small>
      <span class="chip" onclick="SK.viewTrap('${x.t.name}')">♟ ver</span>
      ${x.g.url?`<a href="${x.g.url}" target="_blank">partida ↗</a>`:''}</li>`;}).join('')+'</ul>'
    :`<p style="color:var(--mut)">${mode==='u'?'Nenhuma armadilha detectada no ataque.':'Não caiu em nenhuma das 21 monitoradas. 👏'}</p>`;
  $('trapUse2').innerHTML=li(p.used,'u');
  $('trapFall2').innerHTML=li(p.fell,'f');
}

function renderVs(p){
  const box=(t,r,cls)=>r?`<div class="stat"><div class="l">${t}</div>
    <div class="v" style="font-size:1.05rem">${esc(r.op)}</div>
    <div><span class="good">${r.w}W</span> – <span class="bad">${r.l}L</span> <small style="color:var(--mut)">(${r.n} jogos)</small></div></div>`
    :`<div class="stat"><div class="l">${t}</div><div class="v">—</div></div>`;
  let h=`<div class="grid g2" style="margin-bottom:12px">${box('😈 NÊMESIS — quem o domina',p.nemesis&&p.nemesis.p<50?p.nemesis:null)}${box('🍖 PRESA FAVORITA — quem ele domina',p.prey&&p.prey.p>50?p.prey:null)}</div>`;
  h+=p.rivals.length?'<table><tr><th>Rival</th><th>Jogos</th><th>Placar dele</th><th></th></tr>'+
    p.rivals.slice(0,9).map(r=>`<tr><td>${esc(r.op)}</td><td>${r.n}</td>
      <td><span class="pct ${pcls(r.p)}">${r.p}%</span> (${r.w}W-${r.l}L)</td>
      <td>${r.p<=35?'<span class="bad">domina ele</span>':r.p>=70?'<span class="good">alvo fácil dele</span>':''}</td></tr>`).join('')+'</table>'
    :'<p style="color:var(--mut)">Nenhum rival com 2+ partidas na amostra.</p>';
  $('vsOut').innerHTML=h;
}

function renderRecent(p){
  $('recentOut').innerHTML='<table><tr><th></th><th>Adversário</th><th>Abertura</th><th>Ritmo</th><th></th></tr>'+
    p.recent.map(g=>`<tr><td><span class="wl ${g.result==='w'?'W':g.result==='l'?'L':'D'}">${g.result==='w'?'W':g.result==='l'?'L':'D'}</span></td>
      <td>${esc(g.opName)} <small style="color:var(--mut)">(${g.opRating||'—'})</small></td>
      <td>${esc(g.opening)}</td><td>${esc(g.tc)}</td>
      <td>${g.url?`<a href="${g.url}" target="_blank">ver ↗</a>`:''}
        <span class="chip" onclick="SK.viewGame(${p.recs.indexOf(g)})">♟</span></td></tr>`).join('')+'</table>';
}

/* ---------- fluxo principal ---------- */
$('go').onclick=async()=>{
  const plat=$('plat').value,user=$('user').value.trim(),maxg=+$('maxg').value;
  const st=m=>$('status').textContent=m;
  if(!user){st('Informe o username do rival.');return;}
  try{
    $('go').disabled=true;st('Espionando…');
    const recs=plat==='chesscom'?await fetchChessCom(user,maxg,st):await fetchLichess(user,maxg,st);
    if(!recs.length)throw new Error('Nenhuma partida encontrada.');
    st(`Processando ${fmt(recs.length)} partidas…`);setProg(1);
    render(buildProfile(recs,user));
    st(`✔ Dossiê pronto: ${fmt(recs.length)} partidas analisadas.`);
  }catch(e){st('⚠ '+e.message);}
  finally{$('go').disabled=false;setProg(null);}
};
$('user').addEventListener('keydown',e=>{if(e.key==='Enter')$('go').click();});
$('wkW').onclick=()=>renderWeak('w');
$('wkB').onclick=()=>renderWeak('b');
