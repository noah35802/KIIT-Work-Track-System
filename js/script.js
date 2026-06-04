// ─── ETA calculation engine ──────────────────────────────────────────────────
// Base ETAs (working days) per workflow type
const BASE_ETA = { scholarship:4, leave:1, budget:8, research:15, exam:2 };

// Priority multipliers
const PRIORITY_MULT = { critical:0.5, high:0.7, normal:1.0, low:1.4 };

// File type complexity weight (adds days based on complexity of doc type)
const EXT_WEIGHT = {
  pdf:0, doc:0, docx:0, txt:-0.5,
  xlsx:1, pptx:0.5,
  png:0.5, jpg:0.5, jpeg:0.5,
  zip:1.5
};

// File size impact: large files take longer to process (administrative review)
function sizeImpact(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return -0.3;
  if (mb < 0.5) return 0;
  if (mb < 2)   return 0.5;
  if (mb < 10)  return 1;
  if (mb < 50)  return 2;
  return 3;
}

function calcETA(fileObj, fileType, priority) {
  const base = BASE_ETA[fileType] || 3;
  const ext = (fileObj.name.split('.').pop() || '').toLowerCase();
  const extW = EXT_WEIGHT[ext] ?? 0;
  const sizeW = sizeImpact(fileObj.size);
  const mult = PRIORITY_MULT[priority] || 1;
  const raw = (base + extW + sizeW) * mult;
  const days = Math.max(0.5, Math.round(raw * 2) / 2); // round to 0.5
  return days;
}

function etaLabel(days) {
  if (days < 1) return `${Math.round(days * 8)} working hours`;
  if (days === 1) return '1 working day';
  return `${days % 1 === 0 ? days : days.toFixed(1)} working days`;
}

function etaColor(days) {
  if (days <= 1) return '#4ade80';
  if (days <= 3) return '#2ec4a0';
  if (days <= 7) return '#f5a623';
  return '#ff6b5b';
}

// ─── File data (routes + messages) ──────────────────────────────────────────
const FILE_DATA = {
  scholarship: {
    label:'Scholarship Application', id:'KIIT-SCH-',
    depts:'Dept → Finance → Dean → Registrar',
    msgs: [
      ['head','── New file uploaded ──'],
      ['info','Reading file metadata, assigning tracking ID'],
      ['info','Routing: Dept → Finance → Dean → Registrar (4-stage)'],
      ['info','File persisted to workflow database with audit log'],
      ['info','Prediction agent computing ETA from file size + type…'],
      ['warn','Monitoring: moderate backlog at Finance Office detected'],
      ['info','Analytics: workflow complexity = MEDIUM, auto-escalation eligible'],
      ['info','Notification: Email to applicant, SMS to Finance HOD'],
      ['success','✓ Live on Admin Dashboard · Status: PENDING FINANCE'],
    ]
  },
  leave: {
    label:'Leave Request', id:'LR-NOV-',
    depts:'HOD → HR Office',
    msgs: [
      ['head','── New file uploaded ──'],
      ['info','Registering leave request, reading attachment'],
      ['info','Routing: Department Head → HR Office (2-step fast-track)'],
      ['info','Saved to workflow database'],
      ['info','Prediction agent: low complexity route, computing ETA…'],
      ['info','Monitoring: no stagnation risk detected'],
      ['info','Analytics: standard leave workflow, no anomalies'],
      ['info','Notification: WhatsApp alert to HOD'],
      ['success','✓ On Dashboard · Status: AWAITING HOD APPROVAL'],
    ]
  },
  budget: {
    label:'Budget Approval', id:'FIN-Q4-',
    depts:'Dept → Finance → Director → CFO',
    msgs: [
      ['head','── New file uploaded ──'],
      ['info','Registering budget approval, analysing attachment size'],
      ['info','Routing: Dept → Finance → Director → CFO (4-stage escalation)'],
      ['info','Logged with dependency mapping and version history'],
      ['warn','Prediction agent: HIGH complexity detected, computing adjusted ETA…'],
      ['warn','Monitoring: similar file detected in queue — flagged for dedup check'],
      ['info','Analytics: CFO queue at 6 items, position assigned'],
      ['info','Notifications: Email to Finance team, Director, CFO office'],
      ['success','✓ On CFO Dashboard · Status: PENDING FINANCE REVIEW'],
    ]
  },
  research: {
    label:'Research Proposal', id:'RP-SCA-',
    depts:'PI → Ethics → Research Office → VC',
    msgs: [
      ['head','── New file uploaded ──'],
      ['info','Registering research proposal, parsing document structure'],
      ['info','Routing: PI → Ethics Board → Research Office → VC (complex)'],
      ['info','Full metadata + dependency graph stored'],
      ['warn','Prediction: large document + Ethics Board congestion → extended ETA'],
      ['warn','Monitoring: alternate fast-track via Ethics sub-committee suggested'],
      ['info','Analytics: grant proposals avg 12d this semester'],
      ['info','Alerts: Email to PI and Research Office coordinator'],
      ['success','✓ On Research Portal · Status: AWAITING ETHICS REVIEW'],
    ]
  },
  exam: {
    label:'Exam Permission', id:'EP-2026-',
    depts:'Dept → Controller → Registrar',
    msgs: [
      ['head','── New file uploaded ──'],
      ['info','Registering exam permission, checking exam date dependency'],
      ['info','Routing: Dept → Controller of Exams → Registrar'],
      ['info','Saved with deadline flag to workflow database'],
      ['info','Prediction: deadline-aware routing active, computing ETA…'],
      ['info','Monitoring: deadline proximity — urgent flag enabled'],
      ['info','Analytics: 47 similar requests this week, avg 1.8d clearance'],
      ['info','Notification: in-app alert to Controller office'],
      ['success','✓ On Exam Dashboard · Status: PENDING CONTROLLER APPROVAL'],
    ]
  }
};

const STAGES = [
  { nodeId:'n-user',   pipes:['p1'],                          msgIdx:1 },
  { nodeId:'n-portal', pipes:['p2'],                          msgIdx:2 },
  { nodeId:'n-routing',pipes:['p3'],                          msgIdx:3 },
  { nodeId:'n-db',     pipes:['p4','bar1','p5a','p5b','p5c'], msgIdx:4 },
  { nodeId:'n-pred',   pipes:['p6a'],                         msgIdx:5 },
  { nodeId:'n-mon',    pipes:['p6b'],                         msgIdx:6 },
  { nodeId:'n-ana',    pipes:['p6c'],                         msgIdx:7 },
  { nodeId:'n-notif',  pipes:['bar2','p7','p8'],               msgIdx:8 },
  { nodeId:'n-dash',   pipes:[],                              msgIdx:9 },
];
const STAGE_DELAYS = [0,900,1800,2700,3500,3700,3900,5000,6200];
const STAGE_NAMES  = ['Upload','Portal','Routing','Database','Prediction','Monitoring','Analytics','Notification','Dashboard'];

// ─── State ────────────────────────────────────────────────────────────────────
let timers=[], active=false, counter=1000, uploadedFile=null, currentETA=null;

// ─── Build progress bar ───────────────────────────────────────────────────────
(function(){
  const row = document.getElementById('progress-row');
  row.innerHTML = STAGE_NAMES.map((n,i)=>
    `<div class="prog-step" id="prog-${i}" title="${n}"></div>`
  ).join('<div style="width:3px;height:4px;background:var(--border2);border-radius:1px;flex-shrink:0"></div>');
})();

// ─── File icon by extension ───────────────────────────────────────────────────
function fileIcon(name) {
  const ext = (name.split('.').pop()||'').toLowerCase();
  const map = {pdf:'📕',doc:'📘',docx:'📘',txt:'📄',xlsx:'📗',pptx:'📙',png:'🖼️',jpg:'🖼️',jpeg:'🖼️',zip:'🗜️'};
  return map[ext] || '📄';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes+'B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/(1024*1024)).toFixed(2)+'MB';
}

// ─── Handle file input ────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', function(e){
  handleFile(e.target.files[0]);
});

// Drag & drop
const zone = document.getElementById('upload-zone');
zone.addEventListener('dragover', e=>{ e.preventDefault(); zone.classList.add('drag'); });
zone.addEventListener('dragleave', ()=> zone.classList.remove('drag'));
zone.addEventListener('drop', e=>{
  e.preventDefault(); zone.classList.remove('drag');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  uploadedFile = file;

  // Show preview
  document.getElementById('file-icon').textContent = fileIcon(file.name);
  document.getElementById('file-name').textContent = file.name;
  const ext = (file.name.split('.').pop()||'').toUpperCase();
  document.getElementById('file-meta').textContent = `${ext} · ${formatSize(file.size)} · modified ${new Date(file.lastModified).toLocaleDateString()}`;
  document.getElementById('file-preview').classList.add('show');

  // Update info cards immediately
  document.getElementById('info-fname').textContent = file.name;
  document.getElementById('info-size').textContent = formatSize(file.size);
  document.getElementById('info-ftype').textContent = ext || '—';

  // Compute ETA and show bar
  updateETA();

  // Enable submit
  document.getElementById('submit-btn').disabled = false;
  document.querySelector('.layout > .card:nth-child(2) > div:last-child').style.display='none';

  log(`File selected: ${file.name} (${formatSize(file.size)})`, 'info');
}

function updateETA() {
  if (!uploadedFile) return;
  const ft = document.getElementById('file-type').value;
  const pr = document.getElementById('priority').value;
  const days = calcETA(uploadedFile, ft, pr);
  currentETA = days;

  const label = etaLabel(days);
  const color = etaColor(days);
  const pct = Math.min(100, Math.max(5, (days / 20) * 100));

  document.getElementById('eta-display').textContent = label;
  document.getElementById('eta-bar-fill').style.width = pct+'%';
  document.getElementById('eta-bar-fill').style.background = color;
  document.getElementById('eta-bar-wrap').style.display = 'block';
  document.getElementById('info-eta').textContent = label;
  document.getElementById('info-priority').textContent = { critical:'CRITICAL', high:'HIGH', normal:'NORMAL', low:'LOW' }[pr];
}

// Re-calculate ETA when selects change
document.getElementById('file-type').addEventListener('change', updateETA);
document.getElementById('priority').addEventListener('change', updateETA);

function removeFile() {
  uploadedFile = null; currentETA = null;
  document.getElementById('file-input').value = '';
  document.getElementById('file-preview').classList.remove('show');
  document.getElementById('eta-bar-wrap').style.display = 'none';
  document.getElementById('submit-btn').disabled = true;
  document.querySelector('.layout > .card:nth-child(2) > div:last-child').style.display='';
  ['info-fname','info-size','info-ftype','info-priority','info-eta','info-id','info-depts','info-status'].forEach(id=>document.getElementById(id).textContent='—');
  log('File removed.', 'info');
}

// ─── Log ──────────────────────────────────────────────────────────────────────
function log(msg, type='info') {
  const el = document.getElementById('log');
  const ts = new Date().toLocaleTimeString('en-GB',{hour12:false});
  const e = document.createElement('div');
  e.className='log-entry';
  e.innerHTML=`<span class="log-ts">${ts}</span><span class="log-msg ${type}">${msg}</span>`;
  el.prepend(e);
}

function setPipes(ids,on){ ids.forEach(id=>{ const e=document.getElementById(id); if(e) e.classList.toggle('active',on); }); }
function setNodeActive(id,on){ const e=document.getElementById(id); if(e) e.classList.toggle('node-active',on); }
function setProgress(i,state){ const e=document.getElementById(`prog-${i}`); if(!e) return; e.classList.remove('active','done'); if(state) e.classList.add(state); }

// ─── Submit ───────────────────────────────────────────────────────────────────
function submitFile() {
  if (active || !uploadedFile) return;
  active = true;
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('log').innerHTML = '';

  const ft = document.getElementById('file-type').value;
  const pr = document.getElementById('priority').value;
  const data = FILE_DATA[ft];
  const fileId = data.id + (++counter);
  const prLabel = {critical:'CRITICAL',high:'HIGH',normal:'NORMAL',low:'LOW'}[pr];
  const etaStr = etaLabel(currentETA || calcETA(uploadedFile, ft, pr));

  document.getElementById('info-id').textContent = fileId;
  document.getElementById('info-priority').textContent = prLabel;
  document.getElementById('info-eta').textContent = etaStr;
  document.getElementById('info-depts').textContent = data.depts;
  document.getElementById('info-status').textContent = 'PROCESSING';

  log(`Submitting: ${uploadedFile.name} [${prLabel}] → ${data.label}`, 'head');

  STAGES.forEach((stage,i) => {
    const t = setTimeout(() => {
      if (i>0){ setNodeActive(STAGES[i-1].nodeId,false); setProgress(i-1,'done'); }
      setProgress(i,'active');
      setNodeActive(stage.nodeId,true);
      setPipes(stage.pipes,true);
      document.getElementById('status-bar').textContent = `[ ${STAGE_NAMES[i].toUpperCase()} ]  ${data.msgs[stage.msgIdx-1]?.[1]||''}`;
      // Inject real ETA into prediction message
      let [type,msg] = data.msgs[stage.msgIdx-1]||['info',''];
      if (stage.nodeId==='n-pred') msg = msg.replace('computing ETA…',`ETA = ${etaStr}`).replace('computing adjusted ETA…',`adjusted ETA = ${etaStr}`).replace('computing ETA…',`ETA = ${etaStr}`);
      log(msg, type);
    }, STAGE_DELAYS[i]);
    timers.push(t);
  });

  timers.push(setTimeout(()=>{
    setNodeActive(STAGES[STAGES.length-1].nodeId,false);
    setProgress(STAGES.length-1,'done');
    document.getElementById('info-status').textContent='COMPLETE';
    document.getElementById('status-bar').textContent=`✓ ${fileId} processed · ETA: ${etaStr} from today`;
    active=false;
    document.getElementById('submit-btn').disabled=false;
  }, STAGE_DELAYS[STAGES.length-1]+900));
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetAll() {
  timers.forEach(clearTimeout); timers=[]; active=false;
  document.getElementById('submit-btn').disabled = !uploadedFile;
  document.getElementById('log').innerHTML='<div class="log-entry"><span class="log-ts">--:--:--</span><span class="log-msg">Waiting for file upload…</span></div>';
  document.getElementById('status-bar').textContent='— upload a file to begin —';
  ['info-id','info-depts','info-status'].forEach(id=>document.getElementById(id).textContent='—');
  STAGES.forEach((s,i)=>{ setNodeActive(s.nodeId,false); setPipes(s.pipes,false); setProgress(i,''); });
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.node-group').forEach(g=>{
  g.addEventListener('mousemove', e=>{
    const tt=document.getElementById('tooltip'), tip=g.dataset.tip;
    if(!tip) return;
    tt.textContent=tip; tt.classList.add('show');
    tt.style.left=(e.clientX+14)+'px'; tt.style.top=(e.clientY-8)+'px';
  });
  g.addEventListener('mouseleave',()=>document.getElementById('tooltip').classList.remove('show'));
});