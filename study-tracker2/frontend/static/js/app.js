// ── STATE ──────────────────────────────────────────────────
let subjects = [];
let openCards = new Set();
let openDashSubjects = new Set();
let probCache = {}, progCache = {}, quotaCache = {};
let srsQueue = [];
let isFirstDashboardLoad = true;

// ── INITIALIZATION ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    const hdDate = document.getElementById('hdDate');
    if (hdDate) hdDate.textContent = now.toLocaleDateString('ja-JP', {year:'numeric', month:'short', day:'numeric', weekday:'short'});
    
    try {
        await loadSubjects();
        await refreshToday();
        await loadDashboard();
    } catch (e) { console.error("Init failed:", e); }
});

// ── DATA LOADING ────────────────────────────────────────────
async function refreshToday() {
    const s = await api('/stats/today');
    const pct = s.total ? Math.min(100, Math.round(s.done / s.total * 100)) : 100;
    document.getElementById('todayDone').textContent = s.done;
    document.getElementById('todayTotal').textContent = s.total;
    document.getElementById('goalBar').style.width = pct + '%';
    document.getElementById('goalPct').textContent = `今日 ${s.done} / ${s.total} タスク (${pct}%)`;
    const badge = document.getElementById('srsBadge');
    const pending = s.srs_total - s.srs_done;
    document.getElementById('srsPending').textContent = pending;
    badge.className = 'srs-badge' + (pending === 0 ? ' done' : '');
}

async function loadSubjects() {
    subjects = await api('/subjects');
    subjects.forEach(s => { if (s.total !== undefined) progCache[s.id] = { total: s.total, mastered: s.mastered, pass2_done: s.pass2_done }; });
    renderStudy();
    renderManage();
}

async function loadDashboard() {
    const [qArr, sArr, hStats] = await Promise.all([
        Promise.all(subjects.map(s => api(`/subjects/${s.id}/quota`))),
        api('/srs/queue'),
        api('/stats/hourly')
    ]);
    srsQueue = sArr;
    
    // 初回ロード時のみ復習がある題材を自動的に開く
    if (isFirstDashboardLoad && srsQueue && srsQueue.length > 0) {
        srsQueue.forEach(item => {
            openDashSubjects.add(Number(item.subject_id));
        });
        isFirstDashboardLoad = false;
    }

    subjects.forEach((s, i) => { quotaCache[s.id] = qArr[i]; });
    renderActivityCharts(hStats);
    renderDashboard();
}

// ── ACTIONS ─────────────────────────────────────────────────
async function cycleResult(sid, pid, attempt, el) {
    const cur = el.classList.contains('ro')?'o':el.classList.contains('rx')?'x':null;
    const next = cur===null?'o':cur==='o'?'x':null;
    el.classList.remove('ro','rx');
    el.firstChild.textContent = next==='o'?'○':next==='x'?'×':'';
    if (next) el.classList.add(next==='o'?'ro':'rx');
    try {
        const res = await api(`/problems/${pid}/record/${attempt}`, 'POST', {result: next});
        if (el.querySelector('.rc-date')) el.querySelector('.rc-date').textContent = res.recorded_at.slice(5,10);
        if (probCache[sid]) {
            const p = probCache[sid].find(x=>x.id===pid);
            if (p) { if (!p.records[attempt]) p.records[attempt]={}; p.records[attempt].result=next; p.records[attempt].recorded_at=res.recorded_at; }
        }
        await loadDashboard();
        progCache[sid] = await api(`/subjects/${sid}/progress`);
        renderProg(sid);
        renderTable(sid); // 明示的に表を再描画
        await refreshToday();
    } catch(e) { showToast('保存できませんでした'); }
}

async function cycleStatus(sid, pid, currentStatus, el) {
    const next = currentStatus===0?1:currentStatus===1?2:0;
    await api(`/problems/${pid}/status`, 'PATCH', {status: next});
    if (probCache[sid]) {
        const p = probCache[sid].find(x=>x.id===pid);
        if (p) p.status = next;
    }
    progCache[sid] = await api(`/subjects/${sid}/progress`);
    renderProg(sid); renderTable(sid);
    await loadDashboard(); await refreshToday();
}

async function reviewSRS(pid, rating) {
    try {
        const res = await api('/srs/review', 'POST', {problem_id: pid, rating});
        showToast(rating === 1 ? '最下部に移動しました' : `次回は ${res.interval}日後です`);
        
        const el = document.getElementById('srs-item-' + pid);
        if (el) {
            if (rating === 1) {
                // 「忘れた」場合はリストの最後に移動
                const parent = el.parentElement;
                el.style.opacity = '0.6';
                parent.appendChild(el); 
            } else {
                // それ以外は消す
                el.style.opacity = '0.3';
                el.style.pointerEvents = 'none';
            }
        }
        
        // 評価が1の場合は少し長めに待ってから更新（連続演習のため）
        setTimeout(() => { loadDashboard(); refreshToday(); }, rating === 1 ? 2000 : 400);
    } catch (e) {
        showToast('エラーが発生しました');
    }
}

// ── UI TOGGLES ──────────────────────────────────────────────
async function toggleCard(id) {
    if (openCards.has(id)) { 
        openCards.delete(id); 
    } else { 
        openCards.add(id); 
        if (!probCache[id]) {
            try {
                probCache[id] = await api(`/subjects/${id}/problems`);
                renderTable(id); // 明示的に描画を呼ぶ
            } catch (e) { console.error("Failed to load problems:", e); }
        }
    }
    renderStudy();
}

function toggleDashSubject(id) {
    const sid = Number(id);
    if (openDashSubjects.has(sid)) { 
        openDashSubjects.delete(sid); 
    } else { 
        openDashSubjects.add(sid); 
    }
    renderDashboard();
}

function switchTab(name, btn) {
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('on'));
    document.getElementById('page-'+name).classList.add('on');
    (btn || document.getElementById('tab-'+name)).classList.add('on');
    if (name==='dashboard') loadDashboard();
    if (name==='history') loadHistory();
}
async function loadHistory() {
    try {
        const data = await api('/history');
        renderHistory(data);
    } catch (e) {
        console.error("Failed to load history:", e);
        showToast("履歴の読み込みに失敗しました");
    }
}
function switchTabByName(name) { switchTab(name, document.getElementById('tab-'+name)); }

// ── MODALS ──────────────────────────────────────────────────
function openAddModal() { document.getElementById('addOverlay').classList.add('on'); }
function closeModal(id) { document.getElementById(id).classList.remove('on'); }
function overlayClick(e,id) { if(e.target.classList.contains('overlay')) closeModal(id); }

async function createSubject() {
    const name = document.getElementById('inName').value.trim();
    const cat = document.getElementById('inCat').value.trim();
    const type_tag = document.getElementById('inType').value;
    const deadline = document.getElementById('inDeadline').value || null;
    if (!name) return showToast('題材名を入力してください');
    
    let problems = [];
    if (document.getElementById('inMode').value === 'count') {
        const cnt = parseInt(document.getElementById('inCount').value);
        const pre = document.getElementById('inPrefix').value.trim();
        problems = Array.from({length:cnt},(_,i)=>({label:pre?`${pre}-問${i+1}`:`問${i+1}`}));
    } else {
        const lines = document.getElementById('inList').value.split('\n').map(l=>l.trim()).filter(Boolean);
        let cur=''; lines.forEach(l=>{ if(l.startsWith('#')){cur=l.slice(1).trim();}else{problems.push({label:l,group_label:cur});} });
    }
    
    try {
        await api('/subjects','POST',{name,category:cat,type_tag,problems,deadline});
        closeModal('addOverlay'); showToast('作成しました！'); await loadSubjects(); await loadDashboard();
    } catch(e) { showToast('作成に失敗しました'); }
}

function openEditModal(sid) {
    const s = subjects.find(x => x.id === sid);
    if (!s) return;
    document.getElementById('editTargetId').value = s.id;
    document.getElementById('editCat').value = s.category || '';
    document.getElementById('editName').value = s.name || '';
    document.getElementById('editType').value = s.type_tag || '問題';
    document.getElementById('editDeadline').value = s.deadline || '';
    document.getElementById('editOverlay').classList.add('on');
}

async function saveEditSubject() {
    const sid = document.getElementById('editTargetId').value;
    const data = {
        name: document.getElementById('editName').value.trim(),
        category: document.getElementById('editCat').value.trim(),
        type_tag: document.getElementById('editType').value,
        deadline: document.getElementById('editDeadline').value || ""
    };
    try {
        await api(`/subjects/${sid}`, 'PATCH', data);
        closeModal('editOverlay'); showToast('更新しました'); await loadSubjects(); await loadDashboard();
    } catch(e) { showToast('更新に失敗しました'); }
}

async function togglePauseSubject(sid, isPaused) {
    try {
        await api(`/subjects/${sid}`, 'PATCH', { is_paused: isPaused ? 0 : 1 });
        showToast(isPaused ? '再開しました' : '停止しました');
        await loadSubjects();
        await refreshToday();
        await loadDashboard();
    } catch(e) {
        showToast('操作に失敗しました');
    }
}

async function doDelete(id, name) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await api(`/subjects/${id}`, 'DELETE');
    openCards.delete(id); openDashSubjects.delete(id);
    showToast('削除しました'); await loadSubjects(); await loadDashboard();
}

async function syncToBlinko() {
    try {
        showToast('Blinkoに送信中...');
        const res = await api('/admin/blinko/sync', 'POST');
        if (res.ok) {
            showToast('Blinkoに送信しました');
        } else {
            showToast('送信に失敗しました');
        }
    } catch (e) {
        showToast('エラーが発生しました');
        console.error(e);
    }
}
