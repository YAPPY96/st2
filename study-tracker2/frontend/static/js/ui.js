// ── UI Utilities ───────────────────────────────────────────
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

let toastTimer;
function showToast(msg) {
    const t=document.getElementById('toast');
    t.textContent=msg; t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>t.classList.remove('on'),2300);
}

// ── Activity Charts ────────────────────────────────────────
function renderActivityCharts(stats) {
    const hours = Array.from({length: 14}, (_, i) => i + 7);
    const colors = {
        "暗記": { new: "#c8ff47", review: "#88aa00" },
        "問題": { new: "#4ade80", review: "#065f46" }
    };

    ["暗記", "問題"].forEach(type => {
        const container = document.getElementById(type === "暗記" ? "chartAnkiBars" : "chartProblemBars");
        const totalEl = document.getElementById(type === "暗記" ? "chartAnkiTotal" : "chartProblemTotal");
        if (!container) return;

        const typeStats = stats[type] || {};
        let totalActions = 0, maxCount = 5;

        hours.forEach(h => {
            const hData = typeStats[h] || { new: 0, review: 0 };
            const sum = hData.new + hData.review;
            if (sum > maxCount) maxCount = sum;
            totalActions += sum;
        });

        totalEl.textContent = `${totalActions} actions`;
        container.innerHTML = hours.map(h => {
            const hData = typeStats[h] || { new: 0, review: 0 };
            return `
                <div class="chart-column" data-hour="${h}">
                    <div class="chart-bar" style="height:${(hData.new/maxCount)*100}%; background:${colors[type].new}"></div>
                    <div class="chart-bar" style="height:${(hData.review/maxCount)*100}%; background:${colors[type].review}"></div>
                </div>`;
        }).join('');
    });
}

// ── Study Tab Rendering ─────────────────────────────────────
function renderStudy() {
    try {
        const el = document.getElementById('subjectList');
        if (!el) return;
        if (!subjects.length) { el.innerHTML=''; document.getElementById('emptyStudy').style.display='block'; return; }
        document.getElementById('emptyStudy').style.display='none';

        const cats = {};
        subjects.forEach(s => {
            const c = s.category || '（未分類）';
            if (!cats[c]) cats[c] = [];
            cats[c].push(s);
        });

        let html = '';
        Object.entries(cats).forEach(([cat, list]) => {
            if (Object.keys(cats).length > 1)
                html += `<div style="font-size:11px;font-weight:700;color:var(--t2);letter-spacing:1px;text-transform:uppercase;margin:16px 0 8px">${esc(cat)}</div>`;
            list.forEach(s => { html += buildCard(s); });
        });
        el.innerHTML = html;

        subjects.forEach(s => {
            try {
                renderProg(s.id);
                if (openCards.has(s.id)) renderTable(s.id);
            } catch (innerError) {
                console.error(`Error rendering subject ${s.id}:`, innerError);
            }
        });
    } catch (e) {
        console.error("renderStudy failed:", e);
    }
}

function buildCard(s) {
    const isOpen = openCards.has(s.id);
    const dl = s.deadline ? ` · 締切: ${s.deadline}` : '';
    return `
        <div class="card${isOpen?' open':''}" id="card-${s.id}" style="${s.is_paused ? 'opacity:0.7;' : ''}">
            <div class="card-hd">
                <div onclick="toggleCard(${s.id})" style="display:flex; align-items:center; gap:10px; flex:1; min-width:0">
                    <svg class="prog-ring" viewBox="0 0 36 36">
                        <circle class="ring-bg" cx="18" cy="18" r="15.9"/>
                        <circle class="ring-fg" id="ringfg-${s.id}" cx="18" cy="18" r="15.9" stroke-dasharray="100 100" stroke-dashoffset="100" transform="rotate(-90 18 18)"/>
                        <text x="18" y="21" text-anchor="middle" id="ringtxt-${s.id}">0%</text>
                    </svg>
                    <div style="flex:1; min-width:0">
                        <div style="display:flex;align-items:center;gap:6px">
                            <div class="card-name">${esc(s.name)}</div>
                            ${s.is_paused ? '<div style="font-size:10px;background:var(--t3);color:#fff;padding:0 4px;border-radius:3px;font-weight:bold">停止中</div>' : ''}
                        </div>
                        <div class="card-prog-lbl" id="proglbl-${s.id}">読込中…<span style="color:var(--t2)">${dl}</span></div>
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center">
                    <button class="btn btn-s btn-sm" style="padding:4px 8px; font-size:10px" onclick="togglePauseSubject(${s.id}, ${s.is_paused ?? 0})">${s.is_paused ? '再開' : '停止'}</button>
                    <div class="card-chevron" onclick="toggleCard(${s.id})">▾</div>
                </div>
            </div>
            <div id="att-${s.id}" style="display:none"></div>
            <div id="tbl-${s.id}" style="${isOpen?'':'display:none'}"></div>
        </div>`;
}

function renderProg(id) {
    const p = progCache[id];
    if (!p) return;
    const pct = p.total ? Math.round(p.mastered/p.total*100) : 0;
    const circ = 2 * Math.PI * 15.9;
    const fg = document.getElementById('ringfg-'+id);
    if (fg) { fg.setAttribute('stroke-dasharray',`${circ} ${circ}`); fg.style.strokeDashoffset = circ - (pct/100)*circ; }
    if (document.getElementById('ringtxt-'+id)) document.getElementById('ringtxt-'+id).textContent = pct+'%';
    const s = subjects.find(x=>x.id===id);
    const dl = s?.deadline ? ` · 締切:${s.deadline}` : '';
    if (document.getElementById('proglbl-'+id)) 
        document.getElementById('proglbl-'+id).innerHTML = `○${p.mastered}/${p.total}問 | 2周:${p.pass2_done}<span style="color:var(--t2)">${dl}</span>`;
}

function renderTable(id) {
    const probs = probCache[id];
    const container = document.getElementById('tbl-'+id);
    if (!container) return;

    if (!probs) {
        container.innerHTML = '<div style="padding:16px;color:var(--t2);text-align:center">読み込み中…</div>';
        return;
    }

    if (!probs.length) { 
        container.innerHTML = '<div style="padding:16px;color:var(--t2);text-align:center">問題がありません</div>'; 
        return; 
    }

    const atCnt = [0,0,0,0,0];
    probs.forEach(p => { 
        if (p.records) {
            for(let a=1;a<=5;a++) if(p.records[a]?.result) atCnt[a-1]++; 
        }
    });

    let html = `<div class="tbl-wrap"><table class="stbl"><thead><tr>
        <th>問題</th>
        ${[1,2,3,4,5].map((a,i)=>`<th>${a}回目<br><span style="font-size:9px;color:var(--t3);font-family:var(--mono)">${atCnt[i]}</span></th>`).join('')}
        <th>進捗</th>
    </tr></thead><tbody>`;

    let lastGroup = null;
    probs.forEach(p => {
        const g = p.group_label || '';
        if (g && g !== lastGroup) { html += `<tr class="grp-hd"><td colspan="7"># ${esc(g)}</td></tr>`; lastGroup = g; }
        const stClass = p.status===2?'st2':p.status===1?'st1':'st0';
        html += `<tr><td style="padding-left:10px"><div style="display:flex;align-items:center;gap:4px;max-width:115px"><div class="st-dot ${stClass}"></div><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px" title="${esc(p.label)}">${esc(p.label)}</span></div></td>`;
        for (let a=1;a<=5;a++) {
            const rec = p.records[a];
            const state = rec?.result==='o'?'ro':rec?.result==='x'?'rx':'';
            const sym = rec?.result==='o'?'○':rec?.result==='x'?'×':'';
            const dt = rec?.recorded_at ? rec.recorded_at.slice(5,10) : '';
            html += `<td><div class="rc ${state}" onclick="cycleResult(${id},${p.id},${a},this)">${sym}<span class="rc-date">${dt}</span></div></td>`;
        }
        const sBtnClass = p.status===2?'s2':p.status===1?'s1':'';
        const sLbl = p.status===0?'−':p.status===1?'①':'②';
        html += `<td><div class="st-btn ${sBtnClass}" onclick="cycleStatus(${id},${p.id},${p.status},this)">${sLbl}</div></td></tr>`;
    });
    container.innerHTML = html + '</tbody></table></div>';
    
    const os = [1,2,3,4,5].map(a => probs.filter(p=>p.records[a]?.result==='o').length);
    const xs = [1,2,3,4,5].map(a => probs.filter(p=>p.records[a]?.result==='x').length);
    document.getElementById('att-'+id).innerHTML = `<div class="att-summary">${[1,2,3,4,5].map(a => `<div class="att-pill">${a}回: <span class="o">○${os[a-1]}</span> <span class="x">×${xs[a-1]}</span></div>`).join('')}</div>`;
}

// ── Dashboard Rendering ─────────────────────────────────────
function renderDashboard() {
    const el = document.getElementById('dashboardList');
    if (!el) return;
    if (!subjects || !subjects.length) { 
        el.innerHTML = '<div style="color:var(--t2);text-align:center;padding:50px 0">題材を追加してください</div>'; 
        return; 
    }

    const scroll = window.scrollY;
    el.innerHTML = subjects.map(s => {
        const quota = quotaCache[s.id] || {};
        const srsItems = (srsQueue || [])
            .filter(x => x.subject_id === s.id)
            .sort((a, b) => {
                // state=1 (忘れた) は各科目内の最後に
                if (a.state !== b.state) {
                    if (a.state === 1) return 1;
                    if (b.state === 1) return -1;
                }
                // それ以外は sort_order 優先
                if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
                // ラベル比較（自然順に近い比較）
                if (a.label.length !== b.label.length) return a.label.length - b.label.length;
                return a.label.localeCompare(b.label);
            });
        const isOpen = openDashSubjects.has(s.id);

        const srsBadge = srsItems.length > 0 ? `<div class="ds-badge ds-badge-srs">復習 ${srsItems.length}</div>` : '';
        const done = quota.today_done || 0;
        const total = quota.today_total || 0;
        const pctRaw = total ? (done / total) * 100 : 100;
        const pct = Number.isInteger(pctRaw) ? pctRaw.toString() : pctRaw.toFixed(1);
        
        return `
            <div class="dash-subject ${isOpen?'open':''}" id="ds-${s.id}" style="${s.is_paused ? 'display:none' : ''}">
                <div class="dash-subject-hd">
                    <div class="ds-info" onclick="toggleDashSubject(${s.id})">
                        <div class="ds-name">${esc(s.name)}</div>
                        <div class="ds-meta">${srsBadge}<span class="ds-progress-text">${done} / ${total} (${pct}%)</span></div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center">
                        <button class="btn btn-s btn-sm" style="padding:4px 8px; font-size:10px; background:transparent; border-color:var(--bd)" onclick="togglePauseSubject(${s.id}, ${s.is_paused ?? 0})">停止</button>
                        <div class="ds-chevron" onclick="toggleDashSubject(${s.id})">▾</div>
                    </div>
                </div>
                <div class="dash-subject-content">
                    ${renderDashSRS(srsItems)}
                    ${renderDashQuota(s.id, quota)}
                </div>
            </div>`;
    }).join('');
    window.scrollTo(0, scroll);
}

function renderDashSRS(items) {
    if (!items.length) return '';
    return `<div style="margin-top:14px"><div class="d-quota-title">Section A — 復習キュー</div>
        ${items.map(item => `
            <div class="ds-srs-item" id="srs-item-${item.problem_id}">
                <div class="ds-srs-label">${esc(item.label)}</div>
                <div class="ds-srs-meta">安定性: ${item.stability.toFixed(1)}日</div>
                <div class="rating-btns">
                    <button class="r-btn r1" onclick="reviewSRS(${item.problem_id},1)">忘れた<span>10分後</span></button>
                    <button class="r-btn r2" onclick="reviewSRS(${item.problem_id},2)">ムズい<span>${Math.max(1, Math.round(item.stability*1.2))}日後</span></button>
                    <button class="r-btn r3" onclick="reviewSRS(${item.problem_id},3)">普通<span>${Math.max(1, Math.round(item.stability*2.5))}日後</span></button>
                    <button class="r-btn r4" onclick="reviewSRS(${item.problem_id},4)">易しい<span>${Math.max(1, Math.round(item.stability*4.0))}日後</span></button>
                </div>
            </div>`).join('')}</div>`;
}

function renderDashQuota(sid, quota) {
    if (quota.no_deadline) return `<div class="d-quota-box"><div class="d-quota-title">Section B — 本日の進捗</div><div style="font-size:12px;color:var(--t2);margin-top:8px">締切未設定</div></div>`;
    const pct = quota.total_tasks ? Math.round(quota.completed_tasks/quota.total_tasks*100) : 0;
    const color = quota.behind ? 'var(--red)' : 'var(--acc)';
    return `<div class="d-quota-box">
        <div class="d-quota-hd"><div class="d-quota-title">Section B — 本日の進捗目標</div></div>
        <div style="display:flex;align-items:baseline;gap:8px"><div class="d-quota-val" style="color:${color}">${quota.daily_quota}</div><div style="font-size:12px;color:var(--t2)">問/日</div></div>
        <div class="d-quota-range">目標: 問${quota.target_start} 〜 問${quota.target_end}</div>
        <div class="d-quota-bar-outer"><div class="d-quota-bar-inner" style="width:${pct}%;background:${color}"></div></div>
    </div>`;
}

// ── Manage Tab Rendering ─────────────────────────────────────
function renderManage() {
    try {
        const el = document.getElementById('manageList');
        if (!el) return;
        if (!subjects || !subjects.length) {
            el.innerHTML = '';
            document.getElementById('emptyManage').style.display = 'block';
            return;
        }
        document.getElementById('emptyManage').style.display = 'none';

        el.innerHTML = subjects.map(s => `
            <div class="card" style="margin-bottom:8px; position:relative; ${s.is_paused ? 'opacity:0.7;' : ''}">
                <div class="card-hd" style="cursor:default">
                    <div style="flex:1;min-width:0">
                        <div style="display:flex;align-items:center;gap:8px">
                            <div style="font-size:10px;color:var(--t2);margin-bottom:2px">${esc(s.category || '未分類')}</div>
                            ${s.is_paused ? '<div style="font-size:10px;background:var(--t3);color:#fff;padding:0 4px;border-radius:3px;font-weight:bold">停止中</div>' : ''}
                        </div>
                        <div class="card-name">${esc(s.name)}</div>
                        <div style="font-size:11px;color:var(--t3);margin-top:2px">ID: ${s.id} · タイプ: ${s.type_tag || '問題'}${s.deadline ? ` · 締切: ${s.deadline}` : ''}</div>
                    </div>
                    <div style="display:flex;gap:8px">
                        <button class="btn btn-s btn-sm" onclick="togglePauseSubject(${s.id}, ${s.is_paused ?? 0})">${s.is_paused ? '再開' : '停止'}</button>
                        <button class="btn btn-s btn-sm" onclick="openEditModal(${s.id})">編集</button>
                        <button class="btn btn-s btn-sm" style="color:var(--red)" onclick="doDelete(${s.id}, ${JSON.stringify(s.name).replace(/"/g, '&quot;')})">削除</button>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (e) { console.error("renderManage failed:", e); }
}

// ── History Rendering ───────────────────────────────────────
function renderHistory(data) {
    const el = document.getElementById('historyList');
    if (!el) return;
    if (!data || !data.length) {
        el.innerHTML = '<div class="empty"><div class="ico">📅</div><p>記録がありません</p></div>';
        return;
    }

    let html = '<div class="history-container">';
    data.forEach(item => {
        const subGroup = {};
        item.activities.forEach(act => {
            if (!subGroup[act.subject_name]) {
                subGroup[act.subject_name] = [];
            }
            let resStr = act.result === 'o' ? '○' : act.result === 'x' ? '×' : '';
            if (act.action_type === 'srs') {
                const rating = parseInt(act.result);
                if (rating === 1) resStr = '忘';
                else if (rating === 2) resStr = '難';
                else if (rating === 3) resStr = '普';
                else if (rating === 4) resStr = '易';
            }
            const labelWithRes = act.problem_label + (resStr ? ` (${resStr})` : '');
            subGroup[act.subject_name].push(labelWithRes);
        });

        const subjectRows = Object.entries(subGroup).map(([subName, labels]) => `
            <div class="history-row">
                <div class="history-subject">${esc(subName)}</div>
                <div class="history-items">${labels.map(label => `<span class="history-chip">${esc(label)}</span>`).join('')}</div>
            </div>
        `).join('');

        const dateObj = new Date(item.date);
        const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][dateObj.getDay()];
        const formattedDate = `${item.date} (${dayOfWeek})`;

        html += `
            <div class="history-day-card">
                <div class="history-day-head">
                    <div class="history-date">${formattedDate}</div>
                    <div class="history-count">${item.activities.length}件</div>
                </div>
                <div class="history-rows">${subjectRows}</div>
            </div>
        `;
    });
    html += '</div>';
    el.innerHTML = html;
}

