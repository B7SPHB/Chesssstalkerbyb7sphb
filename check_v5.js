// Verificação parse-only dos blocos novos da v5
const $=id=>({}),fmt=n=>n,pctc=p=>'',famName=n=>n,savePref=()=>{},analyze=()=>{},anlSet=()=>{},drawBoard=()=>{};
const PREF={},TRAPS=[],ANL={},RAW={},FILTERED=[],TREE={path:[],color:'w'};
let Chart={defaults:{color:''}};

function tbl(rows){
  let h='';
  for(const r of rows){
    const pts=String(r.w+r.d*0.5).replace('.5','½');
    h+=`<tr><td>${r.op}</td><td>${r.n}</td><td>${r.w} / ${r.d} / ${r.l}</td>
    <td><span class="pct ${pctc(r.p)}">${r.p}%</span> <small style="color:var(--mut)">(${pts} de ${r.n} pts)</small><div class="bar"><i style="width:${r.p}%"></i></div></td></tr>`;
  }
  return h+'</table>';
}

function ovNoteTest(all){
  return `<b>Como ler os números:</b> aproveitamento = (vitórias + ½ × empates) ÷ partidas. Aqui: (${all.w} + ${all.d}÷2) ÷ ${fmt(all.n)} = <b>${all.p}%</b>. Vitórias secas: ${Math.round(100*all.w/all.n)}% (${fmt(all.w)} de ${fmt(all.n)}). Derrotas: ${Math.round(100*all.l/all.n)}% (${fmt(all.l)} de ${fmt(all.n)}).`;
}

function treeBoardTest(){
  {const g=new Chess();let lm=null;
   for(const m of TREE.path){const mm=g.move(m,{sloppy:true});if(mm)lm=[mm.from,mm.to];else break;}
   drawBoard($('tboard'),g,{bottom:TREE.color,lastMove:lm});}
}

const EXAMPLES=[['hikaru','chesscom'],['magnuscarlsen','chesscom'],['DrNykterstein','lichess'],['penguingm1','lichess']];
$('examples').innerHTML=EXAMPLES.map(([u,p])=>`<span class="chip" onclick="quickGo('${u}','${p}')">${u} · ${p==='chesscom'?'Chess.com':'Lichess'}</span>`).join('');
window.quickGo=(u,p)=>{$('user').value=u;$('plat').value=p;$('go').click();};
function renderRecent(){
  const r=PREF.recent||[];
  $('recentBox').classList.toggle('hide',!r.length);
  $('recentChips').innerHTML=r.map(x=>`<span class="chip" onclick="quickGo('${x.u}','${x.p}')">🕑 ${x.u} · ${x.p==='chesscom'?'Chess.com':'Lichess'}</span>`).join('');
}
renderRecent();
function applyUi(){
  document.documentElement.setAttribute('data-theme',PREF.uiTheme||'dark');
  document.documentElement.style.setProperty('--font',"'"+(PREF.uiFont||'Inter')+"'");
  Chart.defaults.color=(PREF.uiTheme==='light')?'#5b6478':'#94a3b8';
}
$('uiTheme').value=PREF.uiTheme||'dark';
$('uiFont').value=PREF.uiFont||'Inter';
$('uiTheme').onchange=()=>{savePref('uiTheme',$('uiTheme').value);applyUi();
  if(FILTERED.length)analyze(FILTERED,RAW.user);};
$('uiFont').onchange=()=>{savePref('uiFont',$('uiFont').value);applyUi();};
applyUi();
window.loadLine=s=>{ANL.flip=false;anlSet(s.split(' '),'Linha carregada');location.hash='#sec-anl';};
window.loadTrap=n=>{const t=TRAPS.find(x=>x.name===n);if(!t)return;
  ANL.flip=t.side==='b';anlSet(t.seq,'Armadilha: '+n);location.hash='#sec-anl';};

function recentUpdateTest(user,plat){
  const rec=(PREF.recent||[]).filter(x=>!(x.u===user&&x.p===plat));
  rec.unshift({u:user,p:plat});savePref('recent',rec.slice(0,6));renderRecent();
}
