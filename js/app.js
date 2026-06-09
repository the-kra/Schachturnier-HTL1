/* ============================ CONFIG ============================ */
const CONFIG = {
  url: "https://txsrxjywegakgjizuejb.supabase.co",
  key: "sb_publishable_YhF2rLcsO8ibyZ4d9UDezA_oEwntvm5"
};

/* Anmeldebestätigung — wird LIVE im Admin-Panel umgeschaltet (in der DB-Spalte
   chess_state.verify_mode gespeichert, via Realtime auf allen Geräten). Werte:
   "none"  = offene Anmeldung (nur Name/Klasse)
   "code"  = Event-Code (Lehrer legt Code fest, steht am Beamer; keine Kontaktdaten) [EMPFOHLEN]
   "email" = 6-stelliger Code per E-Mail (Supabase Auth; braucht eigenen SMTP-Anbieter!)
   SMS:     E-Mail-Variante auf Telefon umstellen — in doRequestCode/doVerifyCode
            { phone } statt { email } und type:"sms" verwenden. Erfordert einen
            kostenpflichtigen SMS-Provider in Supabase (Twilio/MessageBird/Vonage).
   VERIFY_DEFAULT greift nur, solange in der DB (noch) nichts gesetzt ist. */
const VERIFY_DEFAULT = "code";

/* LEHRER-LOGIN
   Mit Supabase (Online): echtes Login per E-Mail + Passwort über Supabase Auth.
   Nur diese E-Mails dürfen das Turnier steuern (müssen 1:1 zur DB-Liste chess_admins
   passen — siehe sql/auth.sql). Authentifizierte Schüler (E-Mail-Code) sind NICHT
   automatisch Lehrer: die RLS prüft die E-Mail gegen diese Liste, nicht nur "eingeloggt".
   Ohne Supabase (Lokal-Modus zum Testen): Fallback auf das einfache Passwort ADMIN_PASS. */
const ADMIN_EMAILS = ["kra@htl1-klu.at", "oko@htl1-klu.at"];
const ADMIN_PASS   = "";   // nur Lokal-Modus (ohne Supabase) als simpler Test-Schutz

/* Pokalbilder (relativ zur HTML im Repo) oder Data-URI. Reihenfolge: 1., 2., 3. Platz.
   Fehlt eine Datei, wird eine gezeichnete Trophäe angezeigt.
   plateTopPct = vertikale Position der Gravur je Pokal (% von oben) zum Justieren.
   plateStyle  = "engrave" (Goldgravur auf dunklem Sockel) | "brass" (Messingschild). */
const TROPHY_CONFIG = {
  images:        ["assets/pokal-gold.jpg", "assets/pokal-silber.jpg", "assets/pokal-bronze.jpg"],
  plateTopPct:   [89, 89, 89],
  plateWidthPct: [45, 45, 45],
  plateLeftPct:  [56, 56, 56],     // horizontale Mitte der Plakette (%)
  plateRotateDeg:[-2.75, -2.45, -1.25],// Neigung passend zur gebackenen Schrift (Grad, negativ = gegen Uhrzeigersinn)
  plateStyle:    ["engrave", "engrave", "engrave"]
};
/* HTL1-LEGENDS-Wall (Banner ueber der Jahres-Doku) */
const LEGENDS_BOARD = "assets/legends.jpg";
const HTL1_LOGO = "assets/logo.png";
/* =============================================================== */

const _params  = new URLSearchParams(location.search);
const IS_ADMIN  = _params.has("admin");
let authUser   = null;   // Supabase-Session-User (Online-Modus)
let localAdmin = (()=>{ try{ return sessionStorage.getItem("htl1_admin")==="1"; }catch(e){ return false; } })();
function setLocalAdmin(v){ localAdmin=v; try{ if(v) sessionStorage.setItem("htl1_admin","1"); else sessionStorage.removeItem("htl1_admin"); }catch(e){} }
function isAdmin(){
  if(SB_MODE) return !!(authUser && ADMIN_EMAILS.map(e=>e.toLowerCase()).includes(((authUser.email)||"").toLowerCase()));
  return ADMIN_PASS ? localAdmin : true;   // lokal: Soft-Pass oder offen zum Testen
}
const IS_BEAMER = _params.has("beamer");
const SB_MODE  = !!(CONFIG.url && CONFIG.key && window.supabase);
const sb = SB_MODE ? window.supabase.createClient(CONFIG.url, CONFIG.key) : null;

/* ---- App-Status (im Speicher; bei Supabase aus DB geladen) ---- */
let state = {
  tournament_name: "Schachturnier",
  status: "registration",          // registration | running | finished
  num_rounds: 6,
  current_round: 0,
  time_control: "5+3",
  awarded: false,
  verify_mode: VERIFY_DEFAULT,      // Anmeldebestätigung: none | code | email (Admin-Panel)
  event_code: "",                  // Anmeldecode (Modus "code")
  champions: [],                   // aktuelle Pokal-Inhaber [{rank,name,klasse,tournament,date}]
  players: [],                     // {id,name,klasse,withdrawn,email,verified}
  pairings: [],                    // {id,round,board,white_id,black_id,result}
  halloffame: []                   // {tournament_name,event_date,rank,name,klasse}
};
let ui = { tab: "plan", viewRound: 0, beamerIdx: 0, regStep: "form", regDraft: {} };

/* Aktiver Anmeldemodus (aus DB-State, sonst Default) */
function VMODE(){ return state.verify_mode || VERIFY_DEFAULT; }
const MODE_INFO = {
  none:  { label:"Offen",  desc:"Schüler tippen nur Name + Klasse und sind sofort in der Liste. Keine Bestätigung, keine Kontaktdaten — am schnellsten." },
  code:  { label:"Code",   desc:"Du legst unten einen Code fest, der am Beamer steht. Nur wer den Code eintippt, kann sich anmelden. Keine Kontaktdaten, DSGVO-freundlich." },
  email: { label:"E-Mail", desc:"Schüler bekommen einen 6-stelligen Code an ihre Mail und bestätigen damit. Braucht Supabase + eigenen SMTP (siehe README)." }
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-"+Math.random().toString(36).slice(2)+Date.now());
const $ = sel => document.querySelector(sel);

/* ---- Inline-SVG-Icons (schlicht, einfarbig, erben Textfarbe) ---- */
const ICONS = {
  monitor:  '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
  table:    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v16"/>',
  lock:     '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  teacher:  '<path d="M12 4 2.5 8.5 12 13l9.5-4.5L12 4Z"/><path d="M6 10.5V16c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-5.5"/>',
  flask:    '<path d="M9 3.5h6M10 3.5v5.2L5.4 17a2 2 0 0 0 1.8 3h9.6a2 2 0 0 0 1.8-3L14 8.7V3.5"/><path d="M8 14.5h8"/>',
  import:   '<path d="M12 3.5v10M8 9.5l4 4 4-4"/><path d="M5 20.5h14"/>',
  play:     '<path d="M7.5 5.5v13l11-6.5-11-6.5Z"/>',
  shuffle:  '<path d="M16 3.5h4.5v4.5"/><path d="M4 20 20.5 3.5"/><path d="M16 20.5h4.5V16"/><path d="M14.5 14.5 20.5 20.5"/><path d="M4 4 9 9"/>',
  arrow:    '<path d="M4 12h15M13 5.5 19.5 12 13 18.5"/>',
  flag:     '<path d="M5.5 21V4M5.5 4.5h12l-2.2 4 2.2 4h-12"/>',
  clipboard:'<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3.2h6v1.3"/><path d="M8.5 10h7M8.5 14h7M8.5 17.5h4.5"/>',
  trophy:   '<path d="M6 4.5h12v4a6 6 0 0 1-12 0v-4Z"/><path d="M6 6.5H3.5V8a3 3 0 0 0 3 3M18 6.5h2.5V8a3 3 0 0 1-3 3"/><path d="M12 14.5v2.5M9.5 20.5 10 17h4l.5 3.5M8 20.5h8"/>',
  mail:     '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  gear:     '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9M18.7 18.7l-1.9-1.9M7.2 7.2 5.3 5.3"/>',
  check:    '<path d="M5 12.5 10 17.5 19.5 6.5"/>',
  checkCircle:'<circle cx="12" cy="12" r="8.5"/><path d="M8 12.2 11 15.2 16.2 8.8"/>',
  reset:    '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4.5V9h4.5"/>',
  trash:    '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  clock:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3.2 2"/>'
};
const ic = n => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">'+(ICONS[n]||'')+'</svg>';
/* Schach-Springer (gemeinfreies cburnett-Set), als schöner Umriss für leere Zustände */
const KNIGHT_SVG='<svg class="knight-ico" viewBox="0 0 45 45" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18"/><path d="M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.96,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 6,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.51 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.01 21,7 C 22,7 22,10 22,10"/><path d="M 9.5,25.5 A 0.5,0.5 0 1,1 8.5,25.5 A 0.5,0.5 0 1,1 9.5,25.5 z" fill="var(--card)" stroke="none"/><path d="M 15,15.5 A 0.5,1.5 0 1,1 14,15.5 A 0.5,1.5 0 1,1 15,15.5 z" transform="matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)" fill="var(--card)" stroke="none"/></svg>';

/* ============================ DATEN-SCHICHT ============================ */
async function loadAll(){
  if(!SB_MODE) return;
  const [st, pl, pr, hf] = await Promise.all([
    sb.from("chess_state").select("*").eq("id",1).single(),
    sb.from("chess_players").select("*").order("created_at",{ascending:true}),
    sb.from("chess_pairings").select("*").order("round",{ascending:true}).order("board",{ascending:true}),
    sb.from("chess_halloffame").select("*").order("event_date",{ascending:false}).order("rank",{ascending:true})
  ]);
  if(st.data){ Object.assign(state, st.data); }
  state.champions  = Array.isArray(state.champions) ? state.champions : [];
  state.players    = pl.data || [];
  state.pairings   = pr.data || [];
  state.halloffame = hf.data || [];
}
async function patchState(patch){
  Object.assign(state, patch);
  if(SB_MODE){ await sb.from("chess_state").update({...patch, updated_at:new Date().toISOString()}).eq("id",1); }
}
async function addPlayer(name, klasse, extra){
  extra = extra || {};
  const rec = { id:uuid(), name, klasse, withdrawn:false, email:extra.email||null, verified:!!extra.verified };
  if(SB_MODE){ const {data} = await sb.from("chess_players").insert({name,klasse,email:rec.email,verified:rec.verified}).select().single(); if(data) rec.id=data.id; }
  state.players.push(rec);
}
async function removePlayer(id){
  state.players = state.players.filter(p=>p.id!==id);
  if(SB_MODE){ await sb.from("chess_players").delete().eq("id",id); }
}
async function toggleWithdrawn(id, val){
  const p = state.players.find(x=>x.id===id); if(p) p.withdrawn=val;
  if(SB_MODE){ await sb.from("chess_players").update({withdrawn:val}).eq("id",id); }
}
async function insertPairings(arr){
  arr.forEach(p=>{ if(!p.id) p.id=uuid(); });
  state.pairings.push(...arr);
  if(SB_MODE){
    const rows = arr.map(({id,round,board,white_id,black_id,result})=>({round,board,white_id,black_id,result}));
    const {data} = await sb.from("chess_pairings").insert(rows).select();
    if(data){ /* IDs werden beim nächsten Reload sauber gezogen */ }
  }
}
async function setResult(id, result){
  const p = state.pairings.find(x=>x.id===id); if(p) p.result=result;
  if(SB_MODE){ await sb.from("chess_pairings").update({result}).eq("id",id); }
}
async function resetAll(){
  // champions + halloffame bleiben bewusst erhalten (Pokale + Wall of Fame)
  state.players=[]; state.pairings=[];
  await patchState({status:"registration", current_round:0, awarded:false});
  if(SB_MODE){
    await sb.from("chess_pairings").delete().neq("round",-1);
    await sb.from("chess_players").delete().neq("name","\u0000");
  }
}
async function awardTrophies(){
  const top = computeStandings().filter(s=>!s.withdrawn).slice(0,3);
  if(top.length===0){ toast("Keine Platzierungen vorhanden"); return; }

  // 1) bisherige Pokal-Inhaber wandern in die Wall of Fame
  const archive = (state.champions||[]).map(c=>({
    tournament_name: c.tournament, event_date: c.date, rank: c.rank, name: c.name, klasse: c.klasse
  }));
  if(archive.length){
    state.halloffame = [...archive, ...state.halloffame];
    if(SB_MODE){ await sb.from("chess_halloffame").insert(archive); }
  }

  // 2) neue Top 3 werden auf die Pokale graviert
  const today = new Date().toISOString().slice(0,10);
  const champs = top.map((s,i)=>({ rank:i+1, name:s.name, klasse:s.klasse||"", tournament:state.tournament_name, date:today }));
  await patchState({ champions: champs, awarded: true });
  render(); toast("Pokale graviert ✓");
}
/* Aktuelle Gravur (Titelverteidiger) von den Pokalen entfernen — z.B. nach einem Test. */
async function clearTrophies(){
  if(!(state.champions||[]).length){ toast("Keine Gravur vorhanden"); return; }
  if(!confirm("Aktuelle Gravur (Titelverteidiger) von den Pokalen löschen?\n(Die Wall of Fame bleibt unberührt.)")) return;
  await patchState({ champions: [], awarded: false });
  render(); toast("Gravur gelöscht");
}
/* Komplette Wall of Fame leeren — nur zum Aufräumen von Testdaten. */
async function clearHallOfFame(){
  if(!(state.halloffame||[]).length){ toast("Wall of Fame ist leer"); return; }
  if(!confirm("Wirklich die GESAMTE Wall of Fame löschen? Das kann nicht rückgängig gemacht werden.")) return;
  state.halloffame = [];
  if(SB_MODE){ await sb.from("chess_halloffame").delete().neq("rank",-1); }
  render(); toast("Wall of Fame geleert");
}

/* ============================ SCHWEIZER SYSTEM ============================ */
function playerStats(){
  const st={};
  state.players.forEach(p=> st[p.id]={opponents:[],whites:0,blacks:0,byes:0,lastColor:null,lastRound:0});
  state.pairings.forEach(pr=>{
    if(pr.black_id===null||pr.black_id===undefined){ if(st[pr.white_id]) st[pr.white_id].byes++; return; }
    const w=st[pr.white_id], b=st[pr.black_id];
    if(w){ w.whites++; w.opponents.push(pr.black_id); if(pr.round>=w.lastRound){w.lastRound=pr.round; w.lastColor="w";} }
    if(b){ b.blacks++; b.opponents.push(pr.white_id); if(pr.round>=b.lastRound){b.lastRound=pr.round; b.lastColor="b";} }
  });
  return st;
}
function computeStandings(){
  const pts={}, played={}, opp={};
  state.players.forEach(p=>{ pts[p.id]=0; played[p.id]=0; opp[p.id]=[]; });
  state.pairings.forEach(pr=>{
    if(!pr.result) return;
    if(pr.result==="bye"){ pts[pr.white_id]=(pts[pr.white_id]||0)+1; return; }
    played[pr.white_id]++; played[pr.black_id]++;
    opp[pr.white_id].push(pr.black_id); opp[pr.black_id].push(pr.white_id);
    if(pr.result==="1-0") pts[pr.white_id]+=1;
    else if(pr.result==="0-1") pts[pr.black_id]+=1;
    else if(pr.result==="draw"){ pts[pr.white_id]+=0.5; pts[pr.black_id]+=0.5; }
  });
  const buch={};
  state.players.forEach(p=>{ buch[p.id]=opp[p.id].reduce((s,o)=>s+(pts[o]||0),0); });
  return state.players.map(p=>({
    id:p.id, name:p.name, klasse:p.klasse, withdrawn:p.withdrawn,
    points:pts[p.id], buch:buch[p.id], played:played[p.id]
  })).sort((a,b)=> (b.points-a.points) || (b.buch-a.buch) || a.name.localeCompare(b.name,"de"));
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ---------- EXCEL-EXPORT (SheetJS) ---------- */
function exportExcel(){
  if(typeof XLSX==="undefined"){ toast("Excel-Bibliothek lädt noch – kurz warten"); return; }
  const wb=XLSX.utils.book_new();

  const st=computeStandings();
  const tab=[["#","Name","Klasse","Punkte","Buchholz","Partien"]];
  st.forEach((s,i)=>tab.push([i+1,s.name,s.klasse||"",s.points,s.buch,s.played]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tab), "Tabelle");

  const tn=[["Name","Klasse","Status","Bestätigt"]];
  state.players.forEach(p=>tn.push([p.name,p.klasse||"",p.withdrawn?"zurückgezogen":"aktiv",p.verified?"ja":""]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tn), "Teilnehmer");

  const pr=[["Runde","Brett","Weiß","Schwarz","Ergebnis"]];
  [...state.pairings].sort((a,b)=>(a.round-b.round)||(a.board-b.board)).forEach(p=>{
    const r = (p.black_id==null) ? "Freilos (1)"
            : p.result==="1-0" ? "1:0" : p.result==="0-1" ? "0:1" : p.result==="draw" ? "½:½" : "offen";
    pr.push([p.round, p.board, nm(p.white_id), p.black_id==null?"—":nm(p.black_id), r]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pr), "Paarungen");

  if(state.halloffame && state.halloffame.length){
    const hf=[["Datum","Turnier","Platz","Name","Klasse"]];
    state.halloffame.forEach(h=>hf.push([h.event_date||"", h.tournament_name||"", h.rank, h.name, h.klasse||""]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(hf), "Ruhmeshalle");
  }

  const safe=(state.tournament_name||"Schachturnier").replace(/[^\w\-]+/g,"_");
  const date=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `${safe}_${date}.xlsx`);
  toast("Excel exportiert ✓");
}

/* gemeinsame Buttons für jede Admin-Leiste */
function adminCommonBtns(){
  return `<button class="btn ghost sm" id="btnXlsx">${ic('table')} Excel</button>`
       + ((SB_MODE || ADMIN_PASS) ? `<button class="btn ghost sm" id="btnLogout">${ic('lock')} Abmelden</button>` : "");
}
function wireAdminCommon(){
  const x=$("#btnXlsx"); if(x) x.onclick=exportExcel;
  const o=$("#btnLogout"); if(o) o.onclick=async()=>{
    if(SB_MODE){ try{ await sb.auth.signOut(); }catch(e){} authUser=null; }
    else { setLocalAdmin(false); }
    toast("Abgemeldet"); render();
  };
}

function assignColors(p,q,st){
  const bp=st[p.id].whites-st[p.id].blacks, bq=st[q.id].whites-st[q.id].blacks;
  if(bp<bq) return [p,q];
  if(bq<bp) return [q,p];
  if(st[p.id].lastColor==="b" && st[q.id].lastColor!=="b") return [p,q];
  if(st[q.id].lastColor==="b" && st[p.id].lastColor!=="b") return [q,p];
  return [p,q];
}
function greedyPair(pool, st, round){
  const used=new Set(), out=[]; let board=1, rematches=0, colorPen=0;
  for(let i=0;i<pool.length;i++){
    const p=pool[i]; if(used.has(p.id)) continue;
    let k=-1;
    for(let j=i+1;j<pool.length;j++){ const q=pool[j];
      if(used.has(q.id)) continue;
      if(st[p.id].opponents.includes(q.id)) continue;
      k=j; break; }
    if(k===-1){ for(let j=i+1;j<pool.length;j++){ if(!used.has(pool[j].id)){k=j;rematches++;break;} } } // Notfall: Revanche
    if(k===-1) continue;
    const q=pool[k]; used.add(p.id); used.add(q.id);
    const [w,b]=assignColors(p,q,st);
    if(Math.abs((st[w.id].whites-st[w.id].blacks)+1)>2 || Math.abs((st[b.id].whites-st[b.id].blacks)-1)>2) colorPen++;
    out.push({round,board:board++,white_id:w.id,black_id:b.id,result:null});
  }
  return {out, rematches, colorPen};
}
function makePairings(round){
  const active = state.players.filter(p=>!p.withdrawn);
  const st = playerStats();
  let base;
  if(round===1){ base=[...active]; }
  else{
    const standings = computeStandings().filter(s=>!s.withdrawn);
    const rank={}; standings.forEach((s,i)=>rank[s.id]=i);
    base=[...active].sort((a,b)=>rank[a.id]-rank[b.id]);
  }
  const pointsOf={}; (round===1?[]:computeStandings()).forEach(s=>pointsOf[s.id]=s.points);

  // Freilos: niedrigstplatzierter Spieler ohne bisheriges Freilos
  let bye=null, pool=[...base];
  if(pool.length%2===1){
    for(let i=pool.length-1;i>=0;i--){ if(st[pool[i].id].byes===0){ bye=pool[i]; break; } }
    if(!bye) bye=pool[pool.length-1];
    pool=pool.filter(p=>p.id!==bye.id);
  }

  // Mehrere Auslosungen probieren, beste behalten (wenige/keine Revanchen, gute Farben)
  let best=null;
  for(let attempt=0; attempt<60; attempt++){
    let order;
    if(round===1){ order=shuffle([...pool]); }
    else{
      order=[...pool]; let i=0;
      while(i<order.length){
        let j=i; while(j<order.length && pointsOf[order[j].id]===pointsOf[order[i].id]) j++;
        const seg=shuffle(order.slice(i,j)); for(let k=i;k<j;k++) order[k]=seg[k-i];
        i=j;
      }
    }
    const res=greedyPair(order, st, round);
    const score=res.rematches*100 + res.colorPen;
    if(!best || score<best.score){ best={...res, score}; if(score===0) break; }
  }
  const out=best.out;
  if(bye) out.push({round,board:out.length+1,white_id:bye.id,black_id:null,result:"bye"});
  return out;
}

/* ============================ AKTIONEN ============================ */
async function doRegister(name, klasse, extra){
  name=(name||"").trim(); klasse=(klasse||"").trim();
  if(name.length<2){ toast("Bitte Namen eingeben"); return false; }
  if(state.players.some(p=>p.name.toLowerCase()===name.toLowerCase() && (p.klasse||"").toLowerCase()===klasse.toLowerCase())){
    toast("Schon angemeldet"); return false;
  }
  await addPlayer(name, klasse, extra); render(); toast("Angemeldet ✓"); return true;
}
/* OTP per E-Mail (für SMS: { phone } statt { email } und type:"sms") */
async function doRequestCode(email){
  if(!SB_MODE){ toast("E-Mail-Bestätigung braucht Supabase"); return false; }
  try{
    const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:true } });
    if(error) throw error;
    return true;
  }catch(e){ console.error(e); toast("E-Mail konnte nicht gesendet werden"); return false; }
}
async function doVerifyCode(email, token){
  try{
    const { error } = await sb.auth.verifyOtp({ email, token, type:"email" });
    if(error) throw error;
    sb.auth.signOut().catch(()=>{}); // Session nicht behalten
    return true;
  }catch(e){ console.error(e); toast("Code falsch oder abgelaufen"); return false; }
}
async function startTournament(){
  const active=state.players.filter(p=>!p.withdrawn);
  if(active.length<2){ toast("Mindestens 2 Teilnehmer nötig"); return; }
  const pairings=makePairings(1);
  await insertPairings(pairings);
  await patchState({status:"running", current_round:1, awarded:false});
  ui.viewRound=1; render(); toast("Runde 1 ausgelost ✓");
}
async function nextRound(){
  if(state.current_round>=state.num_rounds){ await patchState({status:"finished"}); render(); return; }
  const r=state.current_round+1;
  const pairings=makePairings(r);
  if(pairings.length===0){ toast("Keine Paarung möglich"); return; }
  await insertPairings(pairings);
  await patchState({current_round:r});
  ui.viewRound=r; render(); toast("Runde "+r+" ausgelost ✓");
}
async function finishTournament(){ await patchState({status:"finished"}); render(); }
async function regeneratePairings(round){
  // nur erlaubt, solange keine Ergebnisse dieser Runde eingetragen sind
  state.pairings = state.pairings.filter(p=>p.round!==round);
  if(SB_MODE){ await sb.from("chess_pairings").delete().eq("round",round); }
  const fresh=makePairings(round);
  await insertPairings(fresh); render(); toast("Runde "+round+" neu ausgelost");
}

/* ============================ RENDER ============================ */
function nm(id){ const p=state.players.find(x=>x.id===id); return p?p.name:"?"; }
function kl(id){ const p=state.players.find(x=>x.id===id); return p?(p.klasse||""):""; }

/* Bedenkzeit "Grund+Inkrement" parsen, z.B. "5+3" -> {base:5, inc:3} (Minuten / Sekunden) */
function parseTC(tc){
  const m=String(tc||"").match(/(\d+)\s*\+\s*(\d+)/);
  if(m) return { base:+m[1], inc:+m[2] };
  const b=parseInt(tc,10); return { base:isNaN(b)?5:b, inc:0 };
}
function fmtDur(min){
  min=Math.max(0,Math.round(min));
  const h=Math.floor(min/60), m=min%60;
  return h ? (m? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
/* Grobe Dauer-Schätzung (reine Spielzeit): Partien laufen parallel, also zählt
   Runden × Rundenlänge. In der Praxis dauert eine Runde etwa eine Grundbedenkzeit
   pro Spieler — die meisten Partien sind vor Ablauf der vollen Uhr entschieden. */
function forecast(){
  const n=state.players.filter(p=>!p.withdrawn).length;
  const rounds=state.num_rounds||0;
  const { base, inc }=parseTC(state.time_control);
  const games=Math.floor(n/2);
  const perSide = base + inc*40/60;     // effektive Bedenkzeit/Spieler über ~40 Züge (Min)
  const lo = rounds * perSide * 0.7;    // viele Partien enden früh
  const hi = rounds * perSide;          // Runde ~ volle Grundbedenkzeit (z.B. 6×15 = 1:30)
  const recRounds=Math.max(3, Math.ceil(Math.log2(Math.max(2,n))));
  return { n, rounds, games, lo, hi, recRounds };
}

let _painted=false;
function render(){
  // Einblend-Animation nur beim allerersten Aufbau — sonst flackert jeder Re-Render
  document.body.classList.toggle("no-anim", _painted); _painted=true;
  if(IS_BEAMER){ document.body.classList.add("beamer-body"); renderBeamer(); return; }
  $("#tName").textContent = state.tournament_name || "Schachturnier";
  document.title = (state.tournament_name||"Schachturnier")+" · HTL1";
  renderStatusChip();
  renderBanner();
  const app=$("#app"); app.innerHTML="";
  if(IS_ADMIN && !isAdmin()){ renderAdminLogin(app); return; }
  if(state.status==="registration") renderRegistration(app);
  else if(state.status==="running")  renderRunning(app);
  else                               renderFinished(app);
}
function renderAdminLogin(app){
  const c=document.createElement("div"); c.className="card lg";
  if(SB_MODE){
    c.innerHTML=`
      <div class="eyebrow">${ic('lock')} Lehrer-Bereich</div>
      <h2>Anmeldung</h2>
      <p class="lead">Mit Lehrer-E-Mail und Passwort anmelden.</p>
      <div class="field"><label>E-Mail</label><input id="admEmail" type="email" autocomplete="username" placeholder="name@htl1-klu.at"></div>
      <div class="field"><label>Passwort</label><input id="admPass" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <button class="btn block" id="admGo">Anmelden</button>`;
    app.appendChild(c);
    const go=async()=>{
      const email=($("#admEmail").value||"").trim(), pw=$("#admPass").value||"";
      if(!email||!pw){ toast("E-Mail und Passwort eingeben"); return; }
      $("#admGo").disabled=true;
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      $("#admGo").disabled=false;
      if(error){ toast("Anmeldung fehlgeschlagen"); $("#admPass").value=""; return; }
      authUser = (data && (data.user || (data.session&&data.session.user))) || null;
      if(!isAdmin()){ toast("Dieses Konto ist kein Lehrer-Konto"); await sb.auth.signOut(); authUser=null; render(); return; }
      toast("Willkommen ✓"); render();
    };
    $("#admGo").onclick=go;
    $("#admPass").onkeydown=e=>{ if(e.key==="Enter") go(); };
    setTimeout(()=>{ const i=$("#admEmail"); if(i) i.focus(); },50);
  } else {
    c.innerHTML=`
      <div class="eyebrow">${ic('lock')} Lehrer-Bereich (Lokal-Modus)</div>
      <h2>Anmeldung</h2>
      <p class="lead">Bitte das Test-Passwort eingeben.</p>
      <div class="field"><label>Passwort</label><input id="admPass" type="password" autocomplete="current-password" placeholder="••••••••"></div>
      <button class="btn block" id="admGo">Anmelden</button>`;
    app.appendChild(c);
    const go=()=>{
      if(($("#admPass").value||"")===ADMIN_PASS){ setLocalAdmin(true); toast("Willkommen ✓"); render(); }
      else { toast("Falsches Passwort"); $("#admPass").value=""; $("#admPass").focus(); }
    };
    $("#admGo").onclick=go;
    $("#admPass").onkeydown=e=>{ if(e.key==="Enter") go(); };
    setTimeout(()=>{ const i=$("#admPass"); if(i) i.focus(); },50);
  }
  renderHall(app);
}
function renderStatusChip(){
  const c=$("#statuschip");
  if(state.status==="registration"){ c.className="statuschip chip-reg"; c.textContent="Anmeldung offen"; }
  else if(state.status==="running"){ c.className="statuschip chip-run chip-live"; c.textContent="Runde "+state.current_round+" / "+state.num_rounds; }
  else{ c.className="statuschip chip-fin"; c.textContent="Beendet"; }
}
function renderBanner(){
  const b=$("#banner"); b.innerHTML="";
  if(!SB_MODE){
    b.innerHTML='<div class="banner">'+ic('gear')+' <b>Lokal-Modus</b> (kein Supabase) — nur dieses Gerät, kein Live-Sync. Zum Testen perfekt; fürs Event Supabase im CONFIG-Block eintragen.</div>';
  }
}

/* ---------- ANMELDUNG ---------- */
function renderRegistration(app){
  const active=state.players.filter(p=>!p.withdrawn);

  if(IS_ADMIN){
    const fc=forecast();
    const ab=document.createElement("div"); ab.className="adminbar";
    ab.innerHTML=`
      <div class="ab-top">${ic('teacher')}Lehrer-Steuerung <span class="lk">Auslosung startet Runde 1</span></div>
      <div class="row" style="margin-bottom:10px">
        <div class="field" style="margin:0"><label>Turniername</label><input id="cfgName" value="${esc(state.tournament_name)}"></div>
        <div class="field" style="margin:0;max-width:120px"><label>Runden</label>
          <select id="cfgRounds">${[4,5,6,7,8,9].map(n=>`<option ${n==state.num_rounds?"selected":""}>${n}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;max-width:140px"><label>Bedenkzeit</label>
          <select id="cfgTime">${["3+2","5+0","5+3","10+0","10+5","15+0"].map(t=>`<option ${t==state.time_control?"selected":""}>${t}</option>`).join("")}</select></div>
      </div>
      <div class="forecast">${ic('clock')}<span>Geschätzte Dauer: <b>${fc.n<2?"—":`ca. ${fmtDur(fc.lo)} – ${fmtDur(fc.hi)}`}</b></span>
        <span class="fc-sub">${fc.rounds} Runden · ${fc.games} Bretter · ${fc.n} Spieler${fc.n>=2&&fc.rounds<fc.recRounds?` · Tipp: ${fc.recRounds} Runden für ${fc.n} Spieler`:""}</span></div>
      <div class="modepick">
        <div class="mp-head"><span class="mp-label">Anmeldung</span>
          <div class="mp-opts">${["none","code","email"].map(m=>`<button class="mp${VMODE()===m?" on":""}" data-m="${m}" title="${esc(MODE_INFO[m].desc)}">${esc(MODE_INFO[m].label)}</button>`).join("")}</div>
        </div>
        <div class="mp-desc">${esc(MODE_INFO[VMODE()].desc)}</div>
      </div>
      ${VMODE()==="code"?`<div class="codebox">
        <div class="field" style="margin:0;max-width:160px"><label>Anmeldecode</label>
          <input id="cfgCode" value="${esc(state.event_code||"")}" placeholder="leer = gesperrt" maxlength="12" autocomplete="off"></div>
        <button class="btn ghost sm" id="btnGenCode">${ic('shuffle')} Code</button>
        <span class="code-hint">Code am Beamer zeigen — nur damit kann man sich anmelden. Leer = Anmeldung gesperrt.</span>
      </div>`:""}
      <div class="ab-actions">
        <button class="btn" id="btnStart" ${active.length<2?"disabled":""}>${ic('shuffle')} Anmeldung schließen & auslosen</button>
        <a class="btn ghost sm" href="${esc(location.origin+location.pathname+"?beamer")}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
        ${adminCommonBtns()}
      </div>
      <div class="ab-actions" style="margin-top:8px;border-top:1px dashed rgba(255,255,255,.12);padding-top:10px">
        <span class="code-hint" style="width:100%">${ic('flask')} Zum Testen vor dem Event:</span>
        <button class="btn ghost sm" id="btnDemo" title="20 Beispiel-Teilnehmer zum Ausprobieren hinzufügen.">+20 Testdaten</button>
        <button class="btn ghost sm" id="btnImport" title="Teilnehmer aus Excel/CSV laden. Erste Zeile als Überschrift, Spalten 'Name' und 'Klasse'. Duplikate werden übersprungen.">${ic('import')} Import Excel/CSV</button>
        <button class="btn ghost sm" id="btnSim" title="Spielt ein komplettes Turnier mit Zufallsergebnissen durch — testet Auslosung, Tabelle und Pokale.">${ic('play')} Testlauf simulieren</button>
        ${(state.champions||[]).length?`<button class="btn ghost sm" id="btnClearCup" title="Test-Gravur von den Pokalen entfernen (Wall of Fame bleibt).">${ic('trash')} Gravur löschen</button>`:""}
        ${(state.halloffame||[]).length?`<button class="btn ghost sm" id="btnClearWall" title="Gesamte Wall of Fame löschen — nur zum Aufräumen von Testdaten.">${ic('trash')} Wall of Fame leeren</button>`:""}
        <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="display:none">
      </div>`;
    app.appendChild(ab);
    $("#cfgName").onchange=e=>patchState({tournament_name:e.target.value||"Schachturnier"}).then(render);
    $("#cfgRounds").onchange=e=>patchState({num_rounds:+e.target.value}).then(render);
    $("#cfgTime").onchange=e=>patchState({time_control:e.target.value}).then(render);
    ab.querySelectorAll(".mp").forEach(b=>b.onclick=()=>{
      const m=b.dataset.m;
      if(m===VMODE()) return;
      if(m==="email" && !SB_MODE){ toast("E-Mail-Modus braucht Supabase"); return; }
      patchState({verify_mode:m}).then(render);
    });
    $("#btnStart").onclick=startTournament;
    const demo=$("#btnDemo"); if(demo) demo.onclick=addDemo;
    const imp=$("#btnImport"); if(imp) imp.onclick=()=>{ const f=$("#impFile"); if(f) f.click(); };
    const impF=$("#impFile"); if(impF) impF.onchange=e=>handleImportFile(e.target.files[0]);
    const sim=$("#btnSim"); if(sim) sim.onclick=simulateTournament;
    const clr=$("#btnClearCup"); if(clr) clr.onclick=()=>clearTrophies().then(()=>render());
    const clw=$("#btnClearWall"); if(clw) clw.onclick=()=>clearHallOfFame().then(()=>render());
    const cc=$("#cfgCode"); if(cc) cc.onchange=e=>patchState({event_code:e.target.value.trim()}).then(render);
    const gc=$("#btnGenCode"); if(gc) gc.onclick=()=>{ patchState({event_code:String(Math.floor(1000+Math.random()*9000))}).then(render); };
    wireAdminCommon();
  }

  // Anmeldeformular (alle) — abhängig vom Bestätigungsmodus
  const f=document.createElement("div"); f.className="card lg";
  const codeGate = (VMODE()==="code" && !(state.event_code||"").trim());

  if(VMODE()==="email" && !SB_MODE){
    f.innerHTML=`<div class="eyebrow">Anmeldung</div><h2>E-Mail-Bestätigung nicht verfügbar</h2>
      <p class="lead">Der E-Mail-Modus braucht Supabase. Im Lokal-Modus bitte im Admin-Panel auf <b>Offen</b> oder <b>Code</b> stellen.</p>`;
    app.appendChild(f);
  } else if(codeGate){
    f.innerHTML=`<div class="eyebrow">Anmeldung</div><h2>Noch nicht freigeschaltet</h2>
      <p class="lead">Die Anmeldung wird gleich von der Lehrkraft freigeschaltet — der Code erscheint dann am Beamer.</p>`;
    app.appendChild(f);
  } else if(VMODE()==="email" && ui.regStep==="code"){
    const d=ui.regDraft||{};
    f.innerHTML=`<div class="eyebrow">Bestätigung</div><h2>Code eingeben</h2>
      <p class="lead">6-stelliger Code wurde an <b>${esc(d.email||"")}</b> geschickt. Bitte hier eintragen.</p>
      <div class="field"><label>Bestätigungscode</label><input id="regOtp" inputmode="numeric" maxlength="8" placeholder="z.B. 123456" autocomplete="one-time-code"></div>
      <button class="btn block" id="btnVerify">${ic('check')} Bestätigen & anmelden</button>
      <button class="btn ghost block sm" id="btnBack" style="margin-top:8px">← Zurück / andere E-Mail</button>`;
    app.appendChild(f);
    const verify=async()=>{
      const token=($("#regOtp").value||"").trim();
      if(token.length<4){ toast("Code eingeben"); return; }
      if(await doVerifyCode(d.email, token)){
        ui.regStep="form"; ui.regDraft={};
        await doRegister(d.name, d.klasse, {email:d.email, verified:true});
      }
    };
    $("#btnVerify").onclick=verify;
    $("#regOtp").onkeydown=e=>{ if(e.key==="Enter") verify(); };
    $("#btnBack").onclick=()=>{ ui.regStep="form"; render(); };
  } else {
    const needEmail=(VMODE()==="email"), needCode=(VMODE()==="code");
    f.innerHTML=`
      <div class="eyebrow">Jetzt mitmachen</div>
      <h2>Zum Turnier anmelden</h2>
      <p class="lead">${needEmail?"Du bekommst einen Bestätigungscode per E-Mail.":needCode?"Gib den Code vom Beamer ein, um dich anzumelden.":"Trag deinen Namen ein — du erscheinst sofort in der Liste."}</p>
      <div class="row">
        <div class="field" style="flex:2"><label>Name</label><input id="regName" placeholder="Vor- und Nachname" autocomplete="off"></div>
        <div class="field" style="flex:1"><label>Klasse</label><input id="regKlasse" placeholder="z.B. 2AHET" autocomplete="off"></div>
      </div>
      ${needEmail?`<div class="field"><label>E-Mail</label><input id="regEmail" type="email" placeholder="name@schule.at" autocomplete="email"></div>`:""}
      ${needCode?`<div class="field"><label>Anmeldecode (vom Beamer)</label><input id="regCode" inputmode="numeric" maxlength="12" placeholder="Code" autocomplete="off"></div>`:""}
      <button class="btn block" id="btnReg">${needEmail?ic('mail')+" Code anfordern":ic('check')+" Anmelden"}</button>`;
    app.appendChild(f);
    const submit=async()=>{
      const name=$("#regName").value, klasse=$("#regKlasse").value;
      if((name||"").trim().length<2){ toast("Bitte Namen eingeben"); return; }
      if(needCode){
        const code=($("#regCode").value||"").trim();
        if(code.toLowerCase()!==(state.event_code||"").trim().toLowerCase()){ toast("Falscher Anmeldecode"); return; }
      }
      if(needEmail){
        const email=($("#regEmail").value||"").trim();
        if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ toast("Gültige E-Mail eingeben"); return; }
        if(await doRequestCode(email)){ ui.regDraft={name:name.trim(),klasse:(klasse||"").trim(),email}; ui.regStep="code"; render(); toast("Code gesendet ✓"); }
        return;
      }
      if(await doRegister(name, klasse)){ $("#regName").value="";$("#regKlasse").value=""; if($("#regCode"))$("#regCode").value=""; $("#regName").focus(); }
    };
    $("#btnReg").onclick=submit;
    const lastField = needCode?$("#regCode"):$("#regKlasse");
    if(lastField) lastField.onkeydown=e=>{ if(e.key==="Enter") submit(); };
  }

  // Teilnehmerliste
  const l=document.createElement("div"); l.className="card";
  const list = [...state.players].sort((a,b)=>a.name.localeCompare(b.name,"de"));
  l.innerHTML=`
    <div class="count-badge"><b>${active.length}</b><span>angemeldet${state.players.length!==active.length?` · ${state.players.length-active.length} abgemeldet`:""}</span></div>
    <div class="players" id="plist"></div>
    ${list.length===0?'<div class="empty"><div class="ico">'+KNIGHT_SVG+'</div>Noch niemand angemeldet — sei die/der Erste!</div>':""}`;
  app.appendChild(l);
  const pl=$("#plist");
  list.forEach((p,i)=>{
    const d=document.createElement("div"); d.className="pl"+(p.withdrawn?" out":"");
    d.innerHTML=`<span class="idx">${i+1}</span><span class="nm">${esc(p.name)}</span>${p.verified?'<span class="vchk" title="bestätigt">✓</span>':""}${p.klasse?`<span class="kl">${esc(p.klasse)}</span>`:""}`;
    if(IS_ADMIN){ const x=document.createElement("button"); x.className="x"; x.textContent="×"; x.title="Entfernen"; x.onclick=()=>{ removePlayer(p.id).then(render); }; d.appendChild(x); }
    pl.appendChild(d);
  });

  if(IS_ADMIN && SB_MODE) renderQR(app);

  // Pokale + Wall of Fame (zwischen den Events die "Homepage")
  renderHall(app);
}

/* Sicherheits-Reset: Rückfrage, dann alles löschen (Pokale + Wall of Fame bleiben). */
function confirmReset(extraWarn){
  const msg=(extraWarn?extraWarn+"\n\n":"")+"Neues Turnier starten?\nTeilnehmer & Spielplan werden gelöscht (Pokale und Wall of Fame bleiben).";
  if(confirm(msg)){ resetAll().then(()=>{ ui.tab="plan"; ui.viewRound=0; render(); }); }
}

/* ---------- TURNIER LÄUFT ---------- */
function renderRunning(app){
  if(IS_ADMIN) renderAdminBarRunning(app);

  const tabs=document.createElement("div"); tabs.className="tabs";
  tabs.innerHTML=`
    <button class="${ui.tab==="plan"?"on":""}" data-t="plan">${ic('clipboard')} Spielplan</button>
    <button class="${ui.tab==="table"?"on":""}" data-t="table">${ic('table')} Tabelle</button>
    <button class="${ui.tab==="hall"?"on":""}" data-t="hall">${ic('trophy')} Pokale</button>`;
  app.appendChild(tabs);
  tabs.querySelectorAll("button").forEach(b=>b.onclick=()=>{ ui.tab=b.dataset.t; render(); });

  if(ui.tab==="plan") renderPlan(app);
  else if(ui.tab==="hall") renderHall(app);
  else renderTable(app, false);
}
function renderAdminBarRunning(app){
  const cur=state.current_round;
  const curP=state.pairings.filter(p=>p.round===cur);
  const allDone=curP.length>0 && curP.every(p=>p.result);
  const noResultsYet=curP.every(p=>!p.result);
  const last=cur>=state.num_rounds;
  const ab=document.createElement("div"); ab.className="adminbar";
  ab.innerHTML=`
    <div class="ab-top">${ic('teacher')}Lehrer-Steuerung <span class="lk">Runde ${cur}/${state.num_rounds} · ${esc(state.time_control)}</span></div>
    <div class="ab-actions">
      ${last
        ? `<button class="btn" id="btnFin" ${allDone?"":"disabled"}>${ic('flag')} Turnier beenden${allDone?"":" (Ergebnisse fehlen)"}</button>`
        : `<button class="btn" id="btnNext" ${allDone?"":"disabled"}>${ic('arrow')} Runde ${cur+1} auslosen${allDone?"":" (Ergebnisse fehlen)"}</button>`}
      ${noResultsYet?`<button class="btn ghost sm" id="btnRe">${ic('shuffle')} Runde ${cur} neu auslosen</button>`:""}
      <a class="btn ghost sm" href="${esc(location.origin+location.pathname+"?beamer")}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
      ${adminCommonBtns()}
      <button class="btn danger sm" id="btnReset" title="Laufendes Turnier abbrechen und von vorne beginnen.">${ic('reset')} Turnier neu starten</button>
    </div>`;
  app.appendChild(ab);
  if($("#btnNext")) $("#btnNext").onclick=nextRound;
  if($("#btnFin"))  $("#btnFin").onclick=finishTournament;
  if($("#btnRe"))   $("#btnRe").onclick=()=>regeneratePairings(cur);
  if($("#btnReset"))$("#btnReset").onclick=()=>confirmReset("Das laufende Turnier wird ABGEBROCHEN.");
  wireAdminCommon();
}
function renderPlan(app){
  if(!ui.viewRound || ui.viewRound>state.current_round) ui.viewRound=state.current_round;
  const card=document.createElement("div"); card.className="card";
  let html=`<div class="roundpick"><span class="eyebrow" style="margin:0">Runde anzeigen</span>
    <select id="rsel">${Array.from({length:state.current_round},(_,i)=>i+1).map(r=>`<option value="${r}" ${r===ui.viewRound?"selected":""}>Runde ${r}</option>`).join("")}</select></div>`;
  card.innerHTML=html;
  app.appendChild(card);
  $("#rsel").onchange=e=>{ ui.viewRound=+e.target.value; render(); };

  const prs=state.pairings.filter(p=>p.round===ui.viewRound).sort((a,b)=>a.board-b.board);
  prs.forEach(p=>{
    const el=document.createElement("div"); el.className="pair";
    if(p.black_id===null||p.black_id===undefined){
      el.classList.add("byecard");
      el.innerHTML=`<span class="bno">–</span><div class="side"><div class="nm">${esc(nm(p.white_id))}</div><div class="kl">${esc(kl(p.white_id))}</div></div><span class="byetag">Freilos · 1 Punkt</span>`;
      card.appendChild(el); return;
    }
    const res=p.result;
    el.innerHTML=`
      <span class="bno">${p.board}</span>
      <div class="side"><div class="nm">${esc(nm(p.white_id))}</div><div class="kl">${esc(kl(p.white_id))}</div></div>
      <span class="dot w" title="Weiß"></span>
      <span class="vs">vs</span>
      <span class="dot b" title="Schwarz"></span>
      <div class="side right"><div class="nm">${esc(nm(p.black_id))}</div><div class="kl">${esc(kl(p.black_id))}</div></div>`;
    if(IS_ADMIN){
      const rc=document.createElement("div"); rc.className="res";
      [["1-0","1:0"],["draw","½"],["0-1","0:1"]].forEach(([v,lbl])=>{
        const b=document.createElement("button"); b.textContent=lbl; if(res===v) b.classList.add("on");
        b.onclick=()=>{ setResult(p.id, res===v?null:v).then(render); };
        rc.appendChild(b);
      });
      el.appendChild(rc);
    }else{
      const rv=document.createElement("div");
      rv.className="resview"+(res?"":" pending");
      rv.textContent = res==="1-0"?"1 : 0" : res==="0-1"?"0 : 1" : res==="draw"?"½ : ½" : "läuft";
      el.appendChild(rv);
    }
    card.appendChild(el);
  });
}

/* ---------- TABELLE ---------- */
function renderTable(app, finalMode){
  const st=computeStandings();
  const card=document.createElement("div"); card.className="card";
  card.innerHTML=`<h2 style="margin-bottom:14px">${finalMode?"Endstand":"Zwischenstand"}</h2>
    <table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Kl.</th><th style="text-align:right">Pkt</th><th style="text-align:right">Buchh.</th></tr></thead><tbody id="tb"></tbody></table>`;
  app.appendChild(card);
  const tb=$("#tb");
  st.forEach((s,i)=>{
    const tr=document.createElement("tr");
    if(i===0) tr.className="top1"; else if(i===1) tr.className="top2"; else if(i===2) tr.className="top3";
    if(s.withdrawn) tr.classList.add("out");
    tr.innerHTML=`<td class="rk">${i+1}</td><td class="nm">${esc(s.name)}</td><td class="kl">${esc(s.klasse||"")}</td>
      <td class="pts">${fmt(s.points)}</td><td class="bz">${fmt(s.buch)}</td>`;
    tb.appendChild(tr);
  });
  if(st.length===0) tb.innerHTML=`<tr><td colspan="5"><div class="empty">Noch keine Ergebnisse</div></td></tr>`;
}

/* ---------- ENDE ---------- */
function renderFinished(app){
  const beamer=location.origin+location.pathname+"?beamer";
  if(IS_ADMIN){
    const ab=document.createElement("div"); ab.className="adminbar";
    ab.innerHTML=`<div class="ab-top">${ic('teacher')}Turnier beendet <span class="lk">${esc(state.time_control)} · ${state.num_rounds} Runden</span></div>
      <div class="ab-actions">
        ${state.awarded?`<span class="ab-note">${ic('checkCircle')} Pokale graviert</span>`:`<button class="btn" id="btnAward">${ic('trophy')} Pokale gravieren (Top 3)</button>`}
        ${(state.champions||[]).length?`<button class="btn ghost sm" id="btnClearCup" title="Gravur von den Pokalen entfernen (z.B. nach einem Test). Wall of Fame bleibt.">${ic('trash')} Gravur löschen</button>`:""}
        <a class="btn ghost sm" href="${esc(beamer)}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
        <button class="btn danger sm" id="btnReset">${ic('reset')} Neues Turnier</button>
        ${adminCommonBtns()}
      </div>
      ${state.awarded?"":'<div class="ab-hint">Bisherige Pokal-Inhaber wandern dabei in die Wall of Fame, die neuen Top 3 kommen auf die Pokale.</div>'}`;
    app.appendChild(ab);
    if($("#btnAward")) $("#btnAward").onclick=awardTrophies;
    if($("#btnClearCup")) $("#btnClearCup").onclick=()=>clearTrophies().then(()=>render());
    $("#btnReset").onclick=()=>confirmReset();
    wireAdminCommon();
  }
  const st=computeStandings();
  if(st.length>=3){
    const card=document.createElement("div"); card.className="card lg";
    card.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('trophy')} Siegerehrung</div><h2 style="text-align:center;margin-bottom:6px">${esc(state.tournament_name)}</h2><div class="podium" id="pod"></div>`;
    app.appendChild(card);
    const pod=$("#pod");
    const order=[{p:st[1],pos:2,c:"p2",crown:"🥈"},{p:st[0],pos:1,c:"p1",crown:"👑"},{p:st[2],pos:3,c:"p3",crown:"🥉"}];
    order.forEach(o=>{
      const d=document.createElement("div"); d.className="pod "+o.c;
      d.innerHTML=`<div class="crown">${o.crown}</div><div class="pname">${esc(o.p.name)}</div><div class="pkl">${esc(o.p.klasse||"")}</div><div class="ppts">${fmt(o.p.points)} Pkt</div><div class="stand">${o.pos}</div>`;
      pod.appendChild(d);
    });
  }
  if(state.awarded && (state.champions||[]).length){
    const tc=document.createElement("div"); tc.className="card";
    tc.innerHTML=`<div class="eyebrow" style="text-align:center">Auf den Pokalen verewigt</div><h2 style="text-align:center;margin-bottom:6px">${esc(state.tournament_name)} · ${esc(fmtDate(state.champions[0].date))}</h2>`;
    app.appendChild(tc);
    renderTrophies(tc, state.champions);
  }
  renderTable(app, true);
  renderWall(app);
}

/* ---------- POKALE / RUHMESHALLE ---------- */
function cupSVG(rank){
  const c = rank===1?{a:"#edc75f",b:"#cf9a2e"}:rank===2?{a:"#d4d8df",b:"#9aa0a8"}:{a:"#dca97d",b:"#b06f3f"};
  return `<svg viewBox="0 0 200 220" width="100%" height="100%" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="cg${rank}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
    <path d="M52 42 C18 42 20 96 62 98" fill="none" stroke="url(#cg${rank})" stroke-width="9" stroke-linecap="round"/>
    <path d="M148 42 C182 42 180 96 138 98" fill="none" stroke="url(#cg${rank})" stroke-width="9" stroke-linecap="round"/>
    <rect x="44" y="22" width="112" height="13" rx="6.5" fill="${c.a}"/>
    <path d="M48 31 H152 V54 C152 106 124 134 100 134 C76 134 48 106 48 54 Z" fill="url(#cg${rank})"/>
    <rect x="92" y="134" width="16" height="26" fill="${c.b}"/>
    <path d="M68 160 H132 L140 178 H60 Z" fill="url(#cg${rank})"/>
    <rect x="34" y="182" width="132" height="33" rx="6" fill="#2b2c27"/>
  </svg>`;
}
function trophyFigure(rank, champ){
  const i=rank-1;
  const img=TROPHY_CONFIG.images[i]||"";
  const top=(TROPHY_CONFIG.plateTopPct[i]!=null?TROPHY_CONFIG.plateTopPct[i]:60)+"%";
  const lRaw=Array.isArray(TROPHY_CONFIG.plateLeftPct)?TROPHY_CONFIG.plateLeftPct[i]:TROPHY_CONFIG.plateLeftPct;
  const left=(lRaw!=null?lRaw:50)+"%";
  const rRaw=Array.isArray(TROPHY_CONFIG.plateRotateDeg)?TROPHY_CONFIG.plateRotateDeg[i]:TROPHY_CONFIG.plateRotateDeg;
  const rot=(rRaw!=null?rRaw:0)+"deg";
  const wRaw=Array.isArray(TROPHY_CONFIG.plateWidthPct)?TROPHY_CONFIG.plateWidthPct[i]:TROPHY_CONFIG.plateWidthPct;
  const wpc=(wRaw!=null?wRaw:70)+"%";
  const style=(TROPHY_CONFIG.plateStyle&&TROPHY_CONFIG.plateStyle[i])||"brass";
  const medal=rank===1?"🥇":rank===2?"🥈":"🥉";
  return `<figure class="trophy t${rank}">
    <div class="trophy-img" style="--plate-top:${top};--plate-left:${left};--plate-rot:${rot};--plate-w:${wpc}">
      <img src="${esc(img)}" alt="Pokal ${rank}. Platz" onerror="this.style.display='none';this.closest('.trophy-img').classList.add('fallback');this.parentNode.querySelector('.trophy-svg').style.display='block';">
      <div class="trophy-svg" style="display:none">${cupSVG(rank)}</div>
      <div class="plaque plaque-${style}${champ?"":" empty"}">
        <span class="pl-name">${champ?esc(champ.name):"frei"}</span>
        ${champ&&champ.klasse?`<span class="pl-kl">${esc(champ.klasse)}</span>`:""}
      </div>
    </div>
    <figcaption><span class="medal">${medal}</span> ${rank}. Platz</figcaption>
  </figure>`;
}
function renderTrophies(container, champs){
  const wrap=document.createElement("div"); wrap.className="trophies";
  wrap.innerHTML=[1,2,3].map(r=>trophyFigure(r,(champs||[]).find(c=>c.rank===r))).join("");
  container.appendChild(wrap);
}
function fmtDate(d){
  if(!d) return "";
  const m=String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m?`${m[3]}.${m[2]}.${m[1]}`:String(d);
}
function renderWall(container){
  const hof=state.halloffame||[];
  const groups={};
  hof.forEach(e=>{ const k=(e.event_date||"")+"|"+(e.tournament_name||""); (groups[k]=groups[k]||[]).push(e); });
  // älteste zuerst (Timeline), füllt sich wie eine echte Tafel
  const keys=Object.keys(groups).sort((a,b)=> (a.split("|")[0]).localeCompare(b.split("|")[0]));

  const card=document.createElement("div"); card.className="card lg legends-card";
  let html=`<img class="legends-banner" src="${esc(LEGENDS_BOARD)}" alt="HTL1 Legends">`;
  if(keys.length===0){
    html+=`<div class="empty" style="padding:18px 10px">Hier wird die Wall of Fame über die Jahre gefüllt — jeder Turniersieger bekommt seine eigene Tafel.</div>`;
  }else{
    html+=`<div class="legend-grid">`;
    keys.forEach(k=>{
      const [date,name]=k.split("|");
      const yr=(String(date).match(/^(\d{4})/)||[,"20XX"])[1];
      const list=groups[k].sort((a,b)=>a.rank-b.rank);
      const ch=list.find(e=>e.rank===1);
      const second=list.find(e=>e.rank===2), third=list.find(e=>e.rank===3);
      const minor=[second?`🥈 ${esc(second.name)}`:null, third?`🥉 ${esc(third.name)}`:null].filter(Boolean).join("  ");
      html+=`<div class="legend-plate" title="${esc(name||"Turnier")}">
        <div class="lp-year">— ${esc(yr)} —</div>
        <div class="lp-champ">🥇 ${ch?esc(ch.name):"—"}${ch&&ch.klasse?` <span class="lp-kl">${esc(ch.klasse)}</span>`:""}</div>
        ${minor?`<div class="lp-minor">${minor}</div>`:""}
      </div>`;
    });
    html+=`</div>`;
  }
  card.innerHTML=html; container.appendChild(card);
}
function renderHall(container){
  const card=document.createElement("div"); card.className="card lg";
  const hasCh=(state.champions||[]).length>0;
  card.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('trophy')} Ruhmeshalle</div>
    <h2 style="text-align:center;margin-bottom:4px">${hasCh?"Amtierende Titelverteidiger":"Pokale warten auf ihre Sieger"}</h2>
    ${hasCh?`<p class="lead" style="text-align:center">${esc(state.champions[0].tournament||"")} · ${esc(fmtDate(state.champions[0].date))}</p>`:`<p class="lead" style="text-align:center">Die Top 3 dieses Turniers werden hier eingraviert.</p>`}`;
  container.appendChild(card);
  renderTrophies(card, state.champions);
  renderWall(container);
}

/* ---------- BEAMER-ANSICHT ---------- */
function beamerRoot(){
  let r=$("#beamerRoot");
  if(!r){ r=document.createElement("div"); r.id="beamerRoot"; r.className="beamer"; document.body.appendChild(r); }
  return r;
}
function renderBeamer(){
  const r=beamerRoot();
  const statusTxt = state.status==="registration"?"Anmeldung läuft"
                  : state.status==="running"?`Runde ${state.current_round} / ${state.num_rounds} · ${esc(state.time_control)}`
                  : "Turnier beendet";
  let panels=[];

  if(state.status==="registration"){
    panels=["join","champions"];
  }else if(state.status==="running"){
    panels=["pairings"];               // nur Spielplan — kein Umschalten in die Liste
  }else{
    panels=["podium","standings"];
  }
  const panel = panels[ui.beamerIdx % panels.length];
  let body="";

  if(panel==="join"){
    const viewer=location.origin+location.pathname;
    const active=state.players.filter(p=>!p.withdrawn);
    const latest=[...state.players].slice(-18).reverse();
    const showCode = (VMODE()==="code" && (state.event_code||"").trim());
    body=`<div class="bm-join">
      <div class="bm-qr"><div id="bmqr"></div><div class="bm-qrcap">Handy-Kamera drauf halten<br>& anmelden</div></div>
      <div class="bm-joininfo">
        ${showCode?`<div class="bm-code">Anmeldecode <b>${esc(state.event_code)}</b></div>`:""}
        <div class="bm-count"><b>${active.length}</b> angemeldet</div>
        <div class="bm-names">${latest.map(p=>`<span class="bm-chip">${esc(p.name)}${p.klasse?` <i>${esc(p.klasse)}</i>`:""}</span>`).join("")||"<span class='bm-dim'>Noch niemand — sei die/der Erste!</span>"}</div>
      </div></div>`;
  }
  else if(panel==="champions"){
    body=`<div class="bm-section-title">${ic('trophy')} Titelverteidiger</div><div id="bmtrophies"></div>`;
  }
  else if(panel==="pairings"){
    const prs=state.pairings.filter(p=>p.round===state.current_round).sort((a,b)=>a.board-b.board);
    body=`<div class="bm-section-title">Spielplan · Runde ${state.current_round}</div>
      <div class="bm-pairgrid">${prs.map(p=>{
        if(p.black_id==null) return `<div class="bm-pair bye"><span class="bm-bd">–</span><span class="bm-pn">${esc(nm(p.white_id))}</span><span class="bm-bye">Freilos</span></div>`;
        const res=p.result==="1-0"?"1 : 0":p.result==="0-1"?"0 : 1":p.result==="draw"?"½ : ½":"–";
        return `<div class="bm-pair${p.result?" done":""}"><span class="bm-bd">${p.board}</span><span class="bm-pn">${esc(nm(p.white_id))}</span><span class="bm-res">${res}</span><span class="bm-pn r">${esc(nm(p.black_id))}</span></div>`;
      }).join("")}</div>`;
  }
  else if(panel==="standings"){
    const st=computeStandings().slice(0,16);
    body=`<div class="bm-section-title">${state.status==="finished"?"Endstand":"Zwischenstand"}</div>
      <table class="bm-tbl"><tbody>${st.map((s,i)=>`<tr class="${i<3?"top"+(i+1):""}"><td class="r">${i+1}</td><td class="n">${esc(s.name)}</td><td class="k">${esc(s.klasse||"")}</td><td class="p">${fmt(s.points)}</td><td class="b">${fmt(s.buch)}</td></tr>`).join("")}</tbody></table>`;
  }
  else if(panel==="podium"){
    const st=computeStandings();
    const o=[{p:st[1],pos:2,c:"p2",m:"🥈"},{p:st[0],pos:1,c:"p1",m:"🥇"},{p:st[2],pos:3,c:"p3",m:"🥉"}].filter(x=>x.p);
    body=`<div class="bm-section-title">${ic('trophy')} ${esc(state.tournament_name)}</div>
      <div class="podium beamer-podium">${o.map(x=>`<div class="pod ${x.c}"><div class="crown">${x.m}</div><div class="pname">${esc(x.p.name)}</div><div class="pkl">${esc(x.p.klasse||"")}</div><div class="ppts">${fmt(x.p.points)} Pkt</div><div class="stand">${x.pos}</div></div>`).join("")}</div>`;
  }

  r.innerHTML=`
    <div class="bm-top">
      <img class="bm-logo" src="${HTL1_LOGO}" alt="HTL1">
      <div class="bm-title">${esc(state.tournament_name)}</div>
      <div class="bm-status">${statusTxt}</div>
    </div>
    <div class="bm-stage${(panel==="pairings"||panel==="standings")?"":" center"}">${body}</div>
    ${panels.length>1?`<div class="bm-dots">${panels.map((_,i)=>`<span class="${i===ui.beamerIdx%panels.length?"on":""}"></span>`).join("")}</div>`:""}`;

  if(panel==="join"){ try{ new QRCode($("#bmqr"),{text:location.origin+location.pathname,width:260,height:260,colorDark:"#20211d",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}); }catch(e){} }
  if(panel==="champions"){ renderTrophies($("#bmtrophies"), state.champions); }
}

/* ---------- QR (nur Admin + Supabase) ---------- */
function renderQR(app){
  const viewer = location.origin + location.pathname;
  const card=document.createElement("div"); card.className="card";
  card.innerHTML=`<div class="eyebrow">Schüler einladen</div><h2 style="margin-bottom:12px">QR-Code für die Anmeldung</h2>
    <div class="qrbox"><div id="qr"></div>
      <div class="linkfield"><p class="lead" style="margin-bottom:8px">Schüler scannen den Code oder öffnen den Link — sie sehen Anmeldung, Spielplan und Tabelle live.</p>
        <div class="linkrow"><input id="vlink" readonly value="${esc(viewer)}"><button class="btn sm" id="cpy">Kopieren</button></div></div></div>`;
  app.appendChild(card);
  try{ new QRCode($("#qr"), {text:viewer, width:132, height:132, colorDark:"#20211d", colorLight:"#ffffff", correctLevel:QRCode.CorrectLevel.M}); }catch(e){}
  $("#cpy").onclick=()=>{ const i=$("#vlink"); i.select(); navigator.clipboard?.writeText(i.value); toast("Link kopiert ✓"); };
}

/* ---------- Helfer ---------- */
function esc(s){ return (s==null?"":String(s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function fmt(n){ return Number.isInteger(n)?String(n):n.toFixed(1).replace(".",","); }
let toastT;
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),1900); }
async function addDemo(){
  const namen=["Lena M.","Paul K.","Mia S.","Jonas W.","Emma H.","Felix B.","Anna R.","Noah T.","Sophie L.","David P.","Marie F.","Lukas G.","Hannah Z.","Tobias N.","Laura D.","Simon V.","Julia A.","Florian E.","Sarah O.","Daniel U."];
  const klassen=["1AHET","1BHET","2AHET","2BHET","3AHET"];
  for(const n of namen){ await addPlayer(n, klassen[Math.floor(Math.random()*klassen.length)]); }
  render(); toast("20 Testdaten hinzugefügt");
}

/* Spielt ein komplettes Turnier mit Zufallsergebnissen durch (zum Testen). */
async function simulateTournament(){
  if(!isAdmin()) return;
  if(state.status==="finished"){ toast("Schon beendet — erst 'Neues Turnier'"); return; }
  const active=state.players.filter(p=>!p.withdrawn);
  if(active.length<2){ toast("Erst Testdaten/Teilnehmer laden"); return; }
  toast("Testlauf läuft…");
  if(state.status==="registration"){ await startTournament(); if(SB_MODE) await loadAll(); }
  let guard=0;
  while(state.status==="running" && guard++<40){
    const cur=state.current_round;
    for(const p of state.pairings.filter(x=>x.round===cur && !x.result)){
      if(p.black_id==null){ await setResult(p.id,"bye"); }
      else { const r=Math.random(); await setResult(p.id, r<0.45?"1-0":(r<0.9?"0-1":"draw")); }
    }
    if(cur>=state.num_rounds){ await finishTournament(); break; }
    await nextRound();
    if(SB_MODE) await loadAll();
  }
  if(SB_MODE) await loadAll();
  render();
  toast("Testlauf fertig — jetzt 'Pokale vergeben' testen ✓");
}

/* Importiert Teilnehmer aus Excel/CSV (Spalten 'Name' und 'Klasse'). */
async function handleImportFile(file){
  if(!file) return;
  if(typeof XLSX==="undefined"){ toast("Bitte kurz warten (Bibliothek lädt)"); return; }
  try{
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array"});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false});
    if(!rows.length){ toast("Datei ist leer"); return; }
    let start=0,nameCol=0,klasseCol=1;
    const head=(rows[0]||[]).map(x=>String(x).trim().toLowerCase());
    const ni=head.findIndex(h=>h.includes("name"));
    const ki=head.findIndex(h=>h.includes("klasse")||h.includes("class"));
    if(ni>-1){ start=1; nameCol=ni; klasseCol=(ki>-1?ki:(ni===0?1:0)); }
    let n=0;
    for(let i=start;i<rows.length;i++){
      const row=rows[i]||[];
      const name=String(row[nameCol]==null?"":row[nameCol]).trim();
      const klasse=String(row[klasseCol]==null?"":row[klasseCol]).trim();
      if(name.length<2) continue;
      if(state.players.some(p=>p.name.toLowerCase()===name.toLowerCase() && (p.klasse||"").toLowerCase()===klasse.toLowerCase())) continue;
      await addPlayer(name,klasse); n++;
    }
    render(); toast(n+" Teilnehmer importiert ✓");
  }catch(e){ console.error(e); toast("Import fehlgeschlagen — Spalten 'Name'/'Klasse' prüfen"); }
}

/* ============================ START ============================ */
async function boot(){
  const bl=$("#brandLogo"); if(bl) bl.src=HTL1_LOGO;
  if(SB_MODE){
    try{ const { data:{ session } } = await sb.auth.getSession(); authUser = session ? session.user : null; }catch(e){ authUser=null; }
    sb.auth.onAuthStateChange((_evt, sess)=>{ authUser = sess ? sess.user : null; if(IS_ADMIN) render(); });
    await loadAll();
    // Realtime-Änderungen coalescen: mehrere Events kurz hintereinander -> ein Reload+Render
    let _syncT=null, _syncing=false;
    const scheduleSync=()=>{ clearTimeout(_syncT); _syncT=setTimeout(async()=>{
      if(_syncing) return; _syncing=true;
      try{ await loadAll(); render(); } finally{ _syncing=false; }
    }, 120); };
    sb.channel("chess-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_state"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_players"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_pairings"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_halloffame"},scheduleSync)
      .subscribe();
  }
  if(IS_BEAMER){ setInterval(()=>{ ui.beamerIdx++; render(); }, 12000); }
  render();
}
boot(); 