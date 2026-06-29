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
  images:        ["assets/pokal-gold_neu.png", "assets/pokal-silber_neu.png", "assets/pokal-bronze_neu.png"],
  plateTopPct:   [84, 86, 86.5],       // [gold, silber, bronze]
  plateWidthPct: [50, 50, 50],
  plateLeftPct:  [56, 54, 54],         // horizontale Mitte der Plakette (%); Gold etwas weiter rechts
  plateRotateDeg:[-3.4, -2.0, -2.6],   // Neigung (Grad, negativ = gegen Uhrzeigersinn)
  plateStyle:    ["engrave", "engrave", "engrave"]
};
/* HTL1-LEGENDS-Wall (Banner ueber der Jahres-Doku) */
const LEGENDS_BOARD = "assets/legends.jpg";
/* Platz-Symbole (passend zur Schach-Seite statt Standard-Medaillen): König / Dame / Springer */
const RANK_PIECE = ["♚","♛","♞"];
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
  reg_text: "",                    // Externer Link: Hinweistext
  reg_link: "",                    // Externer Link: URL
  qr_extern: false,                // QR/Anmeldung zeigt auf: false = Schüleransicht (App), true = externer Link
  live_only: false,                // "Spiel Live": keine Anmeldung, alle Links/QR -> Schüler-Liveansicht
  paused: false,                   // Spielpause (Beamer/Handy zeigen Pausen-Screen)
  pause_text: "",                  // optionaler Pausentext (z.B. "Mittagspause bis 13:00")
  board_labels: "Brett 1, Brett 2, Brett 3, Brett 4, Brett 5, Brett 6, Brett 7, Brett 8, Brett 9, Brett 10, Brett 11, Brett 12, Brett 13, Brett 14, Brett 15, Brett 16, Brett 17, Brett 18, Brett 19, Brett 20",  // Bretter (Liste); Anzahl = Kapazität, leer = unbegrenzt
  beamer_boards: true,             // Brettnummern am Beamer anzeigen (ein/aus)
  champions: [],                   // aktuelle Pokal-Inhaber [{rank,name,klasse,tournament,date}]
  players: [],                     // {id,name,klasse,withdrawn,email,verified}
  pairings: [],                    // {id,round,board,white_id,black_id,result,active,board_label}
  halloffame: []                   // {tournament_name,event_date,rank,name,klasse}
};
let ui = { tab: "plan", viewRound: 0, beamerIdx: 0, regStep: "form", regDraft: {} };

/* Aktiver Anmeldemodus (aus DB-State, sonst Default) */
function VMODE(){ return state.verify_mode || VERIFY_DEFAULT; }
/* Tippt der/die Nutzer:in gerade in ein Feld? (dann kein Auto-Neu-Rendern) */
function isTyping(){ const e=document.activeElement; return !!(e && (e.tagName==="INPUT"||e.tagName==="TEXTAREA"||e.tagName==="SELECT"||e.isContentEditable)); }
/* Kompakte Signatur des Zustands — nur bei Änderung neu rendern (sonst restartet
   z.B. die Sieger-Überblendung am Beamer bei jedem Poll). */
function stateSig(){
  return [state.updated_at, state.status, state.current_round, state.paused, state.pause_text,
    state.awarded, (state.champions||[]).length, (state.halloffame||[]).length,
    state.players.length, state.players.map(p=>p.withdrawn?1:0).join(""),
    state.pairings.map(p=>(p.result||"")+(p.active?"1":"0")+(p.board_label||"")).join("|")
  ].join("~");
}
/* "Spiel Live": keine Anmeldung — Links/QR nur auf die Schüler-Liveansicht */
function liveOnly(){ return !!state.live_only; }
/* Externer Anmelde-Link aktiv? Sonst: Schüleransicht (App-Seite). Bei "Spiel Live" nie extern. */
function useExtern(){ return !liveOnly() && !!(state.qr_extern && (state.reg_link||"").trim()); }
function regTarget(){ return useExtern() ? (state.reg_link||"").trim() : (location.origin+location.pathname); }
function linkLabel(u){ return String(u||"").replace(/^https?:\/\//,"").replace(/\/+$/,""); }
const MODE_INFO = {
  none:  { label:"Offen",  desc:"Schüler tippen nur Name + Klasse und sind sofort in der Liste. Keine Bestätigung, keine Kontaktdaten — am schnellsten." },
  code:  { label:"Code",   desc:"Du legst unten einen Code fest, der am Beamer steht. Nur wer den Code eintippt, kann sich anmelden. Keine Kontaktdaten, DSGVO-freundlich." },
  email: { label:"E-Mail", desc:"Schüler bekommen einen 6-stelligen Code an ihre Mail und bestätigen damit. Braucht Supabase + eigenen SMTP (siehe README)." }
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-"+Math.random().toString(36).slice(2)+Date.now());
const $ = sel => document.querySelector(sel);

/* ---- Inline-SVG-Icons (schlicht, einfarbig, erben Textfarbe) ---- */
const ICONS = {
  info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
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
  const withdrawn = !extra.present;   // standardmäßig "nicht anwesend" (Anwesenheit per Haken bestätigen)
  const rec = { id:uuid(), name, klasse, withdrawn, email:extra.email||null, verified:!!extra.verified, tiebreak:0 };
  if(SB_MODE){ const {data} = await sb.from("chess_players").insert({name,klasse,withdrawn,email:rec.email,verified:rec.verified}).select().single(); if(data) rec.id=data.id; }
  state.players.push(rec);
}
/* Bulk: alle Teilnehmer anwesend/abwesend setzen */
async function setAllPresent(present){
  const w=!present;
  state.players.forEach(p=>p.withdrawn=w);
  if(SB_MODE){ await sb.from("chess_players").update({withdrawn:w}).not("id","is",null); }
  render();
}
async function removePlayer(id){
  state.players = state.players.filter(p=>p.id!==id);
  if(SB_MODE){ await sb.from("chess_players").delete().eq("id",id); }
}
async function toggleWithdrawn(id, val){
  const p = state.players.find(x=>x.id===id); if(p) p.withdrawn=val;
  if(SB_MODE){ await sb.from("chess_players").update({withdrawn:val}).eq("id",id); }
}
/* Stechen: markiert den Spieler als Sieger seiner Gleichstand-Gruppe (Toggle). */
async function tiebreakWinner(id){
  const st=computeStandings();
  const me=st.find(s=>s.id===id); if(!me) return;
  const group=st.filter(s=> s.points===me.points);
  if(group.length<2){ toast("Hier gibt es keine Punktgleichheit"); return; }
  const others=group.filter(s=>s.id!==id).map(s=>s.tiebreak||0);
  const already=(me.tiebreak||0) > Math.max(0,...others);
  const val=already ? 0 : Math.max(0,...group.map(s=>s.tiebreak||0))+1;
  const p=state.players.find(x=>x.id===id); if(!p) return;
  p.tiebreak=val;
  if(SB_MODE){ await sb.from("chess_players").update({tiebreak:val}).eq("id",id); }
  render(); toast(already ? "Stechen zurückgesetzt" : p.name+" als Stechen-Sieger nach vorne ✓");
}
async function insertPairings(arr){
  arr.forEach(p=>{ if(!p.id) p.id=uuid(); });
  state.pairings.push(...arr);
  if(SB_MODE){
    const rows = arr.map(({id,round,board,white_id,black_id,result,active,board_label})=>({round,board,white_id,black_id,result,active,board_label}));
    const {data} = await sb.from("chess_pairings").insert(rows).select();
    if(data){ /* IDs werden beim nächsten Reload sauber gezogen */ }
  }
}
async function setResult(id, result, freedBoard){
  const p = state.pairings.find(x=>x.id===id); if(!p) return;
  const wasOpen = !p.result;
  p.result=result;
  if(SB_MODE){ await sb.from("chess_pairings").update({result}).eq("id",id); }
  // Warteschlange: aktives Brett wird frei -> nächstes Wartepaar aktivieren
  if(result && wasOpen && p.active!==false && p.black_id!=null){
    const next = state.pairings.find(x=>x.round===p.round && x.active===false && !x.result && x.black_id!=null);
    if(next){
      // Brett: bekanntgegebenes Brett vom Ergebnis, sonst was am Wartepaar steht, sonst leer
      next.active=true; next.board_label=(freedBoard||"").trim() || (next.board_label||"");
      if(SB_MODE){ await sb.from("chess_pairings").update({active:true, board_label:next.board_label}).eq("id",next.id); }
    }
  }
}
/* Wartepaar manuell aktiv setzen ("spielt") — behält die ggf. eingegebene Brett-Bezeichnung */
async function activatePairing(id){
  const p = state.pairings.find(x=>x.id===id); if(!p || p.active!==false) return;
  p.active=true;
  if(SB_MODE){ await sb.from("chess_pairings").update({active:true}).eq("id",id); }
  render();
}
/* Brett-Bezeichnung einer Paarung setzen (Wartepaar oder aktive Partie) */
async function setBoardLabel(id, val){
  const p = state.pairings.find(x=>x.id===id); if(!p) return;
  p.board_label=(val||"").trim();
  if(SB_MODE){ await sb.from("chess_pairings").update({board_label:p.board_label}).eq("id",id); }
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
/* Einzelne Tafel (ein Turnier) aus der Wall of Fame löschen. */
async function deleteHallGroup(date, tournament){
  const keyOf=e=>((e.event_date||"")+"|"+(e.tournament_name||""));
  const key=(date||"")+"|"+(tournament||"");
  const all=state.halloffame||[];
  const grp=all.filter(e=>keyOf(e)===key);
  if(!grp.length) return;
  if(!confirm(`Diese Tafel von der Wall of Fame löschen?\n\n${(tournament||"Turnier")}${date?" · "+fmtDate(date):""}\n\nKann nicht rückgängig gemacht werden.`)) return;
  state.halloffame = all.filter(e=>keyOf(e)!==key);
  const ids=grp.map(e=>e.id).filter(Boolean);
  if(SB_MODE && ids.length){ await sb.from("chess_halloffame").delete().in("id",ids); }
  render(); toast("Tafel gelöscht");
}
/* Wall-of-Fame-Vorschau (NICHT gespeichert) — zum Testen der Gravur/Tafel. Knopf = Toggle. */
function previewHall(){
  if((state.halloffame||[]).some(e=>e._preview)){
    state.halloffame = (state.halloffame||[]).filter(e=>!e._preview);
    render(); toast("Vorschau entfernt"); return;
  }
  let src;
  if(state.champions && state.champions.length) src = state.champions.map(c=>({rank:c.rank,name:c.name,klasse:c.klasse}));
  else {
    const top = standingsView().slice(0,3);
    src = top.length ? top.map((s,i)=>({rank:i+1,name:s.name,klasse:s.klasse}))
        : [{rank:1,name:"Max Beispiel",klasse:"3AHET"},{rank:2,name:"Lena Muster",klasse:"2BHET"},{rank:3,name:"Tom Test",klasse:"1CHME"}];
  }
  const today = new Date().toISOString().slice(0,10);
  const entries = src.map(c=>({ _preview:true, tournament_name:(state.tournament_name||"Schachturnier")+" · Vorschau", event_date:today, rank:c.rank, name:c.name, klasse:c.klasse||"" }));
  state.halloffame = [...entries, ...(state.halloffame||[])];
  render(); toast("Wall-of-Fame-Vorschau (nicht gespeichert) — Knopf nochmal = entfernen");
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
  const pts={}, played={}, opp={}, res={}, wins={};
  state.players.forEach(p=>{ pts[p.id]=0; played[p.id]=0; opp[p.id]=[]; res[p.id]=[]; wins[p.id]=0; });
  state.pairings.forEach(pr=>{
    if(!pr.result) return;
    if(pr.result==="bye"){ pts[pr.white_id]=(pts[pr.white_id]||0)+1; return; }
    played[pr.white_id]++; played[pr.black_id]++;
    opp[pr.white_id].push(pr.black_id); opp[pr.black_id].push(pr.white_id);
    let sw,sb;   // Teilergebnis Weiß/Schwarz (1 / ½ / 0)
    if(pr.result==="1-0"){ pts[pr.white_id]+=1; sw=1; sb=0; wins[pr.white_id]++; }
    else if(pr.result==="0-1"){ pts[pr.black_id]+=1; sw=0; sb=1; wins[pr.black_id]++; }
    else if(pr.result==="draw"){ pts[pr.white_id]+=0.5; pts[pr.black_id]+=0.5; sw=0.5; sb=0.5; }
    else return;
    res[pr.white_id].push({o:pr.black_id,s:sw}); res[pr.black_id].push({o:pr.white_id,s:sb});
  });
  const buch={}, sonn={};
  state.players.forEach(p=>{
    buch[p.id]=opp[p.id].reduce((s,o)=>s+(pts[o]||0),0);
    sonn[p.id]=res[p.id].reduce((s,r)=>s+r.s*(pts[r.o]||0),0);   // Sonneborn-Berger
  });
  return state.players.map(p=>({
    id:p.id, name:p.name, klasse:p.klasse, withdrawn:p.withdrawn,
    points:pts[p.id], buch:buch[p.id], sonn:sonn[p.id], wins:wins[p.id], played:played[p.id], tiebreak:p.tiebreak||0
  })).sort((a,b)=> (b.points-a.points) || (b.tiebreak-a.tiebreak) || (b.buch-a.buch) || (b.sonn-a.sonn) || (b.wins-a.wins) || a.name.localeCompare(b.name,"de"));
}
/* Tabellen-Anzeige: Abwesende, die nie gespielt haben, ausblenden (Aussteiger mit Partien bleiben). */
function standingsView(){ return computeStandings().filter(s=> !s.withdrawn || s.played>0); }
/* Offene Stechen-Gruppen: echter Gleichstand (Punkte+Buchholz+Sonneborn+Siege gleich),
   der noch NICHT per Stechen aufgelöst ist (gleiche tiebreak-Werte). Nur im Endstand. */
function stechenGroups(){
  if(state.status!=="finished") return [];
  const st=standingsView(); const out=[]; const seen=new Set();
  for(const s of st){
    if(seen.has(s.id)) continue;
    const grp=st.filter(o=> o.points===s.points && o.buch===s.buch && o.sonn===s.sonn && o.wins===s.wins);
    grp.forEach(g=>seen.add(g.id));
    if(grp.length<2) continue;
    const tbs=grp.map(g=>g.tiebreak||0);
    if(new Set(tbs).size!==tbs.length) out.push(grp);   // noch nicht eindeutig gereiht
  }
  return out;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

/* ---------- EXCEL-EXPORT (SheetJS) ---------- */
function exportExcel(){
  if(typeof XLSX==="undefined"){ toast("Excel-Bibliothek lädt noch – kurz warten"); return; }
  const wb=XLSX.utils.book_new();

  const st=computeStandings();
  const tab=[["#","Name","Klasse","Punkte","Buchholz","Sonneborn-Berger","Siege","Partien"]];
  st.forEach((s,i)=>tab.push([i+1,s.name,s.klasse||"",s.points,s.buch,s.sonn,s.wins,s.played]));
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

  // Aktuelle Pokal-Gravur (Titelverteidiger) — fuer spaeteren Re-Import
  if(state.champions && state.champions.length){
    const cp=[["Platz","Name","Klasse","Turnier","Datum"]];
    [...state.champions].sort((a,b)=>a.rank-b.rank).forEach(c=>cp.push([c.rank,c.name,c.klasse||"",c.tournament||"",c.date||""]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cp), "Pokale");
  }

  const safe=(state.tournament_name||"Schachturnier").replace(/[^\w\-]+/g,"_");
  const date=new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `${safe}_${date}.xlsx`);
  toast("Excel exportiert ✓");
}

/* gemeinsame Buttons für jede Admin-Leiste */
function adminCommonBtns(){
  return `<button class="btn ghost sm" id="btnXlsx">${ic('table')} Excel</button>`;
}
async function doLogout(){
  if(SB_MODE){ try{ await sb.auth.signOut(); }catch(e){} authUser=null; }
  else { setLocalAdmin(false); }
  toast("Abgemeldet"); render();
}
function wireAdminCommon(){
  const x=$("#btnXlsx"); if(x) x.onclick=exportExcel;
  const o=$("#btnLogout"); if(o) o.onclick=doLogout;
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
    // Freilos an den niedrigstplatzierten Spieler mit den WENIGSTEN bisherigen Freilosen
    let minByes=Infinity;
    for(let i=pool.length-1;i>=0;i--){ const b=st[pool[i].id].byes; if(b<minByes){ minByes=b; bye=pool[i]; if(b===0) break; } }
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
  // Brett-Kapazität: nur die ersten N Partien sind aktiv, der Rest wartet (Warteschlange)
  const cap=boardCap();
  out.forEach((p,i)=>{ p.active = (cap===0) || (i<cap); p.board_label=""; });
  if(bye) out.push({round,board:out.length+1,white_id:bye.id,black_id:null,result:"bye",active:true,board_label:""});
  return out;
}
/* Bretter: Liste der Bezeichnungen (Anzahl = Kapazität, leer = unbegrenzt) */
function boardLabels(){ return (state.board_labels||"").split(/[\n,]+/).map(s=>s.trim()).filter(Boolean); }
function boardCap(){ return boardLabels().length; }

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
/* <option>-Liste für die Bedenkzeit, gruppiert; eigener (nicht gelisteter) Wert bleibt erhalten */
function tcOptions(cur){
  const groups=[
    ["Blitz / Schnellschach", [["3+2","3 min + 2 Sek"],["5+0","5 min"],["5+3","5 min + 3 Sek"],["10+0","10 min"],["10+5","10 min + 5 Sek"],["15+0","15 min"],["15+10","15 min + 10 Sek"],["20+0","20 min"],["25+10","25 min + 10 Sek"]]],
    ["Standard / Klassisch (40 Züge)", [["30+0","30 min"],["30+30","30 min + 30 Sek"],["60+0","60 min"],["60+30","60 min + 30 Sek"],["90+30","90 min + 30 Sek · 40 Züge (FIDE)"],["120+0","120 min · 40 Züge"]]],
  ];
  let found=false,out="";
  for(const [g,opts] of groups){
    out+=`<optgroup label="${g}">`;
    for(const [v,lbl] of opts){ const sel=v===cur; if(sel)found=true; out+=`<option value="${v}"${sel?" selected":""}>${lbl}</option>`; }
    out+="</optgroup>";
  }
  if(!found && cur) out=`<option value="${esc(cur)}" selected>${esc(cur)} (eigene)</option>`+out;
  return out;
}
function fmtDur(min){
  min=Math.max(0,Math.round(min));
  const h=Math.floor(min/60), m=min%60;
  return h ? (m? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}
/* Grobe Dauer-Schätzung: Runden × Rundenlänge (Partien laufen parallel).
   Pro Runde: ~Grundbedenkzeit/Spieler + Inkrement + Overhead (Wechsel, Ergebnis
   eintragen, nächste Auslosung). Hängt nur an Runden/Bedenkzeit, nicht an der
   Spielerzahl — wird daher immer angezeigt. */
function forecast(){
  const n=state.players.filter(p=>!p.withdrawn).length;
  const rounds=state.num_rounds||0;
  const { base, inc }=parseTC(state.time_control);
  const games=Math.floor(n/2);
  const cap=boardCap();
  const waves = (cap>0 && games>cap) ? games/cap : 1;   // mehr Partien als Bretter -> nacheinander
  const perRound = base + inc*40/60 + 3;   // Min: Grundzeit + Inkrement(~40 Züge) + 3 Overhead
  const lo = rounds * perRound * 0.83 * waves;
  const hi = rounds * perRound * 1.12 * waves;
  const recRounds=Math.max(3, Math.ceil(Math.log2(Math.max(2,n))));
  return { n, rounds, games, cap, waves, lo, hi, recRounds };
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
  // In der Anmeldephase: Klick auf den Chip scrollt zur Anmelde-Karte
  if(state.status==="registration"){
    c.classList.add("clickable");
    c.onclick=()=>{ const t=$("#reg-anmeldung"); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); };
  } else { c.classList.remove("clickable"); c.onclick=null; }
  // Abmelden-Button im Header (nur Admin + eingeloggt)
  const lo=$("#hdrLogout");
  if(lo){
    const show = IS_ADMIN && isAdmin() && (SB_MODE || ADMIN_PASS);
    lo.style.display = show ? "" : "none";
    if(show) lo.onclick=doLogout;
  }
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
        <div class="field" style="margin:0;max-width:160px"><label>Runden${fc.n>=2?` · <span style="color:var(--accent-d)">empf. ${fc.recRounds}</span>`:""}</label>
          <select id="cfgRounds">${[3,4,5,6,7,8,9].map(n=>`<option ${n==state.num_rounds?"selected":""}>${n}</option>`).join("")}</select></div>
        <div class="field" style="margin:0;max-width:250px"><label>Bedenkzeit pro Spieler</label>
          <select id="cfgTime">${tcOptions(state.time_control)}</select></div>
      </div>
      <span class="code-hint">Format „Minuten + Sekunden je Zug" (z. B. 5 + 3 = 5 Min Grundzeit + 3 Sek pro Zug). Nur bei den <b>„… 40 Züge (FIDE)"</b>-Varianten gilt die Zeit für die ersten 40 Züge (klassische Turnierzeit).</span>
      <div class="forecast">${ic('clock')}<span>Geschätzte Dauer: <b>ca. ${fmtDur(fc.lo)} – ${fmtDur(fc.hi)}</b></span>
        <span class="fc-sub">${fc.rounds} Runden · ${fc.games} Partien · ${fc.n} Spieler${fc.waves>1?` · ⏳ ${fc.cap} Bretter → ${Math.ceil(fc.waves*10)/10}× nacheinander`:""}${fc.n>=2?` · empfohlen: <b>${fc.recRounds}</b> Runden (≈ log₂ der Teilnehmer)`:""}</span></div>
      <div class="codebox">
        <div class="field" style="margin:0;flex:1;min-width:220px"><label>Bretter — Bezeichnungen (eine pro Zeile/Komma · ${boardCap()} Bretter${boardCap()?"":" · leer = unbegrenzt"})</label>
          <textarea id="cfgBoards" rows="2" style="resize:vertical">${esc(state.board_labels||"")}</textarea></div>
        <span class="code-hint">Mehr Partien als Bretter → Rest wartet in der Warteschlange und rückt automatisch nach. <b>Leer = keine Brettnummern & keine Warteschlange</b> (alle spielen gleichzeitig).
          <label class="chk" style="display:flex;align-items:center;gap:7px;margin-top:8px;cursor:pointer"><input type="checkbox" id="cfgBeamerBoards" ${state.beamer_boards!==false?"checked":""}> Brettnummern am Beamer anzeigen</label></span>
      </div>
      <div class="modepick">
        <div class="mp-head"><span class="mp-label">Anmeldung</span>
          <div class="mp-opts">${["none","code","email"].map(m=>`<button class="mp${VMODE()===m?" on":""}" data-m="${m}" title="${esc(MODE_INFO[m].desc)}">${esc(MODE_INFO[m].label)}</button>`).join("")}</div>
        </div>
        <div class="mp-desc">${esc(MODE_INFO[VMODE()].desc)}</div>
      </div>
      ${(VMODE()==="code" && !state.qr_extern && !state.live_only)?`<div class="codebox">
        <div class="field" style="margin:0;max-width:160px"><label>Anmeldecode</label>
          <input id="cfgCode" value="${esc(state.event_code||"")}" placeholder="Code" maxlength="12" autocomplete="off"></div>
        <button class="btn ghost sm" id="btnGenCode">${ic('shuffle')} Code</button>
        <span class="code-hint">Code am Beamer zeigen — nur damit kann man sich anmelden.</span>
      </div>`:""}
      <div class="modepick">
        <div class="mp-head"><span class="mp-label">QR / Anmeldung zeigt auf</span>
          <div class="mp-opts">
            <button class="mp${(!state.qr_extern&&!state.live_only)?" on":""}" data-qr="self">Schüleransicht</button>
            <button class="mp${(state.qr_extern&&!state.live_only)?" on":""}" data-qr="extern">Externer Link</button>
            <button class="mp${state.live_only?" on":""}" data-qr="live">Spiel Live</button>
          </div>
        </div>
        <div class="mp-desc">${state.live_only?"<b>Spiel Live:</b> keine Anmeldung — QR &amp; Links zeigen nur auf die Schüler-Liveansicht (Spielplan &amp; Tabelle). Schüler bekommen trotzdem einen QR zum Teilen.":state.qr_extern?"QR &amp; Links (Beamer, Dashboard, Schülerseite) zeigen auf deinen externen Link.":"QR &amp; Links zeigen auf die Schüleransicht — Spielplan, Tabelle &amp; Anmeldung in der App."}</div>
      </div>
      ${(state.qr_extern&&!state.live_only)?`<div class="codebox">
        <div class="field" style="margin:0;flex:1;min-width:180px"><label>Externer Link — Hinweistext</label>
          <input id="cfgRegText" value="${esc(state.reg_text||"")}" placeholder="z.B. Anmeldung über Projekttage" maxlength="80"></div>
        <div class="field" style="margin:0;flex:1;min-width:180px"><label>Link (QR zeigt darauf)</label>
          <input id="cfgRegLink" value="${esc(state.reg_link||"")}" placeholder="https://…"></div>
        <span class="code-hint">Beamer & Schülerseite zeigen diesen Text + QR zum Link statt der App-Anmeldung.</span>
      </div>`:""}
      <div class="ab-actions">
        <button class="btn" id="btnStart" ${active.length<2?"disabled":""}>${ic('shuffle')} Anmeldung schließen & auslosen</button>
        <a class="btn ghost sm" href="${esc(location.origin+location.pathname+"?beamer")}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
        ${adminCommonBtns()}
      </div>
      <div class="ab-actions" style="margin-top:8px;border-top:1px dashed rgba(255,255,255,.12);padding-top:10px">
        <span class="code-hint" style="width:100%">${ic('flask')} Zum Testen vor dem Event:</span>
        <button class="btn ghost sm" id="btnDemo" title="20 Beispiel-Teilnehmer zum Ausprobieren hinzufügen.">+20 Testdaten</button>
        <button class="btn ghost sm" id="btnImport" title="Teilnehmer aus Excel/CSV laden. Erste Zeile als Überschrift, Spalten 'Vorname', 'Nachname', 'Klasse' (oder 'Name', 'Klasse'). Namen werden auf einen Vornamen gekürzt, Duplikate übersprungen.">${ic('import')} Import Excel/CSV</button>
        <button class="btn ghost sm" id="btnTemplate" title="Leere Excel-Vorlage mit den Spalten Vorname / Nachname / Klasse herunterladen (inkl. Beispielen, auch ein Lehrer).">${ic('table')} Vorlage</button>
        <button class="btn ghost sm" id="btnSim" title="Spielt ein komplettes Turnier mit Zufallsergebnissen durch — testet Auslosung, Tabelle und Pokale.">${ic('play')} Testlauf simulieren</button>
        <button class="btn ghost sm" id="btnSimTb" title="Baut ein fertiges Turnier mit echtem Gleichstand: Platz 1=2 und 3=4 (auch 5=6, 7=8) — zum Testen des Stechens. Ersetzt aktuelle Teilnehmer.">${ic('play')} Stechen-Test 2er</button>
        <button class="btn ghost sm" id="btnSimTb3" title="Baut ein fertiges Turnier mit echtem 3er-Gleichstand: Platz 1=2=3 (und 4=5=6) — zum Testen des Stechens bei drei Gleichen. Ersetzt aktuelle Teilnehmer.">${ic('play')} Stechen-Test 3er</button>
        <button class="btn ghost sm" id="btnPreviewHall" title="Test: schreibt die aktuellen Top 3 (oder Beispielnamen) als Tafel mit Jahreszahl auf die Wall of Fame — nur Vorschau, wird NICHT gespeichert. Knopf nochmal = entfernen.">${ic('trophy')} WoF-Vorschau${(state.halloffame||[]).some(e=>e._preview)?" (entf.)":""}</button>
        ${(state.champions||[]).length?`<button class="btn ghost sm" id="btnClearCup" title="Test-Gravur von den Pokalen entfernen (Wall of Fame bleibt).">${ic('trash')} Gravur löschen</button>`:""}
        ${(state.halloffame||[]).length?`<button class="btn ghost sm" id="btnClearWall" title="Gesamte Wall of Fame löschen — nur zum Aufräumen von Testdaten.">${ic('trash')} Wall of Fame leeren</button>`:""}
        <button class="btn ghost sm" id="btnImpHall" title="Wall of Fame + Pokale aus einer Excel-Export-Datei wiederherstellen (Blätter 'Ruhmeshalle' und 'Pokale').">${ic('trophy')} Pokale/Hall importieren</button>
        <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="display:none">
        <input type="file" id="impHallFile" accept=".xlsx,.xls" style="display:none">
      </div>`;
    app.appendChild(ab);
    $("#cfgName").onchange=e=>patchState({tournament_name:e.target.value||"Schachturnier"}).then(render);
    $("#cfgRounds").onchange=e=>patchState({num_rounds:+e.target.value}).then(render);
    $("#cfgTime").onchange=e=>patchState({time_control:e.target.value}).then(render);
    const cb=$("#cfgBoards"); if(cb) cb.onchange=e=>patchState({board_labels:e.target.value}).then(render);
    const bb=$("#cfgBeamerBoards"); if(bb) bb.onchange=e=>patchState({beamer_boards:e.target.checked});
    ab.querySelectorAll(".mp").forEach(b=>b.onclick=()=>{
      if(b.dataset.qr){ const v=b.dataset.qr;
        const patch = v==="live" ? {live_only:true} : v==="extern" ? {live_only:false,qr_extern:true} : {live_only:false,qr_extern:false};
        patchState(patch).then(render); return; }
      const m=b.dataset.m;
      if(m===VMODE()) return;
      if(m==="email" && !SB_MODE){ toast("E-Mail-Modus braucht Supabase"); return; }
      patchState({verify_mode:m}).then(render);
    });
    $("#btnStart").onclick=startTournament;
    const demo=$("#btnDemo"); if(demo) demo.onclick=addDemo;
    const imp=$("#btnImport"); if(imp) imp.onclick=()=>{ const f=$("#impFile"); if(f) f.click(); };
    const impF=$("#impFile"); if(impF) impF.onchange=e=>handleImportFile(e.target.files[0]);
    const tpl=$("#btnTemplate"); if(tpl) tpl.onclick=downloadTemplate;
    const ih=$("#btnImpHall"); if(ih) ih.onclick=()=>{ const f=$("#impHallFile"); if(f) f.click(); };
    const ihf=$("#impHallFile"); if(ihf) ihf.onchange=e=>importHallCups(e.target.files[0]);
    const sim=$("#btnSim"); if(sim) sim.onclick=simulateTournament;
    const simtb=$("#btnSimTb"); if(simtb) simtb.onclick=simulateStechen;
    const simtb3=$("#btnSimTb3"); if(simtb3) simtb3.onclick=simulateStechen3;
    const ph=$("#btnPreviewHall"); if(ph) ph.onclick=previewHall;
    const clr=$("#btnClearCup"); if(clr) clr.onclick=()=>clearTrophies().then(()=>render());
    const clw=$("#btnClearWall"); if(clw) clw.onclick=()=>clearHallOfFame().then(()=>render());
    const cc=$("#cfgCode"); if(cc) cc.onchange=e=>patchState({event_code:e.target.value.trim()}).then(render);
    const rt=$("#cfgRegText"); if(rt) rt.onchange=e=>patchState({reg_text:e.target.value.trim()}).then(render);
    const rl=$("#cfgRegLink"); if(rl) rl.onchange=e=>patchState({reg_link:e.target.value.trim()}).then(render);
    const gc=$("#btnGenCode"); if(gc) gc.onclick=()=>{ patchState({event_code:String(Math.floor(1000+Math.random()*9000))}).then(render); };
    wireAdminCommon();
  }

  // Schülerseite: oben CTA bzw. "Turnier startet in Kürze", dann Tipp, dann Pokale
  if(!IS_ADMIN){
    if(liveOnly()){
      const soon=document.createElement("div"); soon.className="reg-soon";
      soon.innerHTML=`${ic('clock')} <b>Turnier startet in Kürze</b>`;
      app.appendChild(soon);
    } else {
      const cta=document.createElement("a"); cta.className="btn block reg-cta"; cta.href="#reg-anmeldung";
      cta.innerHTML=ic('arrow')+" Zur Anmeldung";
      cta.onclick=e=>{ e.preventDefault(); const t=$("#reg-anmeldung"); if(t) t.scrollIntoView({behavior:"smooth",block:"start"}); };
      app.appendChild(cta);
    }
    // Tipp gleich unter "Turnier startet in Kürze"
    const clk=document.createElement("div"); clk.className="card hints";
    clk.innerHTML=`<div class="hint-row">${ic('clock')}<span><b>Tipp zur Zeitnehmung:</b> Installier dir schon mal eine <b>Schachuhr-App</b> — z.&nbsp;B. <b>Schachuhr+</b> oder die <b>Schach-Uhr von Chess.com</b>.</span></div>`;
    app.appendChild(clk);
    if(liveOnly()){
      // Teilen-QR (zeigt auf die Liveansicht)
      const share=document.createElement("div"); share.className="card"; share.id="reg-anmeldung";
      const shareUrl=regTarget();
      share.innerHTML=`<div class="eyebrow">Mitschauen</div><h2>Live mitverfolgen</h2>
        <p class="lead">Code scannen oder Link teilen — Spielplan &amp; Tabelle live am Handy.</p>
        <div class="qrbox"><div id="shareqr"></div>
          <div class="linkfield"><div class="linkrow"><input id="sharelink" readonly value="${esc(shareUrl)}"><a class="btn sm" href="${esc(shareUrl)}" target="_blank" rel="noopener">Öffnen</a></div></div></div>`;
      app.appendChild(share);
      try{ new QRCode($("#shareqr"), {text:shareUrl, width:150, height:150, colorDark:"#20211d", colorLight:"#ffffff", correctLevel:QRCode.CorrectLevel.M}); }catch(e){}
    }
    renderHall(app);
  }

  // Anmeldeformular — nur für Lehrer (Hinzufügen) oder wenn keine "Spiel Live"-Mode
  if(IS_ADMIN || !liveOnly()){
  const f=document.createElement("div"); f.className="card lg"; f.id="reg-anmeldung";
  const codeGate = (VMODE()==="code" && !(state.event_code||"").trim());

  if(useExtern() && !IS_ADMIN){
    const altLink=regTarget();
    f.innerHTML=`<div class="eyebrow">Anmeldung</div><h2>${esc(state.reg_text||"Anmeldung")}</h2>
      <p class="lead">Scanne den Code oder öffne den Link zur Anmeldung.</p>
      <div class="qrbox"><div id="altqr"></div>
        <div class="linkfield"><div class="linkrow"><input id="altlink" readonly value="${esc(altLink)}"><a class="btn sm" href="${esc(altLink)}" target="_blank" rel="noopener">Öffnen</a></div></div></div>`;
    app.appendChild(f);
    try{ new QRCode($("#altqr"), {text:altLink, width:150, height:150, colorDark:"#20211d", colorLight:"#ffffff", correctLevel:QRCode.CorrectLevel.M}); }catch(e){}
  } else if(VMODE()==="email" && !SB_MODE){
    f.innerHTML=`<div class="eyebrow">Anmeldung</div><h2>E-Mail-Bestätigung nicht verfügbar</h2>
      <p class="lead">Der E-Mail-Modus braucht Supabase. Im Lokal-Modus bitte im Admin-Panel auf <b>Offen</b> oder <b>Code</b> stellen.</p>`;
    app.appendChild(f);
  } else if(codeGate && !IS_ADMIN){
    {
      f.innerHTML=`<div class="eyebrow">Anmeldung</div><h2>Noch nicht freigeschaltet</h2>
        <p class="lead">Die Anmeldung wird gleich von der Lehrkraft freigeschaltet — der Code erscheint dann am Beamer.</p>`;
      app.appendChild(f);
    }
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
    // Admin darf einzelne Teilnehmer direkt hinzufügen (ohne Code/E-Mail)
    const needEmail=(VMODE()==="email") && !IS_ADMIN, needCode=(VMODE()==="code") && !IS_ADMIN;
    f.innerHTML=`
      <div class="eyebrow">${IS_ADMIN?"Lehrer":"Jetzt mitmachen"}</div>
      <h2>${IS_ADMIN?"Teilnehmer hinzufügen":"Zum Turnier anmelden"}</h2>
      <p class="lead">${IS_ADMIN?"Name (+ Klasse/Funktion) eintragen — die Person erscheint sofort in der Liste. Mehrere nacheinander möglich.":needEmail?"Du bekommst einen Bestätigungscode per E-Mail.":needCode?"Gib den Code vom Beamer ein, um dich anzumelden.":"Trag deinen Namen ein — du erscheinst sofort in der Liste."}</p>
      <div class="row">
        <div class="field" style="flex:2"><label>Name</label><input id="regName" placeholder="Vor- und Nachname" autocomplete="off"></div>
        <div class="field" style="flex:1"><label>Klasse / Funktion</label><input id="regKlasse" placeholder="z.B. 2AHET oder Lehrer" autocomplete="off"></div>
      </div>
      ${needEmail?`<div class="field"><label>E-Mail</label><input id="regEmail" type="email" placeholder="name@schule.at" autocomplete="email"></div>`:""}
      ${needCode?`<div class="field"><label>Anmeldecode (vom Beamer)</label><input id="regCode" inputmode="numeric" maxlength="12" placeholder="Code" autocomplete="off"></div>`:""}
      <button class="btn block" id="btnReg">${IS_ADMIN?ic('check')+" Hinzufügen":needEmail?ic('mail')+" Code anfordern":ic('check')+" Anmelden"}</button>`;
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
  }

  // Teilnehmerliste — bei externem Anmelde-Link in der Schüleransicht ausblenden
  const altReg = useExtern();
  if(!(altReg && !IS_ADMIN)){
  const l=document.createElement("div"); l.className="card";
  const list = [...state.players].sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const absent=state.players.length-active.length;
  l.innerHTML=`
    <div class="count-badge"><b>${IS_ADMIN?active.length:state.players.length}</b><span>${IS_ADMIN?"anwesend":liveOnly()?"Teilnehmer":"angemeldet"}${(IS_ADMIN&&absent>0)?` · ${absent} abwesend`:""}</span></div>
    ${IS_ADMIN&&list.length?`<div class="code-hint" style="margin:0 0 8px">Standardmäßig <b>nicht anwesend</b> — Anwesende abhaken (oder Bulk). Nur Anwesende werden ausgelost.</div>
      <div class="ab-actions" style="margin-bottom:10px">
        <button class="btn ghost sm" id="btnAllPresent">${ic('check')} Alle anwesend</button>
        <button class="btn ghost sm" id="btnAllAbsent">Alle abwesend</button>
      </div>`:""}
    <div class="players" id="plist"></div>
    ${list.length===0?'<div class="empty"><div class="ico">'+KNIGHT_SVG+'</div>Noch niemand angemeldet — sei die/der Erste!</div>':""}`;
  app.appendChild(l);
  if($("#btnAllPresent")) $("#btnAllPresent").onclick=()=>setAllPresent(true);
  if($("#btnAllAbsent"))  $("#btnAllAbsent").onclick=()=>setAllPresent(false);
  const pl=$("#plist");
  list.forEach((p,i)=>{
    const d=document.createElement("div"); d.className="pl"+((p.withdrawn&&IS_ADMIN)?" out":"");
    d.innerHTML=`<span class="idx">${i+1}</span><span class="nm">${esc(p.name)}</span>${p.verified?'<span class="vchk" title="bestätigt">✓</span>':""}${p.klasse?`<span class="kl">${esc(p.klasse)}</span>`:""}`;
    if(IS_ADMIN){
      const chk=document.createElement("label"); chk.className="pres"; chk.title=p.withdrawn?"Abwesend — Haken setzen, um auszulosen":"Anwesend (wird ausgelost)";
      chk.innerHTML=`<input type="checkbox" ${p.withdrawn?"":"checked"}><span>anw.</span>`;
      chk.querySelector("input").onchange=e=>toggleWithdrawn(p.id, !e.target.checked).then(render);
      d.appendChild(chk);
      const x=document.createElement("button"); x.className="x"; x.textContent="×"; x.title="Entfernen"; x.onclick=()=>{ removePlayer(p.id).then(render); }; d.appendChild(x);
    }
    pl.appendChild(d);
  });
  }

  if(IS_ADMIN && SB_MODE) renderQR(app);

  if(IS_ADMIN){
    const clk=document.createElement("div"); clk.className="card hints";
    clk.innerHTML=`<div class="hint-row">${ic('clock')}<span><b>Tipp zur Zeitnehmung:</b> Installier dir schon mal eine <b>Schachuhr-App</b> — z.&nbsp;B. <b>Schachuhr+</b> oder die <b>Schach-Uhr von Chess.com</b>.</span></div>`;
    app.appendChild(clk);
  }

  // Schweizer System erklärt (aufklappbar) — vor allem für Neulinge
  const info=document.createElement("details"); info.className="card swiss-reg";
  info.innerHTML=`<summary>${ic('info')} <b>Wie läuft das Turnier?</b> — Schweizer System einfach erklärt</summary>
    <div style="margin-top:14px">${swissInfoHTML()}</div>`;
  app.appendChild(info);

  // Beim Admin bleibt die Halle unten (Schüler haben sie oben)
  if(IS_ADMIN) renderHall(app);
}

/* Sicherheits-Reset: Rückfrage, dann alles löschen (Pokale + Wall of Fame bleiben). */
function confirmReset(extraWarn){
  const msg=(extraWarn?extraWarn+"\n\n":"")+"Neues Turnier starten?\nTeilnehmer & Spielplan werden gelöscht (Pokale und Wall of Fame bleiben).";
  if(confirm(msg)){ resetAll().then(()=>{ ui.tab="plan"; ui.viewRound=0; render(); }); }
}

/* ---------- TURNIER LÄUFT ---------- */
function renderRunning(app){
  if(IS_ADMIN) renderAdminBarRunning(app);

  if(state.paused){
    const pb=document.createElement("div"); pb.className="pausebanner";
    pb.innerHTML=`${ic('clock')} <b>Spielpause</b> — ${esc((state.pause_text||"").trim()||"gleich geht's weiter")}`;
    app.appendChild(pb);
  }

  const hints=document.createElement("div"); hints.className="card hints";
  hints.innerHTML=`<div class="hint-row">${ic('clock')}<span><b>Zeitnehmung:</b> bitte eine Schachuhr-App verwenden — z.&nbsp;B. <b>Schachuhr+</b> oder die <b>Schach-Uhr von Chess.com</b>.</span></div>
    <div class="hint-row">${ic('reset')}<span><b>Nach jeder Partie</b> bitte die Figuren wieder aufstellen.</span></div>`;
  app.appendChild(hints);

  const tabs=document.createElement("div"); tabs.className="tabs";
  tabs.innerHTML=`
    <button class="${ui.tab==="plan"?"on":""}" data-t="plan">${ic('clipboard')} Spielplan</button>
    <button class="${ui.tab==="table"?"on":""}" data-t="table">${ic('table')} Tabelle</button>
    <button class="${ui.tab==="hall"?"on":""}" data-t="hall">${ic('trophy')} Pokale</button>
    <button class="${ui.tab==="info"?"on":""}" data-t="info">${ic('info')} Info</button>`;
  app.appendChild(tabs);
  tabs.querySelectorAll("button").forEach(b=>b.onclick=()=>{ ui.tab=b.dataset.t; render(); });

  if(ui.tab==="plan") renderPlan(app);
  else if(ui.tab==="hall") renderHall(app);
  else if(ui.tab==="info") renderInfo(app);
  else renderTable(app, false);

  if(IS_ADMIN){
    const nc=document.createElement("div"); nc.className="card";
    nc.innerHTML=`<div class="eyebrow">${ic('teacher')} Nachzügler aufnehmen</div>
      <p class="lead" style="margin:6px 0 10px">Kommt jemand später dazu? Hier aufnehmen — er/sie spielt ab der <b>nächsten Auslosung</b> mit (startet mit 0 Punkten). Wer schon angemeldet war, kann auch oben in der <b>Tabelle</b> per <b>„Aufnehmen"</b> reaktiviert werden.</p>
      <div class="row">
        <div class="field" style="flex:2;margin:0"><input id="lateName" placeholder="Vor- und Nachname" autocomplete="off"></div>
        <div class="field" style="flex:1;margin:0"><input id="lateKlasse" placeholder="Klasse / Funktion" autocomplete="off"></div>
        <button class="btn sm" id="btnLate" style="flex:none">${ic('check')} Aufnehmen</button>
      </div>`;
    app.appendChild(nc);
    const addLate=async()=>{
      const n=($("#lateName").value||"").trim(); if(n.length<2){ toast("Bitte Namen eingeben"); return; }
      await addPlayer(n, ($("#lateKlasse").value||"").trim(), {present:true});
      $("#lateName").value=""; $("#lateKlasse").value=""; $("#lateName").focus();
      toast("Aufgenommen — spielt ab der nächsten Runde ✓"); render();
    };
    $("#btnLate").onclick=addLate;
    const lk=$("#lateKlasse"); if(lk) lk.onkeydown=e=>{ if(e.key==="Enter") addLate(); };
  }
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
      <button class="btn ghost sm" id="btnPause">${state.paused?ic('play')+" Weiter spielen":ic('clock')+" Spielpause"}</button>
      ${state.paused?`<input id="cfgPauseText" class="bd-in" style="min-width:220px;flex:1" placeholder="Pausentext (optional), z.B. Mittagspause bis 13:00" value="${esc(state.pause_text||"")}">`:""}
      <a class="btn ghost sm" href="${esc(location.origin+location.pathname+"?beamer")}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
      ${adminCommonBtns()}
      <button class="btn danger sm" id="btnReset" title="Laufendes Turnier abbrechen und von vorne beginnen.">${ic('reset')} Turnier neu starten</button>
    </div>`;
  app.appendChild(ab);
  if($("#btnNext")) $("#btnNext").onclick=nextRound;
  if($("#btnFin"))  $("#btnFin").onclick=finishTournament;
  if($("#btnRe"))   $("#btnRe").onclick=()=>regeneratePairings(cur);
  if($("#btnPause"))$("#btnPause").onclick=()=>patchState({paused:!state.paused}).then(render);
  if($("#cfgPauseText"))$("#cfgPauseText").onchange=e=>patchState({pause_text:e.target.value}).then(render);
  if($("#btnReset"))$("#btnReset").onclick=()=>confirmReset("Das laufende Turnier wird ABGEBROCHEN.");
  wireAdminCommon();
}
function renderPlan(app){
  // Neues Turnier/neue Simulation (Runde sinkt) -> Zähler zurücksetzen
  if((ui._maxRound||0) > state.current_round){ ui._maxRound=0; ui.viewRound=0; }
  // Neue Runde gestartet? Wer auf der bisher letzten Runde war, geht automatisch mit (Live-Folgen).
  const prevMax = ui._maxRound||0;
  if(state.current_round > prevMax){
    if(!ui.viewRound || ui.viewRound===prevMax) ui.viewRound=state.current_round;
    ui._maxRound = state.current_round;
  }
  if(!ui.viewRound || ui.viewRound>state.current_round) ui.viewRound=state.current_round;
  const card=document.createElement("div"); card.className="card";
  card.innerHTML=`<div class="roundpick"><span class="eyebrow" style="margin:0">Runde anzeigen</span>
    <select id="rsel">${Array.from({length:state.current_round},(_,i)=>i+1).map(r=>`<option value="${r}" ${r===ui.viewRound?"selected":""}>Runde ${r}</option>`).join("")}</select></div>`;
  app.appendChild(card);
  $("#rsel").onchange=e=>{ ui.viewRound=+e.target.value; render(); };

  const labels=boardLabels();
  if(IS_ADMIN && labels.length){
    const dl=document.createElement("datalist"); dl.id="boardlist";
    dl.innerHTML=labels.map(l=>`<option value="${esc(l)}"></option>`).join("");
    card.appendChild(dl);
  }
  const allp=state.pairings.filter(p=>p.round===ui.viewRound);
  const waiting=allp.filter(p=>p.active===false && !p.result && p.black_id!=null);
  const playing=allp.filter(p=>!(p.active===false && !p.result)).sort((a,b)=>(a.board||0)-(b.board||0));

  playing.forEach(p=>{
    const el=document.createElement("div"); el.className="pair";
    if(p.black_id===null||p.black_id===undefined){
      el.classList.add("byecard");
      el.innerHTML=`<span class="bno">–</span><div class="side"><div class="nm">${esc(nm(p.white_id))}</div><div class="kl">${esc(kl(p.white_id))}</div></div><span class="byetag">Freilos · 1 Punkt</span>`;
      card.appendChild(el); return;
    }
    const res=p.result;
    const bno = p.board_label ? `<span class="bno labeled">${esc(p.board_label)}</span>` : "";
    el.innerHTML=`${bno}
      <div class="side"><div class="nm">${esc(nm(p.white_id))}</div><div class="kl">${esc(kl(p.white_id))}</div></div>
      <span class="dot w" title="Weiß"></span>
      <span class="vs">vs</span>
      <span class="dot b" title="Schwarz"></span>
      <div class="side right"><div class="nm">${esc(nm(p.black_id))}</div><div class="kl">${esc(kl(p.black_id))}</div></div>`;
    if(IS_ADMIN){
      const rc=document.createElement("div"); rc.className="res";
      let bdInput=null;
      if(labels.length){
        bdInput=document.createElement("input"); bdInput.className="bd-in"; bdInput.placeholder="Brett"; bdInput.setAttribute("list","boardlist"); bdInput.value=p.board_label||"";
        bdInput.title="Brett (wird beim Ergebnis frei für das nächste Paar)";
        bdInput.onchange=()=>setBoardLabel(p.id, bdInput.value).then(render);
        rc.appendChild(bdInput);
      }
      [["1-0","1:0"],["draw","½"],["0-1","0:1"]].forEach(([v,lbl])=>{
        const b=document.createElement("button"); b.textContent=lbl; if(res===v) b.classList.add("on");
        b.onclick=()=>{ setResult(p.id, res===v?null:v, bdInput?bdInput.value:"").then(render); };
        rc.appendChild(b);
      });
      el.appendChild(rc);
    }else{
      const rv=document.createElement("div"); rv.className="resview"+(res?"":" pending");
      rv.textContent = res==="1-0"?"1 : 0" : res==="0-1"?"0 : 1" : res==="draw"?"½ : ½" : (p.board_label?("▶ "+p.board_label):"läuft");
      el.appendChild(rv);
    }
    card.appendChild(el);
  });

  if(waiting.length){
    const wc=document.createElement("div"); wc.className="card waitcard";
    wc.innerHTML=`<div class="eyebrow">⏳ Warteschlange · ${waiting.length} ${waiting.length===1?"Paarung":"Paarungen"}</div>
      <p class="lead" style="margin-bottom:10px">Ihr seid gleich dran — spielt, sobald ein Brett frei wird${IS_ADMIN?` (oder per <b>spielt</b> sofort freigeben).`:`.`}</p>`;
    app.appendChild(wc);
    waiting.forEach((p,i)=>{
      const el=document.createElement("div"); el.className="pair waiting";
      el.innerHTML=`<span class="bno wait">${i+1}</span>
        <div class="side"><div class="nm">${esc(nm(p.white_id))}</div><div class="kl">${esc(kl(p.white_id))}</div></div>
        <span class="vs">vs</span>
        <div class="side right"><div class="nm">${esc(nm(p.black_id))}</div><div class="kl">${esc(kl(p.black_id))}</div></div>
        ${(!IS_ADMIN&&p.board_label)?`<span class="bno labeled">${esc(p.board_label)}</span>`:""}`;
      if(IS_ADMIN){
        const wrap=document.createElement("div"); wrap.className="res";
        if(labels.length){
          const bi=document.createElement("input"); bi.className="bd-in"; bi.placeholder="Brett"; bi.setAttribute("list","boardlist"); bi.value=p.board_label||"";
          bi.title="Brett vorab zuweisen (optional)"; bi.onchange=()=>setBoardLabel(p.id, bi.value).then(render);
          wrap.appendChild(bi);
        }
        const b=document.createElement("button"); b.className="btn ghost sm"; b.textContent="spielt"; b.title="Jetzt aktiv setzen"; b.onclick=()=>activatePairing(p.id);
        wrap.appendChild(b); el.appendChild(wrap);
      }
      wc.appendChild(el);
    });
  }
}

/* ---------- TABELLE ---------- */
function renderTable(app, finalMode){
  const st=standingsView();
  const canEdit = IS_ADMIN && state.status==="running";   // Aussteiger
  const canTb   = IS_ADMIN && state.status==="finished";   // Stechen
  const tied=new Set();
  if(canTb) st.forEach((s,i)=>{ if(st.some((o,j)=>i!==j && s.points===o.points)) tied.add(s.id); });
  const card=document.createElement("div"); card.className="card";
  card.innerHTML=`<h2 style="margin-bottom:14px">${finalMode?"Endstand":"Zwischenstand"}</h2>
    ${(canTb&&tied.size)?'<div class="code-hint" style="margin:-6px 0 12px">Bei <b>Punktgleichheit</b> kannst du ein <b>Stechen</b> (Blitzpartie) spielen lassen und den Sieger mit <b>„Stechen ↑"</b> nach vorne setzen — das überschreibt die Buchholz-Reihung. Sonst entscheidet automatisch Buchholz.</div>':""}
    <table class="tbl"><thead><tr><th>#</th><th>Name</th><th>Kl.</th><th style="text-align:right">Pkt</th><th style="text-align:right">Buchh.</th>${(canEdit||canTb)?"<th></th>":""}</tr></thead><tbody id="tb"></tbody></table>`;
  app.appendChild(card);
  const tb=$("#tb");
  st.forEach((s,i)=>{
    const tr=document.createElement("tr");
    if(i===0) tr.className="top1"; else if(i===1) tr.className="top2"; else if(i===2) tr.className="top3";
    if(s.withdrawn) tr.classList.add("out");
    if(canTb) tr.title=`Sonneborn-Berger ${fmt(s.sonn)} · Siege ${s.wins}`;
    tr.innerHTML=`<td class="rk">${i+1}</td><td class="nm">${esc(s.name)}${s.withdrawn?' <span class="kl">· ausgestiegen</span>':""}</td><td class="kl">${esc(s.klasse||"")}</td>
      <td class="pts">${fmt(s.points)}</td><td class="bz">${fmt(s.buch)}</td>`;
    if(canEdit){
      const td=document.createElement("td"); td.style.textAlign="right";
      const b=document.createElement("button"); b.className="btn ghost sm";
      b.textContent = s.withdrawn ? "Aufnehmen" : "Aussteiger";
      b.title = s.withdrawn ? "Wieder mitspielen lassen" : "Steigt aus — wird ab nächster Runde nicht mehr ausgelost (Punkte bleiben)";
      b.onclick=()=>toggleWithdrawn(s.id, !s.withdrawn).then(()=>{ toast(s.withdrawn?"Wieder dabei ✓":"Ausgestiegen — ab nächster Runde nicht mehr ausgelost"); render(); });
      td.appendChild(b); tr.appendChild(td);
    } else if(canTb){
      const td=document.createElement("td"); td.style.textAlign="right";
      if(tied.has(s.id)){
        const b=document.createElement("button"); b.className="btn ghost sm"; b.textContent="Stechen ↑";
        b.title="Sieger des Stechens — bei Gleichstand nach vorne (nochmal klicken = zurücksetzen)";
        b.onclick=()=>tiebreakWinner(s.id);
        td.appendChild(b);
      }
      tr.appendChild(td);
    }
    tb.appendChild(tr);
  });
  if(st.length===0) tb.innerHTML=`<tr><td colspan="${(canEdit||canTb)?6:5}"><div class="empty">Noch keine Ergebnisse</div></td></tr>`;
}

/* ---------- ENDE ---------- */
function renderFinished(app){
  const beamer=location.origin+location.pathname+"?beamer";
  if(IS_ADMIN){
    const ab=document.createElement("div"); ab.className="adminbar";
    ab.innerHTML=`<div class="ab-top">${ic('teacher')}Turnier beendet <span class="lk">${esc(state.time_control)} · ${state.num_rounds} Runden</span></div>
      <div class="codebox" style="margin-bottom:10px"><div class="field" style="margin:0;flex:1;min-width:200px"><label>Turniername (für Urkunden & Pokale)</label>
        <input id="cfgNameFin" value="${esc(state.tournament_name||'')}" placeholder="z.B. Schachturnier HTL1-Lastenstraße 2026"></div></div>
      <div class="ab-actions">
        ${state.awarded?`<span class="ab-note">${ic('checkCircle')} Pokale graviert</span>`:`<button class="btn" id="btnAward">${ic('trophy')} Pokale gravieren (Top 3)</button>`}
        ${(state.champions||[]).length?`<button class="btn ghost sm" id="btnCert" title="Urkunden für die Top 3 (Schullogo, Pokal, Name, Klasse, Datum) als druckbare PDF öffnen.">${ic('table')} Urkunden (PDF)</button>`:""}
        ${(state.champions||[]).length?`<button class="btn ghost sm" id="btnClearCup" title="Gravur von den Pokalen entfernen (z.B. nach einem Test). Wall of Fame bleibt.">${ic('trash')} Gravur löschen</button>`:""}
        <button class="btn ghost sm" id="btnPreviewHall" title="Test: schreibt die aktuellen Top 3 als Tafel mit Jahreszahl auf die Wall of Fame — nur Vorschau, wird NICHT gespeichert. Knopf nochmal = entfernen.">${ic('trophy')} WoF-Vorschau${(state.halloffame||[]).some(e=>e._preview)?" (entf.)":""}</button>
        <a class="btn ghost sm" href="${esc(beamer)}" target="_blank" rel="noopener">${ic('monitor')} Beamer</a>
        <button class="btn danger sm" id="btnReset">${ic('reset')} Neues Turnier</button>
        ${adminCommonBtns()}
      </div>
      ${state.awarded?"":'<div class="ab-hint">Bisherige Pokal-Inhaber wandern dabei in die Wall of Fame, die neuen Top 3 kommen auf die Pokale.</div>'}`;
    app.appendChild(ab);
    if($("#cfgNameFin")) $("#cfgNameFin").onchange=e=>patchState({tournament_name:e.target.value||"Schachturnier"}).then(render);
    if($("#btnAward")) $("#btnAward").onclick=awardTrophies;
    if($("#btnCert")) $("#btnCert").onclick=printCertificates;
    if($("#btnClearCup")) $("#btnClearCup").onclick=()=>clearTrophies().then(()=>render());
    if($("#btnPreviewHall")) $("#btnPreviewHall").onclick=previewHall;
    $("#btnReset").onclick=()=>confirmReset();
    wireAdminCommon();
  }

  const lb=document.createElement("div"); lb.className="card hints";
  lb.innerHTML=`<div class="hint-row">${ic('flag')}<span><b>Danke fürs Mitspielen!</b> Bitte alle <b>Bretter aufgebaut stehen lassen</b> — Figuren in Grundstellung.</span></div>`;
  app.appendChild(lb);

  const st=standingsView();
  if(st.length>=1){
    const awarded = state.awarded && (state.champions||[]).length;
    const champs = state.champions||[];   // nur echte Gravur (Gravur löschen leert die Pokale)
    const card=document.createElement("div"); card.className="card lg";
    card.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('trophy')} Siegerehrung</div>
      <h2 style="text-align:center;margin-bottom:6px">${esc(state.tournament_name)}${awarded?` · ${esc(fmtDate(state.champions[0].date))}`:""}</h2>`;
    app.appendChild(card);
    renderTrophies(card, champs);
  }
  renderTable(app, true);
  renderWall(app);
}

/* ---------- POKALE / RUHMESHALLE ---------- */
/* Name 2-zeilig: Vorname (Zeile 1) / Nachname(n) (Zeile 2) */
function plName(s){ const p=esc((s||"").trim()).split(/\s+/); return p.length<2 ? (p[0]||"") : p[0]+"<br>"+p.slice(1).join(" "); }
/* Aktuelle Top 3 als Pokal-Belegung (live, während/nach dem Turnier) */
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
  // Auto-Anpassung: längste Zeile füllt die Plakettenbreite (große Gravur)
  const words=(champ&&champ.name?champ.name.trim().split(/\s+/):["frei"]);
  const longest=words.reduce((m,w)=>Math.max(m,w.length),0)||4;
  const fit= Math.min(1.15, 7.2/Math.max(5,longest));
  return `<figure class="trophy t${rank}">
    <div class="trophy-img" style="--plate-top:${top};--plate-left:${left};--plate-rot:${rot};--plate-w:${wpc}">
      <img src="${esc(img)}" alt="Pokal ${rank}. Platz" onerror="this.style.display='none';this.closest('.trophy-img').classList.add('fallback');this.parentNode.querySelector('.trophy-svg').style.display='block';">
      <div class="trophy-svg" style="display:none">${cupSVG(rank)}</div>
      <div class="plaque plaque-${style}${champ?"":" empty"}" style="--fit:${fit}">
        <span class="pl-name">${champ?plName(champ.name):"frei"}</span>
        ${champ&&champ.klasse?`<span class="pl-kl">${esc(champ.klasse)}</span>`:""}
      </div>
    </div>
    <figcaption class="trophy-cap">${rank}. Platz</figcaption>
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
      const list=groups[k].sort((a,b)=>a.rank-b.rank).slice(0,3);
      html+=`<div class="legend-plate" title="${esc(name||"Turnier")}">
        ${IS_ADMIN?`<button class="lp-del" data-d="${esc(date)}" data-t="${esc(name)}" title="Diese Tafel löschen">✕</button>`:""}
        <div class="lp-year">— ${esc(yr)} —</div>
        <ol class="lp-podium">${list.map(e=>`<li class="lp-p${e.rank}">
          <span class="lp-pc">${RANK_PIECE[e.rank-1]||"•"}</span>
          <span class="lp-txt"><span class="lp-nm">${esc(e.name)}</span>${e.klasse?`<span class="lp-kl">${esc(e.klasse)}</span>`:""}</span></li>`).join("")}</ol>
      </div>`;
    });
    html+=`</div>`;
  }
  card.innerHTML=html; container.appendChild(card);
  if(IS_ADMIN) card.querySelectorAll(".lp-del").forEach(b=>b.onclick=()=>deleteHallGroup(b.dataset.d, b.dataset.t));
}
function renderHall(container){
  const running = state.status==="running";
  // Im laufenden Turnier bleiben die Pokale LEER (werden erst am Ende graviert)
  const champs = running ? [] : state.champions;
  const hasCh=(champs||[]).length>0;
  const card=document.createElement("div"); card.className="card lg";
  const h2 = (running||!hasCh) ? "Pokale warten auf ihre Sieger" : "Amtierende Titelverteidiger";
  const lead = running ? "Entschieden wird's am Ende — dann werden die Top 3 hier eingraviert."
    : (hasCh?`${esc(state.champions[0].tournament||"")} · ${esc(fmtDate(state.champions[0].date))}`:"Die Top 3 dieses Turniers werden hier eingraviert.");
  card.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('trophy')} ${running?"Pokale":"Ruhmeshalle"}</div>
    <h2 style="text-align:center;margin-bottom:4px">${h2}</h2>
    <p class="lead" style="text-align:center">${lead}</p>`;
  container.appendChild(card);
  renderTrophies(card, champs);
  // Tafel der Top 3 (Name + Klasse) — direkt unter den Pokalen
  if(hasCh){
    const sorted=[...champs].sort((a,b)=>a.rank-b.rank);
    const t=document.createElement("div"); t.className="card podium-card";
    t.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('trophy')} Siegertafel</div>
      <table class="podium-tbl"><tbody>${sorted.map(c=>`<tr class="pr${c.rank}">
        <td class="pr-r"><span class="pr-pc">${RANK_PIECE[c.rank-1]||"•"}</span>${c.rank}.</td><td class="pr-n">${esc(c.name)}</td><td class="pr-k">${esc(c.klasse||"")}</td></tr>`).join("")}</tbody></table>`;
    container.appendChild(t);
  }
  renderWall(container);
}
/* Urkunden (Top 3) als druckbare A4-Quer-Seiten -> Druckdialog -> "Als PDF speichern". */
function printCertificates(){
  const champs=[...(state.champions||[])].sort((a,b)=>a.rank-b.rank);
  if(!champs.length){ toast("Erst 'Pokale gravieren' — dann gibt es Urkunden"); return; }
  const base=new URL('./',location.href).href;
  const logo=base+'assets/logo.png';
  const seal=base+'assets/logo-htl1.svg';
  const tname=esc(state.tournament_name||'Schachturnier');
  const place=['1. Platz','2. Platz','3. Platz'];
  const cards=champs.map(c=>{
    const trophy=base+(TROPHY_CONFIG.images[c.rank-1]||'');
    const datum=esc(fmtDate(c.date)||'');
    const rw=place[c.rank-1]||(c.rank+'. Platz');
    const parts=(c.name||'').trim().split(/\s+/);
    const vor=esc(parts[0]||''); const nach=esc(parts.slice(1).join(' '));
    return `<section class="cert"><div class="frame">
      <div class="c-head">
        <img class="logo" src="${logo}" onerror="this.style.display='none'">
        <div class="org">${tname}</div>
        <div class="rule">${RANK_PIECE[c.rank-1]||'♞'}</div>
        <div class="title">Urkunde</div>
      </div>
      <div class="c-body">
        <img class="cup" src="${trophy}" onerror="this.style.display='none'">
        <div class="rank rank${c.rank}">${rw}</div>
        <div class="grats">Herzliche Gratulation!</div>
        <div class="for">Diese Urkunde wird verliehen an</div>
        <div class="name">${vor}${nach?`<span class="nachname">${nach}</span>`:''}</div>
        ${c.klasse?`<div class="kl">${/^\d/.test((c.klasse||'').trim())?'Klasse '+esc(c.klasse):esc(c.klasse)}</div>`:''}
        <p class="body">Für kluge Züge, ruhige Nerven und taktisches Können –<br>zum <b>${rw}</b> beim<br><span class="b-tit">${tname}</span></p>
      </div>
      <div class="c-foot">
        ${datum?`<div class="meta">${datum}</div>`:''}
        <div class="sig"><span>Turnierleitung</span></div>
        <img class="seal" src="${seal}" onerror="this.style.display='none'">
      </div>
    </div></section>`;
  }).join('');
  const css=`*{margin:0;padding:0;box-sizing:border-box}@page{size:A4 portrait;margin:0}
    html,body{height:100%;margin:0;padding:0}
    body{font-family:"EB Garamond",Georgia,serif;color:#3a2e12;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cert{min-height:100%;display:flex;align-items:center;justify-content:center;page-break-after:always}
    .cert:last-child{page-break-after:auto}
    .frame{width:194mm;min-height:238mm;border:1mm solid #b8893f;border-radius:3mm;
      box-shadow:inset 0 0 0 .5mm #d8b974,inset 0 0 0 2mm #fffdf7,inset 0 0 0 2.4mm #e7cf95;
      background:radial-gradient(135% 78% at 50% 0,#fffdf7 0,#f7eed6 100%);
      display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:13mm 18mm}
    .c-head,.c-body,.c-foot{display:flex;flex-direction:column;align-items:center;width:100%}
    .c-foot{gap:4.5mm}
    .logo{height:17mm;width:auto;margin-bottom:1.5mm}
    .org{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:4.3mm;letter-spacing:.1em;color:#7a5a22;text-transform:uppercase;line-height:1.2}
    .rule{display:flex;align-items:center;justify-content:center;gap:4mm;width:46%;margin:2.5mm 0 .5mm;color:#bd9a52;font-size:5mm}
    .rule::before,.rule::after{content:"";flex:1;height:.3mm;background:#cdab64}
    .title{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:17mm;letter-spacing:.04em;color:#9a6f29;line-height:1;margin:.5mm 0 0}
    .cup{height:37mm;width:auto;margin:2.5mm 0 2mm}
    .rank{font-family:"Bricolage Grotesque",sans-serif;font-weight:800;font-size:5.6mm;letter-spacing:.05em;padding:1.3mm 9mm;border-radius:30mm;color:#fff}
    .rank1{background:linear-gradient(90deg,#caa24a,#a87f2f)}.rank2{background:linear-gradient(90deg,#9aa0a8,#777d86)}.rank3{background:linear-gradient(90deg,#c08a52,#9c6a39)}
    .grats{font-family:"Playfair Display",Georgia,serif;font-style:italic;font-size:7mm;color:#7a5414;margin:4mm 0 .5mm}
    .for{font-size:4mm;color:#8a7536;letter-spacing:.03em}
    .name{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:14mm;color:#241905;line-height:1.02;margin:1.5mm 0 .5mm}
    .name .nachname{display:block;font-size:7mm;font-weight:700;color:#3a2a08;line-height:1.05;margin-top:.3mm}
    .kl{font-size:4.6mm;color:#7a5a22;font-weight:600;letter-spacing:.02em}
    .body{font-size:4.1mm;line-height:1.55;color:#4a3c1c;max-width:140mm;margin:5mm auto 0}
    .body .b-tit{font-family:"Bricolage Grotesque",sans-serif;font-weight:700;color:#7a5414;letter-spacing:.01em}
    .meta{font-family:"Bricolage Grotesque",sans-serif;font-size:3.8mm;color:#6a5a2a;margin-bottom:1mm;letter-spacing:.04em}
    .sig span{display:block;border-top:.4mm solid #b8893f;padding-top:1.8mm;width:64mm;font-size:3.6mm;color:#6a5a2a;text-align:center}
    .seal{height:15mm;width:auto;opacity:.5}`;
  const w=window.open('','_blank');
  if(!w){ toast("Bitte Pop-ups erlauben, um die Urkunden zu öffnen"); return; }
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Urkunden – ${tname}</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;1,600&family=EB+Garamond:wght@400;500&family=Bricolage+Grotesque:wght@600;800&display=swap" rel="stylesheet">
    <style>${css}</style></head><body>${cards}
    <scr`+`ipt>window.onload=function(){setTimeout(function(){window.print();},500);};</scr`+`ipt></body></html>`);
  w.document.close();
}
/* Schweizer System — einfache Erklärung (Schüler-Info) */
function swissInfoHTML(){
  return `<p class="lead" style="text-align:center;margin-bottom:16px"><b>Niemand scheidet aus.</b> Alle spielen gleich viele Runden — und du triffst immer auf jemanden, der bisher <b>ähnlich gut</b> war.</p>
    <div class="swiss-pts"><span><b>Sieg</b> 1</span><span><b>Remis</b> ½</span><span><b>Niederlage</b> 0</span><span><b>Freilos</b> 1</span></div>
    <ol class="swiss-steps">
      <li><b>Runde für Runde:</b> Nach jeder Runde werden alle nach Punkten sortiert. Dann gilt <b>Gleich gegen Gleich</b> — Sieger spielen gegen Sieger, usw.</li>
      <li><b>Keine Revanche:</b> Zwei Spieler treffen <b>nie zweimal</b> aufeinander. Weiß/Schwarz wird über das Turnier ausgeglichen.</li>
      <li><b>Ungerade Anzahl?</b> Dann hat eine Person ein <b>Freilos</b> (1 Punkt geschenkt) — niemand bekommt zwei.</li>
      <li><b>Sieger:</b> Wer am Ende die <b>meisten Punkte</b> hat. Bei Gleichstand entscheidet die <b>Buchholz-Wertung</b> = Summe der Punkte deiner Gegner. Wer die <b>stärkeren</b> Gegner hatte, steht vorne.</li>
    </ol>
    <details class="swiss-more"><summary>Noch genauer — für Interessierte</summary>
      <ul class="swiss-detail">
        <li><b>Start völlig zufällig:</b> Runde 1 wird komplett <b>random</b> ausgelost — keine Setzliste, jeder kann auf jeden treffen.</li>
        <li><b>Freilos-Regel:</b> Das Freilos geht an den Spieler mit den <b>wenigsten Punkten</b> (am niedrigsten in der Tabelle), der noch <b>kein</b> Freilos hatte. So bekommt möglichst niemand zwei.</li>
        <li><b>Buchholz-Wertung — so wird gerechnet:</b>
          <ul class="swiss-sub">
            <li>Man zählt die <b>Endpunkte</b> (nach der letzten Runde) von <b>allen</b> deinen Gegnern zusammen — egal ob du gegen sie gewonnen oder verloren hast.</li>
            <li>Es zählen die <b>Schlusspunkte</b> der Gegner, nicht die zum Zeitpunkt eurer Partie.</li>
            <li><b>Höhere</b> Buchholz = du hattest die <b>stärkeren</b> Gegner → bei Punktgleichheit stehst du <b>vorne</b>.</li>
            <li>Ein <b>Freilos</b> hat keinen Gegner und zählt <b>0</b> — deshalb ist ein Freilos im Tiebreak leicht nachteilig.</li>
          </ul>
          <div class="swiss-ex"><b>Beispiel</b> — Anna und Ben haben je <b>4 Punkte</b>:<br>
            Anna: Gegner mit 5 · 4 · 3 · 2 · 1 → Buchholz = 5+4+3+2+1 = <b>15</b><br>
            Ben: Gegner mit 3 · 3 · 2 · 2 · 1 → Buchholz = 3+3+2+2+1 = <b>11</b><br>
            → <b>Anna</b> steht vorne, weil sie gegen stärkere Gegner gespielt hat.</div>
        </li>
        <li><b>Warum Buchholz?</b> Sie belohnt den <b>härteren Weg</b>: gleich viele Punkte gegen <b>starke</b> Gegner ist mehr wert als gegen schwache.</li>
        <li><b>Reihenfolge bei Gleichstand:</b> Punkte → Buchholz → <b>Sonneborn-Berger</b> → <b>Anzahl Siege</b>. Ist <b>alles</b> gleich, entscheidet ein <b>Stechen</b> (kurze Blitzpartie).</li>
        <li><b>Sonneborn-Berger</b> ist wie Buchholz, gewichtet aber nach deinem Ergebnis: <b>voller</b> Gegnerwert bei Sieg, <b>halber</b> bei Remis, <b>nichts</b> bei Niederlage.</li>
      </ul>
    </details>
    <p class="lead" style="text-align:center;margin-top:14px">💡 Das Schöne: Auch nach einer Niederlage <b>spielst du weiter</b> — gegen ähnlich starke Gegner. So bleibt's für alle spannend und fair.</p>`;
}
function renderInfo(app){
  const card=document.createElement("div"); card.className="card lg";
  card.innerHTML=`<div class="eyebrow" style="text-align:center">${ic('info')} So funktioniert's</div>
    <h2 style="text-align:center;margin-bottom:6px">Schweizer System — kurz erklärt</h2>${swissInfoHTML()}`;
  app.appendChild(card);
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
    panels=["joinhall"];               // QR + Pokale zusammen auf einer Seite
  }else if(state.status==="running"){
    panels = state.paused ? ["pause"] : ["pairings","standings"];   // Pause-Screen oder Plan/Reihung
  }else{
    panels = stechenGroups().length ? ["stechen"] : ["sieger"];   // erst Stechen, danach Pokale/Endstand
  }
  const panel = panels[ui.beamerIdx % panels.length];
  let body="";
  let bmQrTarget=location.origin+location.pathname;

  if(panel==="pause"){
    const done=state.current_round>=state.num_rounds;
    const sub=(state.pause_text||"").trim() || (done?"Gleich folgt die Siegerehrung.":`Gleich geht's weiter — Runde ${state.current_round} von ${state.num_rounds}`);
    body=`<div class="bm-pause">
      <div class="bm-pause-big">${ic('clock')} Spielpause</div>
      <div class="bm-pause-sub">${esc(sub)}</div>
    </div>`;
  }
  else if(panel==="joinhall"){
    const active=state.players.filter(p=>!p.withdrawn);
    const codeSet = (VMODE()==="code" && (state.event_code||"").trim() && !useExtern() && !liveOnly());
    const altLink = useExtern() ? regTarget() : "";
    bmQrTarget = regTarget();
    const cap = altLink ? esc(state.reg_text||"Zur Anmeldung")
              : liveOnly() ? "Handy-Kamera drauf halten<br>& live mitverfolgen"
              : "Handy-Kamera drauf halten<br>& anmelden";
    body=`<div class="bm-joinhall">
      <div class="bm-jh-left">
        <div class="bm-qr"><div id="bmqr"></div><div class="bm-qrcap">${cap}</div><div class="bm-qrlink">${esc(linkLabel(bmQrTarget))}</div></div>
        ${codeSet?`<div class="bm-code">Anmeldecode <b>${esc(state.event_code)}</b></div>`:""}
        ${altLink?"":`<div class="bm-count"><b>${state.players.length}</b> ${liveOnly()?"Teilnehmer":"angemeldet"}</div>`}
      </div>
      <div class="bm-jh-right">
        <div class="bm-section-title">${ic('trophy')} Titelverteidiger</div>
        <div id="bmtrophies"></div>
      </div></div>`;
  }
  else if(panel==="pairings"){
    const allp=state.pairings.filter(p=>p.round===state.current_round);
    const waiting=allp.filter(p=>p.active===false && !p.result && p.black_id!=null);
    const playing=allp.filter(p=>!(p.active===false && !p.result)).sort((a,b)=>(a.board||0)-(b.board||0));
    const cols = playing.length>12 ? 3 : 2;
    const rows = Math.ceil(playing.length/cols);
    const pscale = rows<=5?1 : rows<=6?0.9 : rows<=7?0.8 : rows<=8?0.7 : rows<=10?0.6 : 0.52;
    body=`<div class="bm-section-title">${ic('clipboard')} Spielplan · Runde ${state.current_round}</div>
      <div class="bm-pairgrid" style="grid-template-columns:repeat(${cols},1fr);--pscale:${pscale}">${playing.map(p=>{
        const showBd = state.beamer_boards!==false && p.board_label;
        if(p.black_id==null) return `<div class="bm-pair bye"><span class="bm-pn">${esc(nm(p.white_id))}</span><span class="bm-bye">Freilos</span></div>`;
        const res=p.result==="1-0"?"1 : 0":p.result==="0-1"?"0 : 1":p.result==="draw"?"½ : ½":"–";
        return `<div class="bm-pair${p.result?" done":""}">${showBd?`<span class="bm-bd lab">${esc(p.board_label)}</span>`:""}<span class="bm-pn">${esc(nm(p.white_id))}</span><span class="bm-res">${res}</span><span class="bm-pn r">${esc(nm(p.black_id))}</span></div>`;
      }).join("")}</div>
      ${waiting.length?`<div class="bm-wait"><span class="bm-wait-t">⏳ Warteschlange</span>${waiting.map((p,i)=>`<span class="bm-wchip"><b>${i+1}.</b> ${esc(nm(p.white_id))} – ${esc(nm(p.black_id))}</span>`).join("")}</div>`:""}`;
  }
  else if(panel==="stechen"){
    const st=standingsView();
    const groups=stechenGroups();
    const psc = groups.length>3?0.8:1;
    body=`<div class="bm-section-title">${ic('flag')} Stechen</div>
      <div class="bm-pairgrid" style="grid-template-columns:repeat(1,1fr);--pscale:${psc}">${groups.map(grp=>{
        const idxs=grp.map(g=>st.findIndex(s=>s.id===g.id));
        const lo=Math.min(...idxs)+1, hi=Math.max(...idxs)+1;
        const place=lo===hi?`Platz ${lo}`:`Platz ${lo}–${hi}`;
        const names=grp.map((g,i)=>`<span class="bm-pn${(grp.length===2&&i===1)?" r":""}">${esc(g.name)}</span>`).join('<span class="bm-res">vs</span>');
        return `<div class="bm-pair">${`<span class="bm-bd lab">${place}</span>`}${names}</div>`;
      }).join("")}</div>
      <div class="bm-wait" style="justify-content:center;margin-top:1.6vw"><span class="bm-wait-t">⚡ Blitzpartie entscheidet die Reihung</span></div>`;
  }
  else if(panel==="standings"){
    const st=standingsView().slice(0,12);
    body=`<div class="bm-section-title">${ic('table')} ${state.status==="finished"?"Endstand":"Gesamtreihung"}</div>
      <table class="bm-tbl"><tbody>${st.map((s,i)=>`<tr class="${i<3?"top"+(i+1):""}"><td class="r">${i+1}</td><td class="n">${esc(s.name)}</td><td class="k">${esc(s.klasse||"")}</td><td class="p">${fmt(s.points)}</td><td class="b">${fmt(s.buch)}</td></tr>`).join("")}</tbody></table>`;
  }
  else if(panel==="sieger"){
    const st=standingsView().slice(0,8);
    body=`<div class="bm-sieger">
      <div class="bm-sieger-cups">
        <div class="bm-section-title" style="text-align:center">${ic('trophy')} ${esc(state.tournament_name)} · Sieger</div>
        <div id="bmtrophies"></div>
      </div>
      <div class="bm-sieger-tbl">
        <div class="bm-section-title">${ic('table')} Endstand</div>
        <table class="bm-tbl"><tbody>${st.map((s,i)=>`<tr class="${i<3?"top"+(i+1):""}"><td class="r">${i+1}</td><td class="n">${esc(s.name)}</td><td class="k">${esc(s.klasse||"")}</td><td class="p">${fmt(s.points)}</td><td class="b">${fmt(s.buch)}</td></tr>`).join("")}</tbody></table>
      </div>
    </div>`;
  }

  // QR im Header: Ziel = externer Anmelde-Link (falls gesetzt) sonst die Schülerseite; nicht bei der Anmelde-Seite (dort steht der große QR)
  const hdrQrTarget = regTarget();
  const showHdrQr = state.status!=="registration";
  r.innerHTML=`
    ${state.status==="running"?`<div class="bm-bgcups" id="bmBgCups"></div>`:""}
    <div class="bm-top">
      <div class="bm-left">
        <img class="bm-logo" src="${HTL1_LOGO}" alt="HTL1">
        <div class="bm-titlestack">
          <div class="bm-title">${esc(state.tournament_name)}</div>
          <div class="bm-sub">HTL1-Lastenstraße</div>
          <div class="bm-status">${statusTxt}</div>
        </div>
      </div>
      <div class="bm-center"><span id="bmClockSlot"></span></div>
      <div class="bm-right">
        ${showHdrQr?`<div class="bm-hdr-qr"><div id="bmHdrQr"></div><span class="t">Live</span><span class="u">${esc(linkLabel(hdrQrTarget))}</span></div>`:""}
        <span class="bm-htl" id="bmHtlSlot"></span>
      </div>
    </div>
    <div class="bm-stage${(panel==="pairings"||panel==="standings"||panel==="sieger"||panel==="joinhall"||panel==="stechen")?"":" center"}">${body}</div>
    ${panels.length>1?`<div class="bm-dots">${panels.map((_,i)=>`<span class="${i===ui.beamerIdx%panels.length?"on":""}"></span>`).join("")}</div>`:""}
    ${state.status==="running"?`<div class="bm-reminder">${ic('reset')} Nach jeder Partie bitte die Figuren wieder aufstellen</div>`
      :state.status==="finished"?`<div class="bm-reminder">${ic('flag')} Bitte alle Bretter aufgebaut stehen lassen — danke!</div>`:""}
    <div class="bm-foot"><span id="bmFootSlot"></span></div>`;
  mountBeamerClock(); mountBeamerLogo(); mountBeamerFoot();

  if(panel==="joinhall"){
    try{ new QRCode($("#bmqr"),{text:bmQrTarget,width:260,height:260,colorDark:"#20211d",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}); }catch(e){}
    renderTrophies($("#bmtrophies"), state.champions);
  }
  if(panel==="sieger"){ renderTrophies($("#bmtrophies"), state.champions||[]); }
  if(state.status==="running"){ const bc=$("#bmBgCups"); if(bc) renderTrophies(bc, []); }   // leere Pokale als Hintergrund
  if(showHdrQr){ const qe=$("#bmHdrQr"); if(qe){ try{ new QRCode(qe,{text:hdrQrTarget,width:220,height:220,colorDark:"#20211d",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}); }catch(e){} } }
}

/* ---------- QR (nur Admin + Supabase) ---------- */
function renderQR(app){
  const viewer = regTarget();
  const extern = useExtern();
  const live = liveOnly();
  const card=document.createElement("div"); card.className="card";
  card.innerHTML=`<div class="eyebrow">Schüler einladen</div><h2 style="margin-bottom:12px">${extern?esc(state.reg_text||"Externer Anmelde-Link"):live?"QR-Code für die Liveansicht":"QR-Code für die Anmeldung"}</h2>
    <div class="qrbox"><div id="qr"></div>
      <div class="linkfield"><p class="lead" style="margin-bottom:8px">${extern?"Externer Link — Schüler scannen den Code oder öffnen ihn.":live?"Schüler scannen den Code oder öffnen den Link — sie sehen Spielplan und Tabelle live.":"Schüler scannen den Code oder öffnen den Link — sie sehen Anmeldung, Spielplan und Tabelle live."}</p>
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
  const namen=["Lena Maier","Paul Koch","Mia Schuster","Jonas Weber","Emma Hofer","Felix Berger","Anna Reiter","Noah Tkalcic","Sophie Lang","David Pichler","Marie Fuchs","Lukas Gruber","Hannah Zöhrer","Tobias Novak","Laura Diem","Simon Vogel","Julia Aigner","Florian Ebner","Sarah Ostermann","Daniel Url"];
  const klassen=["1AHET","1BHET","2AHET","2BHET","3AHET"];
  for(const n of namen){ await addPlayer(n, klassen[Math.floor(Math.random()*klassen.length)], {present:true}); }
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

/* Deterministischer Stechen-Test: 8 Spieler, spiegelsymmetrisch konstruiert,
   sodass Platz 1=2, 3=4, 5=6 und 7=8 in ALLEN Wertungen (Punkte, Buchholz,
   Sonneborn-Berger, Siege) exakt gleich sind → echter Gleichstand zum Testen. */
async function simulateStechen(){
  if(!isAdmin()) return;
  if(state.players.length && !confirm("Stechen-Test ersetzt alle aktuellen Teilnehmer & Ergebnisse. Fortfahren?")) return;
  toast("Stechen-Test wird aufgebaut…");
  await resetAll();
  const roster=[["Anna","2AHET"],["Bea","2AHET"],["Carl","2BHET"],["Dora","2BHET"],
                ["Emil","3AHIT"],["Finn","3AHIT"],["Greta","3BHIT"],["Hugo","3BHIT"]];
  for(const [n,k] of roster){ await addPlayer(n,k,{present:true}); }
  const P=state.players;   // 8 in Reihenfolge, mit gültigen IDs
  const w=(r,b,white,black)=>({round:r,board:b,white_id:white.id,black_id:black.id,result:"1-0",active:true,board_label:""});
  // Spiegelung σ=(P1 P2)(P3 P4)(P5 P6)(P7 P8): jede Partie hat ihr Spiegelbild mit gleichem Ausgang
  await insertPairings([
    w(1,1,P[0],P[2]), w(1,2,P[1],P[3]), w(1,3,P[4],P[6]), w(1,4,P[5],P[7]),
    w(2,1,P[0],P[4]), w(2,2,P[1],P[5]), w(2,3,P[2],P[6]), w(2,4,P[3],P[7]),
    w(3,1,P[0],P[6]), w(3,2,P[1],P[7]), w(3,3,P[2],P[4]), w(3,4,P[3],P[5]),
  ]);
  await patchState({status:"finished", num_rounds:3, current_round:3});
  if(SB_MODE) await loadAll();
  render();
  toast("Stechen-Test fertig — Platz 1↔2 und 3↔4 gleich, jetzt 'Stechen ↑' testen ✓");
}

/* Stechen-Test mit echtem 3er-Gleichstand: 6 Spieler, 3-Zyklus-symmetrisch
   (A>B>C>A im Trio + jeder schlägt einen aus dem unteren Trio) → Platz 1=2=3
   und 4=5=6 in allen Wertungen exakt gleich. */
async function simulateStechen3(){
  if(!isAdmin()) return;
  if(state.players.length && !confirm("Stechen-Test (3er) ersetzt alle aktuellen Teilnehmer & Ergebnisse. Fortfahren?")) return;
  toast("Stechen-Test (3er) wird aufgebaut…");
  await resetAll();
  const roster=[["Anna","2AHET"],["Bea","2BHET"],["Carl","3AHIT"],
                ["Dora","1AHME"],["Emil","1BHME"],["Finn","4AHET"]];
  for(const [n,k] of roster){ await addPlayer(n,k,{present:true}); }
  const P=state.players;   // A=0 B=1 C=2 D=3 E=4 F=5
  const g=(r,b,white,black,result)=>({round:r,board:b,white_id:white.id,black_id:black.id,result,active:true,board_label:""});
  await insertPairings([
    g(1,1,P[0],P[1],"1-0"), g(1,2,P[2],P[3],"1-0"), g(1,3,P[4],P[5],"1-0"),
    g(2,1,P[1],P[2],"1-0"), g(2,2,P[0],P[4],"1-0"), g(2,3,P[3],P[5],"0-1"),
    g(3,1,P[0],P[2],"0-1"), g(3,2,P[1],P[5],"1-0"), g(3,3,P[3],P[4],"1-0"),
  ]);
  await patchState({status:"finished", num_rounds:3, current_round:3});
  if(SB_MODE) await loadAll();
  render();
  toast("Stechen-Test (3er) fertig — Platz 1=2=3 gleich, jetzt 'Stechen ↑' testen ✓");
}

/* Lädt eine leere Excel-Vorlage mit den richtigen Spalten herunter.
   Beispielzeilen zeigen: statt Klasse kann auch eine Funktion (Lehrer) stehen. */
function downloadTemplate(){
  if(typeof XLSX==="undefined"){ toast("Bitte kurz warten (Bibliothek lädt)"); return; }
  const aoa=[
    ["Vorname","Nachname","Klasse"],
    ["Lena","Maier","2AHET"],
    ["Paul","Koch","1BHET"],
    ["Markus","Berger","Lehrer"],
    ["Sabine","Huber","Direktorin"],
  ];
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"]=[{wch:16},{wch:18},{wch:14}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Teilnehmer");
  XLSX.writeFile(wb, "Teilnehmer-Vorlage.xlsx");
  toast("Vorlage heruntergeladen ✓");
}

/* Importiert Teilnehmer aus Excel/CSV — Spalten 'Vorname','Nachname','Klasse'
   (oder 'Name','Klasse'). */
async function handleImportFile(file){
  if(!file) return;
  if(typeof XLSX==="undefined"){ toast("Bitte kurz warten (Bibliothek lädt)"); return; }
  const S=(r,c)=>String(c>-1&&r[c]!=null?r[c]:"").trim();
  try{
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:"array"});
    // Aus einem Turnier-Export bevorzugt das Blatt "Teilnehmer", sonst das erste Blatt
    const ws=wb.Sheets["Teilnehmer"] || wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false});
    if(!rows.length){ toast("Datei ist leer"); return; }
    let start=0,nameCol=0,vorCol=-1,nachCol=-1,klasseCol=1;
    const head=(rows[0]||[]).map(x=>String(x).trim().toLowerCase());
    vorCol =head.findIndex(h=>h.includes("vorname")||h==="vor");
    nachCol=head.findIndex(h=>h.includes("nachname")||h.includes("familienname")||h==="nach");
    const ni=head.findIndex(h=>h==="name"||(h.includes("name")&&h!=="vorname"&&h!=="nachname"));
    const ki=head.findIndex(h=>h.includes("klasse")||h.includes("class")||h.includes("funktion"));
    if(vorCol>-1||nachCol>-1||ni>-1){ start=1; if(ni>-1)nameCol=ni; klasseCol=(ki>-1?ki:klasseCol); }
    let n=0;
    for(let i=start;i<rows.length;i++){
      const row=rows[i]||[];
      // Namen bereinigen: nur EIN Vorname + Nachname (damit's nicht zu lang wird)
      let name;
      if(vorCol>-1||nachCol>-1){
        const vor=(S(row,vorCol).split(/\s+/)[0]||"");   // nur der erste Vorname
        name=(vor+" "+S(row,nachCol)).trim();
      }else{
        const t=S(row,nameCol).split(/\s+/).filter(Boolean);
        name = t.length<2 ? (t[0]||"") : t[0]+" "+t[t.length-1];   // Vorname + letzter Nachname
      }
      const klasse=S(row,klasseCol);
      if(name.length<2) continue;
      if(state.players.some(p=>p.name.toLowerCase()===name.toLowerCase() && (p.klasse||"").toLowerCase()===klasse.toLowerCase())) continue;
      await addPlayer(name,klasse); n++;
    }
    render(); toast(n+" Teilnehmer importiert ✓");
  }catch(e){ console.error(e); toast("Import fehlgeschlagen — Spalten 'Vorname'/'Nachname'/'Klasse' prüfen"); }
}

/* Wall of Fame + Pokale aus einer Export-Datei wiederherstellen
   (Blätter "Ruhmeshalle" und "Pokale" aus dem Excel-Export). */
async function importHallCups(file){
  if(!file) return;
  if(typeof XLSX==="undefined"){ toast("Bitte kurz warten (Bibliothek lädt)"); return; }
  const S=v=>String(v==null?"":v).trim();
  try{
    const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});
    let nHall=0, nCup=0;
    const wsH=wb.Sheets["Ruhmeshalle"];
    if(wsH){
      const rows=XLSX.utils.sheet_to_json(wsH,{header:1,blankrows:false}), recs=[];
      for(let i=1;i<rows.length;i++){ const r=rows[i]||[];
        const rank=parseInt(r[2],10), name=S(r[3]);
        if(name.length<2 || !(rank>=1)) continue;
        recs.push({tournament_name:S(r[1]), event_date:S(r[0])||null, rank, name, klasse:S(r[4])});
      }
      if(recs.length){
        state.halloffame=[...recs, ...(state.halloffame||[])];
        if(SB_MODE) await sb.from("chess_halloffame").insert(recs);
        nHall=recs.length;
      }
    }
    const wsC=wb.Sheets["Pokale"];
    if(wsC){
      const rows=XLSX.utils.sheet_to_json(wsC,{header:1,blankrows:false}), champs=[];
      for(let i=1;i<rows.length;i++){ const r=rows[i]||[];
        const rank=parseInt(r[0],10), name=S(r[1]);
        if(name.length<2 || !(rank>=1&&rank<=3)) continue;
        champs.push({rank, name, klasse:S(r[2]), tournament:S(r[3]), date:S(r[4])});
      }
      if(champs.length){ champs.sort((a,b)=>a.rank-b.rank); await patchState({champions:champs, awarded:true}); nCup=champs.length; }
    }
    if(!nHall && !nCup){ toast("Keine Blätter 'Ruhmeshalle'/'Pokale' gefunden"); return; }
    render(); toast(`Wiederhergestellt: ${nCup} Pokale, ${nHall} Hall-Einträge ✓`);
  }catch(e){ console.error(e); toast("Import fehlgeschlagen — Datei/Blätter prüfen"); }
}

/* ============================ START ============================ */
async function boot(){
  const bl=$("#brandLogo"); if(bl) bl.src=HTL1_LOGO;
  if(SB_MODE){
    try{ const { data:{ session } } = await sb.auth.getSession(); authUser = session ? session.user : null; }catch(e){ authUser=null; }
    sb.auth.onAuthStateChange((_evt, sess)=>{ authUser = sess ? sess.user : null; if(IS_ADMIN) render(); });
    await loadAll();
    // Realtime-Änderungen coalescen: mehrere Events kurz hintereinander -> ein Reload+Render
    let _syncT=null, _syncing=false, _pending=false, _lastSig=stateSig();
    const runSync=async()=>{
      if(_syncing){ _pending=true; return; }   // läuft schon -> nach Abschluss nachholen
      // Während man in ein Feld tippt NICHT neu rendern (sonst Eingabe weg + Scroll springt)
      if(isTyping()){ _syncT=setTimeout(runSync, 600); return; }
      _syncing=true;
      try{
        await loadAll();
        const sig=stateSig();
        if(sig!==_lastSig){ _lastSig=sig; if(!isTyping()) render(); else _pending=true; }   // nur bei echter Änderung rendern
      }
      finally{ _syncing=false; if(_pending && !isTyping()){ _pending=false; runSync(); } }
    };
    const scheduleSync=()=>{ clearTimeout(_syncT); _syncT=setTimeout(runSync, 120); };
    sb.channel("chess-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_state"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_players"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_pairings"},scheduleSync)
      .on("postgres_changes",{event:"*",schema:"public",table:"chess_halloffame"},scheduleSync)
      .subscribe();
    // Fallback-Poll: fängt verpasste Realtime-Events ab (z.B. wenn eine Tabelle
    // nicht im supabase_realtime-Publication ist) — alle 8 s ein leiser Reload.
    setInterval(()=>{ if(document.visibilityState!=="hidden") scheduleSync(); }, 8000);
  }
  if(IS_BEAMER){ setInterval(()=>{ if(state.status==="running"){ ui.beamerIdx++; render(); } }, 12000); }
  render();
}
boot(); 

const HTL_LOGO_BM = `<svg id="htl-logo-svg-bm" data-name="Ebene 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 432.46 202.88">
  <defs>
    <style>
      .htllogo-1-bm {
        fill: #fff;
      }

      .htllogo-2-bm {
        fill: #222;
      }

      .htllogo-3-bm {
        fill: #0083aa;
      }

      .htllogo-4-bm {
        clip-path: url(#clippath-1-bm);
      }

      .htllogo-5-bm {
        clip-path: url(#clippath-bm);
      }

      .htllogo-6-bm {
        fill: none;
      }

      .htllogo-7-bm {
        fill: #d87b0b;
      }
    </style>
    <clipPath id="clippath-bm">
      <rect class="htllogo-6-bm" x="0" y="0" width="432.46" height="202.88"/>
    </clipPath>
    <clipPath id="clippath-1-bm">
      <rect class="htllogo-6-bm" x="0" y="0" width="432.46" height="202.88"/>
    </clipPath>
  <clipPath id="globeClip-bm"><circle cx="373.8" cy="79.24" r="49.0"/></clipPath><mask id="orbitMask-bm"><path id="orbitWedge-bm" fill="#fff"/></mask><mask id="standMask-bm"><path id="standStroke-bm" d="M189.1,196.3 L187.6,192.8 L185.9,189.2 L184.4,185.7 L182.9,182.1 L181.4,178.6 L179.9,175.1 L178.4,171.4 L177.1,167.8 L175.8,164.6 L171.0,134.0 L169.7,124.6 L168.6,115.5 L167.6,106.8 L166.8,98.5 L166.2,90.5 L165.8,82.9 L165.5,75.6 L165.4,68.7 L165.5,62.2 L165.8,56.0 L166.2,50.2 L166.8,44.7 L167.6,39.6 L168.6,34.9 L169.7,30.5 L171.0,26.5 L172.5,22.8 L174.2,19.5 L176.0,16.6 L178.0,14.0 L181.2,14.9 L184.3,16.2 L187.3,17.9 L190.1,20.0 L192.9,22.4 L195.5,25.2 L198.1,28.4 L200.5,32.0 L202.8,35.9 L205.0,40.2 L207.1,44.9 L209.1,50.0 L211.0,55.4 L212.8,61.2 L214.4,67.4 L216.0,74.0" pathLength="1000" stroke-dasharray="0 2000" style="fill:none;stroke:#fff;stroke-width:22;stroke-linecap:butt;stroke-linejoin:round"/></mask></defs><g mask="url(#orbitMask-bm)"><path class="htllogo-3-bm" d="M106.38,47.07c-9.46,.97-19,2.75-28.58,4.95-9.58,2.19-19.18,4.98-28.64,8.62-4.72,1.82-9.41,3.86-13.99,6.23-4.58,2.36-9.08,5.01-13.33,8.19-4.23,3.18-8.29,6.84-11.56,11.44-1.62,2.3-3.06,4.83-4.05,7.62-.52,1.38-.89,2.84-1.16,4.31l-.18,1.11c-.06,.37-.08,.79-.12,1.19l-.05,.6c-.01,.2-.01,.34-.02,.51l-.03,.98c.02,6.32,2.48,11.89,5.78,16.39,3.31,4.53,7.39,8.1,11.64,11.2,4.27,3.09,8.78,5.67,13.37,7.93,4.59,2.27,9.28,4.22,14.01,5.95,9.3,3.41,16.61,5.96,26.01,8,.05-.59,.09-1.19,.15-1.78,.04-2.12,.07-4.23,.11-6.35-10.88-3-19.12-6.58-28.06-10.82C10.92,115.92-.57,83.24,79.35,59.67c36.89-10.88,97.71-8.88,123.88-9.01-5.82-1.5-48.44-8.58-96.85-3.59"/><path class="htllogo-3-bm" d="M349.67,129.76c-3.3,1.09-11.78,4.56-20.09,6.88-10.09,2.81-19.92,4.4-19.92,4.4,3.58,2.58,5.34,6.48,5.34,6.48,.19,0,.39-.03,.64-.1,12.05-3.2,24.39-8.15,34.89-14.85,.96-.61,1.9-1.27,2.88-1.94-1.87-1.58-1.85-1.51-3.74-.88"/></g><g id="standGroup-bm" mask="url(#standMask-bm)" style="opacity:0"><path class="htllogo-3-bm" d="M189.44,195.11c-2.2-5.29-6.67-16.81-6.67-16.81-1.85-4.75-3.62-9.8-5.3-15.13-.04-.11-.07-.22-.1-.33-.86,1.24-1.89,2.35-3.05,3.28,3.2,8.33,14.13,31.13,14.68,31.83,.06-.08,.1-.15,.16-.22,.03,.05,.07,.11,.1,.16,0-.1,0-.19,0-.29,.79-1.12,.71-1.23,.19-2.47"/><path class="htllogo-3-bm" d="M207.77,35.93c-1.7-3.31-3.53-6.59-5.54-9.8-2-3.21-4.17-6.35-6.63-9.34-2.47-2.98-5.22-5.83-8.6-8.19-1.71-1.15-3.58-2.19-5.71-2.84-1.06-.33-2.18-.57-3.34-.64-.29-.03-.58-.03-.87-.03-.29,0-.58,0-.92,.02l-.49,.04c-.17,.01-.33,.03-.42,.05l-.8,.13c-2.32,.47-4.45,1.59-6.13,3.01-1.71,1.41-3.02,3.08-4.15,4.79-2.2,3.45-3.63,7.12-4.75,10.8-2.2,7.37-3.2,14.85-3.79,22.23-.56,7.39-.63,14.73-.41,21.95,.22,7.22,.75,14.33,1.5,21.29,1.5,13.93,3.79,27.27,6.66,39.76,.79,3.44,2.69,7.88,3.56,11.19,1.92,.16,3.75,.65,5.44,1.4-.94-3.97-2.91-9.1-3.76-13.26-1.25-6.23-2.41-12.65-3.41-19.24-.99-6.59-1.83-13.35-2.44-20.24-.62-6.89-1.02-13.91-1.12-21.01-.1-7.1,.09-11.08,.76-18.25,.69-7.15,1.8-12.22,3.95-18.99,1.08-3.37,2.46-6.64,4.3-9.42,1.84-2.76,4.23-5.27,6.94-5.36,16.17-.49,35.36,47.2,36.49,50.73h5.19c-1.38-4.32-8.11-24.15-11.51-30.78"/></g>
  <g id="logo-bm">
    <g class="htllogo-5-bm">
      <g class="htllogo-4-bm">
        
        
        <polygon class="htllogo-7-bm" points="81.02 161.87 81.02 138.44 88.71 138.44 88.71 156.4 99.25 156.4 99.25 161.87 81.02 161.87"/>
        <path class="htllogo-7-bm" d="M114.03,161.87l-.33-1.82c-1.92,1.79-3.87,2.31-6.41,2.31-3.22,0-6.09-1.59-6.09-5.14,0-7.75,12.14-4.23,12.14-7.42,0-1.24-1.5-1.4-2.21-1.4-.94,0-2.21,.2-2.38,1.66h-6.51c0-3.61,2.57-5.73,9.31-5.73,8.07,0,8.56,2.99,8.56,7.06v7.98c0,.98,.03,1.46,.91,2.18v.32h-7Zm-.68-7.55c-2.21,1.07-5.14,.55-5.14,2.77,0,.85,.81,1.43,2.15,1.43,2.38,0,3.16-1.86,3-4.2"/>
        <path class="htllogo-7-bm" d="M129.37,156.57c0,.68,.26,1.21,.72,1.56,.42,.33,1.01,.52,1.66,.52,1.04,0,2.15-.32,2.15-1.53,0-2.73-10.45-.55-10.45-7.16,0-4.36,4.52-5.63,8.07-5.63s8.07,.85,8.46,5.37h-6.15c-.07-.55-.29-.94-.65-1.24-.36-.29-.85-.42-1.37-.42-1.17,0-1.92,.36-1.92,1.2,0,2.38,10.78,.78,10.78,7.16,0,3.55-2.93,5.96-9.18,5.96-3.91,0-8.2-1.2-8.56-5.79h6.45Z"/>
        <path class="htllogo-7-bm" d="M154.42,161.87c-8.89,.49-9.96-.13-9.96-6.02v-7.13h-2.41v-3.91h2.51v-5.31h6.67v5.31h3.26v3.91h-3.26v6.19c0,1.56,.23,2.12,2.12,2.12h1.07v4.85Z"/>
        <path class="htllogo-7-bm" d="M163.25,154.87c0,2.02,1.56,3.35,3.35,3.35,1.07,0,2.05-.49,2.54-1.5h6.48c-1.17,4.23-5.47,5.63-9.44,5.63-5.47,0-9.7-3.12-9.7-8.85s4.2-9.18,9.67-9.18c6.31,0,10.12,4.36,10.03,10.55h-12.92Zm6.15-3.45c0-1.56-1.4-2.96-3-2.96-2.02,0-3.16,1.14-3.16,2.96h6.15Z"/>
        <path class="htllogo-7-bm" d="M178.71,144.82h6.19v2.67c1.53-2.05,3.19-3.16,5.76-3.16,4.49,0,6.61,2.64,6.61,7.32v10.22h-6.77v-9.02c0-1.69-.46-3.19-2.38-3.19-2.08,0-2.64,1.33-2.64,3.52v8.69h-6.77v-17.06Z"/>
        <path class="htllogo-7-bm" d="M206.31,156.57c0,.68,.26,1.21,.72,1.56,.42,.33,1.01,.52,1.66,.52,1.04,0,2.15-.32,2.15-1.53,0-2.73-10.45-.55-10.45-7.16,0-4.36,4.52-5.63,8.07-5.63s8.07,.85,8.46,5.37h-6.15c-.06-.55-.29-.94-.65-1.24-.36-.29-.85-.42-1.37-.42-1.17,0-1.92,.36-1.92,1.2,0,2.38,10.78,.78,10.78,7.16,0,3.55-2.93,5.96-9.18,5.96-3.91,0-8.2-1.2-8.56-5.79h6.45Z"/>
        <path class="htllogo-7-bm" d="M231.35,161.87c-8.89,.49-9.96-.13-9.96-6.02v-7.13h-2.41v-3.91h2.51v-5.31h6.67v5.31h3.26v3.91h-3.26v6.19c0,1.56,.23,2.12,2.12,2.12h1.07v4.85Z"/>
        <path class="htllogo-7-bm" d="M234.59,144.82h6.15v3.45h.07c.94-2.67,2.6-3.94,5.24-3.94,.29,0,.59,.07,.88,.1v6.77c-.46-.07-.94-.2-1.4-.2-2.77,0-4.17,1.3-4.17,4.98v5.89h-6.77v-17.06Z"/>
        <path class="htllogo-7-bm" d="M260.81,161.87l-.33-1.82c-1.92,1.79-3.87,2.31-6.41,2.31-3.22,0-6.09-1.59-6.09-5.14,0-7.75,12.14-4.23,12.14-7.42,0-1.24-1.5-1.4-2.21-1.4-.94,0-2.21,.2-2.38,1.66h-6.51c0-3.61,2.57-5.73,9.31-5.73,8.07,0,8.56,2.99,8.56,7.06v7.98c0,.98,.03,1.46,.91,2.18v.32h-7Zm-.68-7.55c-2.21,1.07-5.14,.55-5.14,2.77,0,.85,.81,1.43,2.15,1.43,2.38,0,3.16-1.86,3-4.2"/>
        <path class="htllogo-7-bm" d="M279.08,147.16c1.63,.03,2.57-.68,2.57-2.34,0-1.37-.68-2.44-2.21-2.44-2.18,0-2.15,1.63-2.15,3.35v16.15h-6.77v-15.92c0-5.89,3.45-8.14,8.98-8.14,4.88,0,8.5,2.08,8.5,6.09,0,2.18-.94,3.71-2.9,4.62,3.09,1.17,4.26,3.03,4.26,6.31,0,4.92-3.52,7.52-7.55,7.52-.94,0-1.86-.1-2.8-.29v-4.2c2.73,.46,3.58-.85,3.58-3.35s-.91-3.71-3.52-3.65v-3.71Z"/>
        <path class="htllogo-7-bm" d="M298.28,154.87c0,2.02,1.56,3.35,3.35,3.35,1.07,0,2.05-.49,2.54-1.5h6.48c-1.17,4.23-5.47,5.63-9.44,5.63-5.47,0-9.7-3.12-9.7-8.85s4.2-9.18,9.67-9.18c6.31,0,10.12,4.36,10.03,10.55h-12.92Zm6.15-3.45c0-1.56-1.4-2.96-3-2.96-2.02,0-3.16,1.14-3.16,2.96h6.15Z"/>
        
        
        <path class="htllogo-7-bm" d="M310.91,133.97V68.02h-13.81c-.64,5.11-2.89,8.88-6.99,11.47-4,2.52-8.55,3.13-13.18,3.41v11.75h16.01v39.32h17.98Z"/>
        <path class="htllogo-2-bm" d="M233.23,68.82v48.96h29.13v14.85h-47.22v-63.81h18.09Zm-92.66,0v63.72h-18.13v-26.04h-21.1v25.96h-18.2v-63.62h18.15v22.7h21.09v-22.72h18.19m64.83,0v14.66h-18.36v49.11h-18.3v-48.99h-18.42v-14.78h55.07m29.97-2.15h-22.36v68.08h51.49v-19.12h-29.13v-48.96Zm-92.66,0h-22.46v22.72h-16.82v-22.7h-22.42v67.89h22.47v-25.96h16.82v26.04h22.4V66.69Zm64.83,0h-59.35v19.05h18.42v48.99h22.57v-49.11h18.36v-18.93Z"/>
        <circle cx="373.8" cy="79.24" r="51.4" style="fill:none;stroke:#0083aa;stroke-width:2.5"/><g id="globeGrid-bm" clip-path="url(#globeClip-bm)"></g>
        <path class="htllogo-1-bm" d="M205.4,68.83h-55.07v14.78h18.42v48.99h18.3v-49.11h18.36v-14.66Zm27.83,48.95v-48.96h-18.09v63.81h47.22v-14.85h-29.13Zm-92.66,14.77v-63.72h-18.19v22.72h-21.09v-22.7h-18.15v63.62h18.2v-25.96h21.1v26.04h18.13Z"/>
      </g>
    </g>
  </g>
</svg>`;
/* ===== Animiertes HTL1-Logo (Globus + Orbit), portiert aus Aufnahmetest/libi/logo.php ===== */
function runOrbitReveal(sfx){
  sfx=sfx||'';
  var wedge=document.getElementById('orbitWedge'+sfx);
  var stand=document.getElementById('standStroke'+sfx);
  if(!wedge)return;
  function easeIO(k){return k<0.5?2*k*k:1-Math.pow(-2*k+2,2)/2;}
  function pieFn(cx,cy,r,a0,a1){var p="M"+cx+","+cy+" ";var steps=72;for(var s=0;s<=steps;s++){var a=(a0+(a1-a0)*s/steps)*Math.PI/180;p+="L"+(cx+r*Math.cos(a)).toFixed(1)+","+(cy+r*Math.sin(a)).toFixed(1)+" ";}return p+"Z";}
  var P1={cx:150,cy:95,R:300,a0:-35,sweep:375,dur:2800};
  var GAP=250, P2dur=1500;
  var sg=document.getElementById('standGroup'+sfx);
  wedge.setAttribute("d",pieFn(P1.cx,P1.cy,P1.R,P1.a0,P1.a0+0.1));
  if(stand)stand.setAttribute("stroke-dasharray","0 2000");
  if(sg)sg.style.opacity="0";
  var t0=performance.now();
  function frame(t){
    var el=t-t0;
    var k1=Math.min(1,el/P1.dur);
    wedge.setAttribute("d",pieFn(P1.cx,P1.cy,P1.R,P1.a0,P1.a0+P1.sweep*easeIO(k1)));
    var el2=el-(P1.dur+GAP);
    if(el2>0 && stand){if(sg)sg.style.opacity="1";var k2=Math.min(1,el2/P2dur);stand.setAttribute("stroke-dasharray",(1000*easeIO(k2)).toFixed(1)+" 2000");}
    if(el < P1.dur+GAP+P2dur) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
function startGlobe(sfx){
  sfx=sfx||'';
  var grid=document.getElementById('globeGrid'+sfx);
  if(!grid)return;
  var cx=373.8,cy=79.24,r=49.0;
  var TILT=26*Math.PI/180, ANG=-22*Math.PI/180;
  var N_LON=12,N_LAT=8,SEG=44,DUR=20000;
  function proj(lat,lon){
    var la=lat*Math.PI/180, lo=lon*Math.PI/180;
    var x=Math.cos(la)*Math.sin(lo), y=Math.sin(la), z=Math.cos(la)*Math.cos(lo);
    var y2=y*Math.cos(TILT)-z*Math.sin(TILT), z2=y*Math.sin(TILT)+z*Math.cos(TILT), x2=x;
    var x3=x2*Math.cos(ANG)-y2*Math.sin(ANG), y3=x2*Math.sin(ANG)+y2*Math.cos(ANG);
    return [cx+r*x3, cy-r*y3, z2];
  }
  function build(rot){
    var lines=[],i,j,s;
    for(i=0;i<N_LON;i++){var lon0=i*360/N_LON+rot,p=[];for(s=0;s<=SEG;s++)p.push(proj(-90+180*s/SEG,lon0));lines.push([1.0,p]);}
    for(j=1;j<=N_LAT;j++){var lat0=-90+180*j/(N_LAT+1),q=[];for(s=0;s<=SEG;s++)q.push(proj(lat0,360*s/SEG+rot));lines.push([0.95,q]);}
    var d="";
    for(var k=0;k<lines.length;k++){
      var sw=lines[k][0],pts=lines[k][1],seg=[];
      var flush=function(){if(seg.length>1){d+='<path d="M'+seg.map(function(p){return p[0].toFixed(1)+","+p[1].toFixed(1);}).join(" L")+'" style="fill:none;stroke:#0083aa;stroke-width:'+sw+';stroke-linecap:round"/>';}seg=[];};
      for(var n=0;n<pts.length;n++){if(pts[n][2]>=-0.03)seg.push(pts[n]);else flush();}
      flush();
    }
    return d;
  }
  var t0=performance.now();
  function frame(t){var rot=((t-t0)/DUR)*360%360;grid.innerHTML=build(rot);requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
}
/* Beamer-Logo: einmal erzeugen + animieren, danach pro Render nur umhängen (kein Ruckeln) */
let _bmLogo=null;
function mountBeamerLogo(){
  var slot=document.getElementById('bmHtlSlot');
  if(!slot) return;
  if(!_bmLogo){
    _bmLogo=document.createElement('span');
    _bmLogo.className='bm-htl-inner';
    _bmLogo.innerHTML=HTL_LOGO_BM;
    slot.appendChild(_bmLogo);
    try{startGlobe('-bm');}catch(e){}
    try{runOrbitReveal('-bm');}catch(e){}
  } else {
    slot.appendChild(_bmLogo);   // bestehenden, weiterlaufenden Knoten umhängen
  }
}

/* kranzlab-Logo (Mond + Welle + Punkte, animiertes Reveal) für die Beamer-Uhr */
const KRANZLAB_BASE=`<svg viewBox="8 0 394 180" role="img" aria-label="kranzlab" xmlns="http://www.w3.org/2000/svg">
<defs>
<radialGradient id="klMoonGrad" cx="36%" cy="34%"><stop offset="0%" stop-color="#f6f8fb"/><stop offset="55%" stop-color="#c2ccd9"/><stop offset="100%" stop-color="#8a98ab"/></radialGradient>
<linearGradient id="klRingGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#d6dde6"/><stop offset="100%" stop-color="#7a8696"/></linearGradient>
<filter id="klMoonGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.0" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="klMoonClip"><circle cx="70" cy="90" r="42"/></clipPath>
<radialGradient id="klSphereShade" cx="36%" cy="34%" r="72%"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="55%" stop-color="#ffffff" stop-opacity="0"/><stop offset="100%" stop-color="#05070b" stop-opacity="0.55"/></radialGradient>
<clipPath id="klReveal"><rect class="kl-mask" x="131" y="0" width="300" height="180"/></clipPath>
</defs>
<g transform="translate(21 27) scale(0.7)">
<circle cx="70" cy="90" r="61" fill="none" stroke="url(#klRingGrad)" stroke-width="4" opacity="0.85"/>
<g filter="url(#klMoonGlow)"><circle cx="70" cy="90" r="42" fill="url(#klMoonGrad)"/>
<g clip-path="url(#klMoonClip)"><g transform="rotate(-10 70 90)">
<g><animateTransform attributeName="transform" type="translate" from="0 0" to="-84 0" dur="7s" repeatCount="indefinite"/><circle cx="49" cy="83" r="7" fill="#8a98ab" opacity="0.5"/><circle cx="70" cy="104" r="4.9" fill="#8a98ab" opacity="0.45"/><circle cx="88" cy="76" r="6" fill="#8a98ab" opacity="0.5"/><circle cx="105" cy="97" r="3.9" fill="#8a98ab" opacity="0.4"/></g>
<g transform="translate(84 0)"><animateTransform attributeName="transform" type="translate" from="84 0" to="0 0" dur="7s" repeatCount="indefinite"/><circle cx="49" cy="83" r="7" fill="#8a98ab" opacity="0.5"/><circle cx="70" cy="104" r="4.9" fill="#8a98ab" opacity="0.45"/><circle cx="88" cy="76" r="6" fill="#8a98ab" opacity="0.5"/><circle cx="105" cy="97" r="3.9" fill="#8a98ab" opacity="0.4"/></g></g>
<circle cx="94.5" cy="74" r="37" fill="#05070b" opacity="0.78"/><circle cx="70" cy="90" r="42" fill="url(#klSphereShade)"/></g></g>
<circle cx="103" cy="62" r="5.2" fill="#f6f8fb"/></g>
<g clip-path="url(#klReveal)"><text x="131" y="108" font-family="'Poppins',sans-serif" font-size="56" font-weight="600" letter-spacing="-1"><tspan fill="#f1ede6">kranz</tspan><tspan fill="#aeb8c6">lab</tspan></text></g>
<path class="kl-wave" fill="none" stroke="#f2ab57" stroke-width="3" stroke-linecap="round" d="M131 132 q 19.62 -20 39.25 0 q 19.62 20 39.25 0 q 19.62 -20 39.25 0 q 19.62 20 39.25 0"/>
<g class="kl-dots" fill="#f2ab57"><circle cx="301" cy="123.4" r="3.6"/><circle cx="321" cy="127.5" r="3.0"/><circle cx="342" cy="141.2" r="2.4"/><circle cx="362" cy="135.4" r="1.6"/><circle cx="383" cy="122.4" r="1.1"/></g>
</svg>`;
/* kranzlab-Logo mit eindeutigen IDs (Mehrfach-Einsatz), einstellbarer Wellenfarbe,
   optional ohne Mond (nur Wortmarke + Welle). */
function kranzlabSVG(sfx, waveCol, noMoon){
  var s=KRANZLAB_BASE;
  if(noMoon){
    s=s.replace(/<\/defs>[\s\S]*?<g clip-path="url\(#klReveal\)">/, '</defs><g clip-path="url(#klReveal)">')
       .replace('viewBox="8 0 394 180"','viewBox="122 50 292 100"');
  }
  return s
    .replace(/id="(kl\w+)"/g, (m,id)=>'id="'+id+sfx+'"')
    .replace(/url\(#(kl\w+)\)/g, (m,id)=>'url(#'+id+sfx+')')
    .replace(/#f2ab57/g, waveCol);
}
/* 7-Segment-Uhren (Beamer + Seitenkopf) gemeinsam ticken */
function tickClocks(){
  var d=new Date(), p=n=>(n<10?'0':'')+n, t=p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
  document.querySelectorAll('.bm-clock .lit, .hdr-clock .lit').forEach(function(el){ el.textContent=t; });
}
/* Seitenkopf: Uhr ticken + kranzlab + Footer-kranzlab einsetzen (einmalig) */
function initHeaderFx(){
  // animiertes kranzlab nur in der Admin-Ansicht
  var hk=document.getElementById('hdrKranzlab'); if(hk && IS_ADMIN && !hk.firstChild) hk.innerHTML=kranzlabSVG('-h','#f2ab57');
  // dezentes kranzlab im Footer: ohne Mond, silberne Wellenlinie
  var fk=document.getElementById('footKranzlab'); if(fk && !fk.firstChild) fk.innerHTML=kranzlabSVG('-f','#c2c7cf',true);
  tickClocks();
}
let _bmClock=null;
function mountBeamerClock(){
  var slot=document.getElementById('bmClockSlot'); if(!slot) return;
  if(!_bmClock){
    _bmClock=document.createElement('div'); _bmClock.className='bm-clock';
    _bmClock.innerHTML='<span class="off">88:88:88</span><span class="lit" id="bmClock">00:00:00</span>';
    slot.replaceWith(_bmClock); tickClocks();
  } else { slot.replaceWith(_bmClock); }
}
let _bmFoot=null;
function mountBeamerFoot(){
  var slot=document.getElementById('bmFootSlot'); if(!slot) return;
  if(!_bmFoot){
    _bmFoot=document.createElement('span'); _bmFoot.className='bm-foot-kl';
    _bmFoot.innerHTML=kranzlabSVG('-bf','#c2c7cf',true);
    slot.replaceWith(_bmFoot);
  } else { slot.replaceWith(_bmFoot); }   // persistent — Animation läuft weiter
}

/* Animierte Sternkonstellationen im Hintergrund (alle Ansichten) */
function initBgFX(){
  var c=document.getElementById('bgFX'); if(!c) return;
  var ctx=c.getContext('2d'); if(!ctx) return;
  var reduce=false; try{ reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  var W,H,DPR,stars,D=140;
  function resize(){
    DPR=Math.min(2, window.devicePixelRatio||1);
    W=c.clientWidth||window.innerWidth; H=c.clientHeight||window.innerHeight;
    c.width=Math.round(W*DPR); c.height=Math.round(H*DPR); ctx.setTransform(DPR,0,0,DPR,0,0);
    var target=Math.max(28, Math.min(120, Math.round((W*H)/15000)));
    stars=[];
    for(var i=0;i<target;i++) stars.push({
      x:Math.random()*W, y:Math.random()*H,
      vx:(Math.random()-.5)*0.10, vy:(Math.random()-.5)*0.10,
      r:Math.random()*1.4+0.5, tw:Math.random()*6.28
    });
  }
  function draw(t){
    ctx.clearRect(0,0,W,H);
    var i,j,a,b,dx,dy,d2;
    if(!reduce){ for(i=0;i<stars.length;i++){ a=stars[i]; a.x+=a.vx; a.y+=a.vy;
      if(a.x<-12)a.x=W+12; if(a.x>W+12)a.x=-12; if(a.y<-12)a.y=H+12; if(a.y>H+12)a.y=-12; } }
    for(i=0;i<stars.length;i++){ for(j=i+1;j<stars.length;j++){ a=stars[i]; b=stars[j];
      dx=a.x-b.x; dy=a.y-b.y; d2=dx*dx+dy*dy;
      if(d2<D*D){ var al=(1-Math.sqrt(d2)/D)*0.13;
        ctx.strokeStyle='rgba(120,185,215,'+al.toFixed(3)+')'; ctx.lineWidth=1;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); } } }
    for(i=0;i<stars.length;i++){ a=stars[i];
      var tw=reduce?0.8:(0.55+0.45*Math.sin(t*0.001+a.tw));
      ctx.fillStyle='rgba(212,226,246,'+(0.55*tw).toFixed(3)+')';
      ctx.beginPath(); ctx.arc(a.x,a.y,a.r,0,6.2832); ctx.fill(); }
    if(!reduce) requestAnimationFrame(draw);
  }
  var _rt; window.addEventListener('resize', function(){ clearTimeout(_rt); _rt=setTimeout(resize,200); });
  resize(); requestAnimationFrame(draw);
}
window.addEventListener('load', function(){ try{startGlobe();}catch(e){} try{runOrbitReveal();}catch(e){} try{initBgFX();}catch(e){} try{initHeaderFx();}catch(e){} });
setInterval(function(){ try{tickClocks();}catch(e){} }, 1000);
