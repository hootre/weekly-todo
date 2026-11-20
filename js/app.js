/* 위클리 — 주간/월간 할 일 보드 (Supabase + SortableJS, no build) */
(() => {
  'use strict';

  // ================= utils =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const firstOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const today = () => ymd(new Date());
  const DOW = ['월', '화', '수', '목', '금', '토', '일'];
  const dowOf = s => DOW[(fromYmd(s).getDay() + 6) % 7];
  const md = s => { const d = fromYmd(s); return `${d.getMonth() + 1}.${d.getDate()}`; };
  const dayLabel = s => { const d = fromYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dowOf(s)})`; };
  const STATUSES = ['기획', '촬영', '편집', '수정대기', '완료'];
  const GOALS = ['완료', '완성', '기획', '수정', '컨펌', '업로드', '준비'];
  // 클라이언트 색 (제목 맨 앞 [클라이언트]마다 하나씩). 앞쪽일수록 서로 확실히 달라 보이는 순서.
  // 초록(마지막)은 [개인] 몫이라 자동으로는 안 줌
  const PALETTE = ['#4c8dff', '#ff5c5c', '#f2a516', '#a66bff', '#17b3a3', '#f0559b', '#7cbb1e', '#b08a5a', '#22b8d6', '#ff7a2f', '#6a6fff', '#d65cf0', '#2fbf71'];
  const GREEN = '#2fbf71';
  const PERSONAL = '개인';
  // 구글 캘린더 일정 색 (colorId · 이름 · 색)
  const GCOLORS = [['1', '라벤더', '#7986cb'], ['2', '세이지', '#33b679'], ['3', '포도', '#8e24aa'], ['4', '플라밍고', '#e67c73'],
    ['5', '바나나', '#f6bf26'], ['6', '귤', '#f4511e'], ['7', '공작', '#039be5'], ['8', '흑연', '#616161'],
    ['9', '블루베리', '#3f51b5'], ['10', '바질', '#0b8043'], ['11', '토마토', '#d50000']];
  const gcolor = id => GCOLORS.find(c => c[0] === id) || null;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const haptic = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* noop */ } };
  const short = (s, n = 14) => (s.length > n ? s.slice(0, n) + '…' : s);
  const ICON = {
    pen: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* noop */ } },
  };


  // ================= config / client =================
  const CFG = window.WEEKLY_CONFIG || {};
  const configured = CFG.supabaseUrl && CFG.supabaseKey && !/YOUR_/.test(CFG.supabaseUrl + CFG.supabaseKey);
  const sb = configured ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'weekly-auth' },
  }) : null;
  const appUrl = () => location.origin + location.pathname;

  // ================= state =================
  const S = {
    session: null, me: null, entered: false,
    view: ls.get('weekly-view', 'week') === 'month' ? 'month' : 'week',
    weekStart: mondayOf(new Date()), month: firstOfMonth(new Date()),
    tasks: [], plans: [], notes: {}, settings: {}, members: [],
    filter: 'all', dragging: false, pendingRender: false, lastDragEnd: 0,
    sheet: null, prevStatus: {}, syncing: false, sortablesReady: false, followToday: true, unfold: new Set(), lastSwipe: 0,
  };
  const taskById = id => S.tasks.find(t => t.id === id);
  const planById = id => S.plans.find(p => p.id === id);
  const bySort = (a, b) => (a.sort - b.sort) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const weekDays = () => [...Array(7)].map((_, i) => ymd(addDays(S.weekStart, i)));
  function monthDays() {
    const first = S.month, last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const out = []; for (let d = mondayOf(first), end = addDays(mondayOf(last), 6); d <= end; d = addDays(d, 1)) out.push(ymd(d));
    return out;
  }
  const periodDays = () => (S.view === 'month' ? monthDays() : weekDays());
  const plansOn = d => S.plans.filter(p => p.day === d).sort(bySort);
  const note = key => S.notes[key] || (S.notes[key] = { key, content: null, rest: false });
  const planTitle = p => { const t = p.task_id && taskById(p.task_id); return t ? t.title : (p.title || '(제목 없음)'); };
  const keywords = () => (S.settings.cal_keyword || '동준').split(',').map(x => x.trim()).filter(Boolean);

  // ---- 클라이언트: 제목 맨 앞 [ ] 안의 이름. [개인]과 캘린더의 [동준](내 키워드)은 개인 ----
  function splitClient(title) {
    const s = String(title || ''), m = s.match(/^\s*\[([^\]]+)\]\s*/);
    if (!m) return [null, s.trim()];
    const c = m[1].trim();
    return [keywords().includes(c) ? PERSONAL : c || null, s.slice(m[0].length).trim()];
  }
  const clientOf = t => (t ? splitClient(t.title)[0] : null);
  const clientOfPlan = p => { const t = p.task_id && taskById(p.task_id); return t ? clientOf(t) : splitClient(p.title)[0]; };
  let ccCache = { raw: null, map: {}, free: PALETTE[0] };
  function clientColors() {
    const raw = S.settings.client_colors || '';
    if (ccCache.raw !== raw) {
      let map = {}; try { map = JSON.parse(raw || '{}') || {}; } catch (_) { /* noop */ }
      const used = new Set([GREEN, ...Object.values(map)]);
      ccCache = { raw, map, free: PALETTE.find(x => !used.has(x)) || null };
    }
    return ccCache.map;
  }
  const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v || ''));
  const hashColor = c => { let h = 0; for (const ch of c) h = (h * 31 + ch.codePointAt(0)) >>> 0; return PALETTE[h % (PALETTE.length - 1)]; };
  function clientColor(c) {
    if (!c) return 'var(--k-none)';
    const v = clientColors()[c];
    if (isHex(v)) return v;
    // 아직 색이 안 정해진 새 클라이언트: 저장될 때 받을 빈 색으로 미리 보여줌
    return c === PERSONAL ? 'var(--k-personal)' : (ccCache.free || hashColor(c));
  }
  const kc = c => `style="--kc:${clientColor(c)}"`;
  // 제목 표시: [클라이언트]는 색 글씨로, 나머지는 그대로 (캘린더 일정은 끝의 _동준 떼고)
  function titleHTML(title, cal) {
    const [c, rest] = splitClient(cal ? compactTitle(title) : title);
    return (c ? `<b class="ctag">${esc(c)}</b>` : '') + esc(rest || title);
  }
  // 지금 보이는 클라이언트 (많은 순)
  function allClients() {
    const n = new Map(), add = c => { if (c) n.set(c, (n.get(c) || 0) + 1); };
    S.tasks.forEach(t => add(clientOf(t)));
    S.plans.forEach(p => { if (!p.task_id) add(splitClient(p.title)[0]); });
    return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b));
  }
  // 처음 보는 클라이언트에 아직 안 쓴 색을 정해서 저장 → 모든 기기에서 같은 색 (많이 쓰는 클라이언트가 앞 색)
  function ensureClientColors() {
    const map = { ...clientColors() }, present = allClients();
    const used = new Set([GREEN, ...present.map(c => map[c]).filter(isHex)]);
    let changed = false;
    for (const c of present) {
      if (c === PERSONAL || isHex(map[c])) continue;
      map[c] = PALETTE.find(x => !used.has(x)) || hashColor(c);
      used.add(map[c]); changed = true;
    }
    if (changed) saveSetting('client_colors', JSON.stringify(map));
  }
  // 내 일정 색: 설정 안 했으면 1번(라벤더 · 보라미디어 캘린더의 '동준' 색), ''이면 색으로는 안 가져옴
  const myColor = () => { const v = S.settings.cal_color; return v == null ? '1' : (gcolor(String(v)) ? String(v) : ''); };
  const gasUrl = () => String(S.settings.gas_url || '').trim();
  const gasLinked = () => !!(gasUrl() && String(S.settings.gas_token || '').trim());
  const compactTitle = s => String(s).replace(/_[^_]*$/, m => (keywords().some(k => m.includes(k)) ? '' : m)).trim();
  const isCurrentPeriod = () => (S.view === 'month'
    ? ymd(S.month) === ymd(firstOfMonth(new Date()))
    : ymd(S.weekStart) === ymd(mondayOf(new Date())));

  const matchFilter = t => S.filter === 'all' || clientOf(t) === S.filter;
  // 진행 중으로 보여줄 캘린더 일정: 개인 일정 빼고, 안 끝났고, 오늘부터 7일 안에 하는 것 (앱에서 추가한 일정 포함)
  const isDoingEvent = t => t.source === 'gcal' && t.status !== '완료' && clientOf(t) !== PERSONAL
    && (t.end_date || t.due_date) >= today() && t.due_date <= ymd(addDays(new Date(), 6));
  // 진행 중인 작업: 완료 안 된 내 작업 전부 (요일 배정 여부와 상관없이) + 이번 7일 캘린더 일정, 다음 할 날이 가까운 순 · 미배정은 맨 뒤
  function doingTasks(ignoreFilter) {
    return S.tasks.filter(t => (t.source === 'gcal' ? isDoingEvent(t) : t.status !== '완료') && (ignoreFilter || matchFilter(t)))
      .map(t => [t, nextDay(t) || '9999'])
      .sort((a, b) => a[1].localeCompare(b[1]) || (a[0].source === 'gcal' ? -1 : 0) - (b[0].source === 'gcal' ? -1 : 0) || bySort(a[0], b[0])).map(x => x[0]);
  }
  // 완료: 내 작업 + 최근 일주일 안에 완료 체크한 캘린더 일정
  function doneTasks(ignoreFilter) {
    const wk = ymd(addDays(new Date(), -7));
    return S.tasks.filter(t => t.status === '완료' && (t.source !== 'gcal' || (t.end_date || t.due_date) >= wk) && (ignoreFilter || matchFilter(t)))
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  // 다음에 하는 날: 캘린더 일정은 일정 날짜(이미 시작했으면 오늘), 작업은 다음 배정일
  function nextDay(t) {
    if (t.source !== 'gcal') return nextPlanDay(t.id);
    const td = today(); return t.due_date < td ? td : t.due_date;
  }
  // 이 작업을 다음에 하기로 한 날 (오늘부터, 아직 체크 안 한 것)
  function nextPlanDay(taskId) {
    const td = today();
    return S.plans.reduce((m, p) => (p.task_id === taskId && !p.done && p.day >= td && (!m || p.day < m) ? p.day : m), null);
  }
  function whenLabel(d) {
    const now = new Date();
    if (d === today()) return '오늘';
    if (d === ymd(addDays(now, 1))) return '내일';
    if (d <= ymd(addDays(mondayOf(now), 6))) return dowOf(d) + '요일';
    return `${md(d)}(${dowOf(d)})`;
  }
  // 다가오는 캘린더 일정: 진행 중에 안 들어간 앞으로 6주 일정 (개인 일정, 다음 주 이후 일정)
  function upcomingEvents() {
    const td = today(), lim = ymd(addDays(new Date(), 42));
    return S.tasks.filter(t => t.source === 'gcal' && t.status !== '완료' && t.due_date > td && t.due_date <= lim && !isDoingEvent(t))
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
  }
  function eventsOn(d) {
    return S.tasks.filter(t => t.due_date && (t.source === 'gcal'
      ? t.due_date <= d && (t.end_date || t.due_date) >= d
      : t.due_date === d)).sort((a, b) => (a.source === 'gcal' ? 0 : 1) - (b.source === 'gcal' ? 0 : 1));
  }
  function pastUndone() {
    const td = today(), lim = ymd(addDays(new Date(), -14));
    return S.plans.filter(p => !p.done && p.day < td && p.day >= lim && !(p.task_id && taskById(p.task_id)?.status === '완료'));
  }
  const nextTaskSort = () => S.tasks.reduce((m, t) => Math.max(m, t.sort || 0), 0) + 10;

  // ================= screens =================
  function show(name) {
    for (const s of ['loading', 'auth', 'pending', 'config', 'app']) $('#screen-' + s).hidden = s !== name;
  }
  function setSync(state) {
    const el = $('#sync-dot'); if (!el) return;
    el.className = 'sync-dot' + (state === 'busy' ? ' busy' : state === 'err' ? ' err' : '');
  }
  let toastTimer;
  function toast(msg, action, fn) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); fn(); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5500 : 2800);
  }
  function applyTheme(t) {
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    const dark = t === 'dark' || (t === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
    const meta = $('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#0e0d13' : '#f3f2f8';
  }

  // ================= auth =================
  function authErr(e) {
    const m = String(e?.message || e || '').toLowerCase();
    if (m.includes('invalid login')) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (m.includes('already registered') || m.includes('already been registered')) return '이미 가입된 이메일이에요. 로그인해주세요.';
    if (m.includes('not confirmed')) return '메일 인증이 아직이에요. 메일함의 인증 링크를 눌러주세요.';
    if (m.includes('signups not allowed') || m.includes('signup is disabled')) return '지금은 가입을 받지 않아요. 관리자에게 문의해주세요.';
    if (m.includes('password')) return '비밀번호는 6자 이상이어야 해요.';
    if (m.includes('rate limit') || m.includes('too many')) return '요청이 많아요. 잠시 후 다시 시도해주세요.';
    return e?.message || String(e);
  }
  function initAuth() {
    const form = $('#auth-form'), msg = $('#auth-msg');
    const setMsg = (t, ok) => { msg.textContent = t || ''; msg.classList.toggle('ok', !!ok); };
    const vals = () => ({ email: form.elements.email.value.trim(), password: form.elements.password.value });
    const busy = b => $$('button', form).forEach(x => { x.disabled = b; });
    form.addEventListener('submit', async e => {
      e.preventDefault(); setMsg(''); busy(true);
      const { error } = await sb.auth.signInWithPassword(vals());
      busy(false);
      if (error) setMsg(authErr(error));
    });
    $('#btn-signup').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      setMsg(''); busy(true);
      const { data, error } = await sb.auth.signUp({ ...vals(), options: { emailRedirectTo: appUrl() } });
      busy(false);
      if (error) return setMsg(authErr(error));
      if (!data.session) setMsg('메일함에서 인증 링크를 눌러주세요. 인증 후 로그인하면 돼요.', true);
    });
    $('#btn-forgot').addEventListener('click', async () => {
      const { email } = vals();
      if (!email) { setMsg('이메일을 먼저 입력해주세요.'); form.elements.email.focus(); return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
      setMsg(error ? authErr(error) : '비밀번호 재설정 메일을 보냈어요.', !error);
    });
  }

  async function enter() {
    if (S.entered || !S.session) return;
    S.entered = true;
    const hasCache = restoreCache();
    if (hasCache) { show('app'); render(); } else show('loading');
    const { data: me, error } = await sb.from('members').select('*').eq('user_id', S.session.user.id).maybeSingle();
    if (error) {
      S.entered = false;
      if (!hasCache) show('auth');
      toast('연결 오류: ' + error.message);
      return;
    }
    if (!me || !me.approved) { S.entered = false; show('pending'); return; }
    S.me = me;
    show('app'); render();
    await loadAll();
    subscribe();
    maybeAutoSync();
  }

  // ================= data =================
  let loadSeq = 0;
  async function loadAll() {
    const seq = ++loadSeq;
    setSync('busy');
    const pd = periodDays();
    const from = ymd(addDays(fromYmd(pd[0]), -28)), to = ymd(addDays(fromYmd(pd[pd.length - 1]), 13));
    const keys = [...new Set(['week:' + weekDays()[0], ...pd.map(d => 'day:' + d)])];
    const res = await Promise.all([
      sb.from('tasks').select('*').eq('archived', false).order('sort').order('created_at'),
      sb.from('plans').select('*').gte('day', from).lte('day', to).order('sort').order('created_at'),
      sb.from('notes').select('*').in('key', keys),
      sb.from('settings').select('*'),
      sb.from('members').select('*').order('created_at'),
    ]);
    if (seq !== loadSeq) return;
    const err = res.find(r => r.error)?.error;
    if (err) { setSync('err'); toast('불러오기 실패: ' + err.message); return; }
    const [t, p, n, st, m] = res.map(r => r.data);
    S.tasks = t; S.plans = p;
    S.notes = {}; n.forEach(x => { S.notes[x.key] = x; });
    S.settings = {}; st.forEach(x => { S.settings[x.key] = x.value; });
    S.members = m;
    const mine = m.find(x => x.user_id === S.session?.user.id); if (mine) S.me = mine;
    setSync('ok'); saveCache(); requestRender();
    ensureClientColors();
  }
  const cacheKey = () => 'weekly-cache-' + (S.session?.user.id || 'anon');
  function saveCache() {
    ls.set(cacheKey(), { tasks: S.tasks, plans: S.plans, notes: S.notes, settings: S.settings, members: S.members, me: S.me });
  }
  function restoreCache() {
    const c = ls.get(cacheKey(), null);
    if (!c || !c.me?.approved) return false;
    Object.assign(S, { tasks: c.tasks || [], plans: c.plans || [], settings: c.settings || {}, members: c.members || [], me: c.me, notes: c.notes || {} });
    return true;
  }

  let channel = null, reloadTimer = null;
  function subscribe() {
    if (channel) return;
    channel = sb.channel('board');
    ['tasks', 'plans', 'notes'].forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload));
    channel.subscribe();
  }
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { if (S.dragging) return scheduleReload(); loadAll(); }, 700);
  }

  async function persist(ops) {
    if (!ops || !ops.length) return true;
    setSync('busy');
    const res = await Promise.all(ops.map(o => {
      const q = sb.from(o.table);
      if (o.op === 'insert') return q.insert(o.row);
      if (o.op === 'update') return q.update(o.row).eq(o.key || 'id', o.id);
      if (o.op === 'delete') return q.delete().eq('id', o.id);
      return q.upsert(o.row, o.opts);
    }));
    const err = res.find(r => r.error)?.error;
    if (err) { console.error(err); setSync('err'); toast('저장 실패: ' + err.message); scheduleReload(); return false; }
    setSync('ok'); saveCache(); return true;
  }
  const taskRow = t => ({ id: t.id, title: t.title, project: t.project, status: t.status, ok: t.ok, memo: t.memo, due_date: t.due_date, source: t.source, sort: t.sort, kind: t.kind });
  const planRow = p => ({ id: p.id, task_id: p.task_id, title: p.title, goal: p.goal, day: p.day, done: p.done, sort: p.sort, kind: p.kind ?? null });
  function newTask(f) {
    const now = new Date().toISOString();
    return { id: uuid(), title: f.title, project: f.project ?? null, status: f.status ?? null, ok: !!f.ok, memo: f.memo ?? null,
      due_date: f.due_date ?? null, end_date: null, location: null, detail: null, source: 'manual', ext_id: null,
      sort: nextTaskSort(), archived: false, created_at: now, updated_at: now };
  }
  function updateTask(t, patch) {
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    if (patch.archived) S.tasks = S.tasks.filter(x => x !== t);
    render();
    return persist([{ op: 'update', table: 'tasks', id: t.id, row: patch }]);
  }
  function updatePlan(p, patch) {
    Object.assign(p, patch); render();
    return persist([{ op: 'update', table: 'plans', id: p.id, row: patch }]);
  }
  function resort(list, skipId) {
    const ops = [];
    list.forEach((p, i) => {
      const s = (i + 1) * 10;
      if (p.sort !== s) { p.sort = s; if (p.id !== skipId) ops.push({ op: 'update', table: 'plans', id: p.id, row: { sort: s } }); }
    });
    return ops;
  }
  function assignTask(taskId, day, idx = Infinity, goal = null) {
    const plan = { id: uuid(), task_id: taskId, title: null, goal, day, done: false, sort: 0, kind: null, created_at: new Date().toISOString() };
    const list = plansOn(day);
    list.splice(Math.min(idx, list.length), 0, plan);
    S.plans.push(plan);
    const ops = resort(list, plan.id);
    return [{ op: 'insert', table: 'plans', row: planRow(plan) }, ...ops];
  }
  function addFreePlan(title, day) {
    const list = plansOn(day);
    const plan = { id: uuid(), task_id: null, title, goal: null, day, done: false, sort: ((list.at(-1)?.sort) || 0) + 10, kind: null, created_at: new Date().toISOString() };
    S.plans.push(plan);
    return [{ op: 'insert', table: 'plans', row: planRow(plan) }];
  }
  function movePlan(planId, day, idx = Infinity) {
    const p = planById(planId); if (!p) return [];
    const oldDay = p.day; p.day = day;
    const list = plansOn(day).filter(x => x.id !== p.id);
    list.splice(Math.min(idx, list.length), 0, p);
    const ops = resort(list, p.id);
    ops.push({ op: 'update', table: 'plans', id: p.id, row: { day, sort: p.sort } });
    if (oldDay !== day) ops.push(...resort(plansOn(oldDay)));
    return ops;
  }
  function removePlan(p) {
    S.plans = S.plans.filter(x => x !== p);
    return [{ op: 'delete', table: 'plans', id: p.id }];
  }
  function planToBacklog(planId) {
    const p = planById(planId); if (!p) return [];
    const ops = [];
    if (!p.task_id) {
      const parsed = parseLine(p.title || '새 할 일') || { title: p.title || '새 할 일' };
      const t = newTask(parsed);
      S.tasks.push(t);
      ops.push({ op: 'insert', table: 'tasks', row: taskRow(t) });
    }
    return [...ops, ...removePlan(p)];
  }
  async function persistSeq(...groups) { for (const g of groups) { if (!(await persist(g))) return false; } return true; }
  function quickAdd(text, day) {
    const t = S.tasks.find(x => x.source !== 'gcal' && x.status !== '완료' && x.title === text);
    return t ? assignTask(t.id, day) : addFreePlan(text, day);
  }
  function togglePlan(p, done = !p.done) {
    p.done = done; render();
    persist([{ op: 'update', table: 'plans', id: p.id, row: { done } }]);
    if (S.sheet?.type === 'day') refreshSheet();
    if (!done) return;
    haptic(15);
    const chk = $(`.item.plan[data-id="${p.id}"] .check`); if (chk) chk.classList.add('pop');
    const td = today(), todays = plansOn(td);
    if (p.day === td && todays.length > 1 && todays.every(x => x.done)) { haptic([20, 40, 20]); toast('오늘 할 일 끝! 수고했어요 🎉'); return; }
    const t = p.task_id && taskById(p.task_id);
    if (t && t.status !== '완료' && !S.plans.some(x => x.task_id === t.id && !x.done && x.id !== p.id)) {
      toast(`“${short(t.title)}” 작업도 완료로 바꿀까요?`, '작업 완료', () => { updateTask(t, { status: '완료' }); refreshSheet(); });
    }
  }
  function saveNote(n) {
    S.notes[n.key] = n; render();
    return persist([{ op: 'upsert', table: 'notes', row: { key: n.key, content: n.content, rest: !!n.rest } }]);
  }
  function saveSetting(key, value) {
    S.settings[key] = value;
    return persist([{ op: 'upsert', table: 'settings', row: { key, value } }]);
  }

  // ================= parsing =================
  const STATUS_ALIASES = [['수정대기', '수정대기'], ['대기', '수정대기'], ['완료', '완료'], ['편집', '편집'], ['기획', '기획'], ['기호기', '기획'], ['촬영', '촬영']];
  const normStatus = s => { const x = s.replace(/\s/g, ''); return (STATUS_ALIASES.find(([k]) => x.includes(k)) || [])[1] || null; };
  function parseLine(raw) {
    let s = String(raw || '').replace(/^\s*([-•*·]|\d+[.)])\s*/, '').trim();
    if (!s) return null;
    let ok = false, status = null, project = null;
    s = s.replace(/\s*(오케이|okay|ok|✅|✔️?)\s*$/i, () => { ok = true; return ''; }).trim();
    const pm = s.match(/^\[([^\]]+)\]\s*/);
    if (pm) { project = pm[1].trim(); s = s.slice(pm[0].length); }
    s = s.replace(/\s*\(([^)]*)\)\s*/g, (m, inner) => {
      if (/^\s*개인\s*$/.test(inner) && !project) { project = PERSONAL; return ' '; }
      const st = normStatus(inner); if (st && !status) { status = st; return ' '; } return m;
    }).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*(오케이|okay|ok|✅)\s*$/i, () => { ok = true; return ''; }).trim();
    if (!s) return null;
    // [클라이언트]는 제목에 그대로 둬요 (색 구분에 씀)
    const title = project ? `[${project}] ${s}` : s;
    return { title, project, status, ok };
  }
  const bracketProject = s => (String(s).match(/^\s*\[([^\]]+)\]/) || [])[1] || null;

  // ---- iCal ----
  function parseICS(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const out = []; let cur = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') { if (cur) out.push(icsEvent(cur)); cur = null; continue; }
      if (!cur) continue;
      let q = false, i = 0;
      for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ':' && !q) break; }
      if (i >= line.length) continue;
      const left = line.slice(0, i), val = line.slice(i + 1), semi = left.indexOf(';');
      const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
      if (!(name in cur)) cur[name] = { val, params: semi < 0 ? '' : left.slice(semi + 1) };
    }
    return out;
  }
  const icsText = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  function icsDate(p) {
    if (!p) return null;
    const m = p.val.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
    if (!m) return null;
    if (!m[4]) return { date: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
    if (m[7]) return { date: ymd(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]))), allDay: false };
    return { date: `${m[1]}-${m[2]}-${m[3]}`, allDay: false };
  }
  function icsEvent(c) {
    const s = icsDate(c.DTSTART), e = icsDate(c.DTEND);
    let end = e ? e.date : null;
    if (s && e && e.allDay) end = ymd(addDays(fromYmd(e.date), -1));
    if (s && (!end || end < s.date)) end = s.date;
    return {
      uid: c.UID?.val || '', rid: c['RECURRENCE-ID']?.val || '',
      summary: c.SUMMARY ? icsText(c.SUMMARY.val) : '', description: c.DESCRIPTION ? icsText(c.DESCRIPTION.val) : '',
      location: c.LOCATION ? icsText(c.LOCATION.val) : '', status: (c.STATUS?.val || '').toUpperCase(), start: s?.date || null, end,
    };
  }
  // 구글 연결 스크립트 호출 (읽기 · 추가만 있음)
  async function gasCall(payload) {
    const url = gasUrl(); if (!url) throw new Error('연결 주소가 없어요');
    let res;
    try { res = await fetch(url, { method: 'POST', body: JSON.stringify({ ...payload, token: String(S.settings.gas_token || '').trim() }) }); }
    catch (_) { throw new Error('연결할 수 없어요 (주소와 배포 권한 "모든 사용자"를 확인해주세요)'); }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('응답을 읽을 수 없어요 (연결 주소를 확인해주세요)');
    if (!data.ok) throw new Error(data.error || '요청 실패');
    return data;
  }
  // 내 일정 가져오기: 연결 스크립트(색 + 키워드) 우선, 없으면 iCal(키워드만)
  async function fetchCalendarRows(from, to) {
    const kws = keywords();
    if (gasLinked()) {
      const d = await gasCall({ action: 'list', from, to, color: myColor(), keywords: kws });
      return (d.events || []).filter(e => e.title && e.start).map(e => ({
        ext_id: 'gcal:' + e.id + (e.recurring ? '#' + e.start : ''), title: String(e.title).trim(),
        start: e.start, end: e.end && e.end >= e.start ? e.end : e.start, location: e.location, description: e.description }));
    }
    const { data, error } = await sb.rpc('fetch_ics');
    if (error) throw error;
    return parseICS(data)
      .filter(e => e.summary && e.start && e.status !== 'CANCELLED' && e.start >= from && e.start <= to && kws.some(k => e.summary.includes(k)))
      .map(e => ({ ext_id: 'gcal:' + e.uid + (e.rid ? '#' + e.rid : ''), title: e.summary.trim(), start: e.start, end: e.end,
        location: e.location, description: e.description }));
  }
  async function syncCalendar(manual) {
    if (S.syncing) return;
    if (!gasLinked() && !S.settings.ics_url) { if (manual) toast('설정에서 구글 캘린더 연결을 먼저 해주세요'); return; }
    S.syncing = true; setSync('busy'); spinSync(true);
    if (manual) toast('구글 캘린더에서 가져오는 중…');
    try {
      const from = ymd(addDays(new Date(), -14)), to = ymd(addDays(new Date(), 180));
      const seen = new Map();
      (await fetchCalendarRows(from, to)).forEach(e => {
        seen.set(e.ext_id, { ext_id: e.ext_id, title: e.title, project: bracketProject(e.title), due_date: e.start, end_date: e.end || e.start,
          location: e.location || null, detail: e.description ? String(e.description).slice(0, 4000) : null, source: 'gcal' });
      });
      const known = new Set(S.tasks.map(t => t.ext_id).filter(Boolean));
      const rows = [...seen.values()];
      const fresh = rows.filter(r => !known.has(r.ext_id));
      const existing = rows.filter(r => known.has(r.ext_id));
      for (const group of [fresh, existing]) {
        if (!group.length) continue;
        const r = await sb.from('tasks').upsert(group, { onConflict: 'ext_id' }); if (r.error) throw r.error;
      }
      const gone = S.tasks.filter(t => t.source === 'gcal' && t.due_date >= from && t.due_date <= to && !seen.has(t.ext_id)).map(t => t.id);
      if (gone.length) await sb.from('tasks').update({ archived: true }).in('id', gone);
      await saveSetting('cal_synced_at', new Date().toISOString());
      if (manual) toast(`캘린더 일정 ${rows.length}개를 동기화했어요` + (fresh.length ? ` · 새로 ${fresh.length}개` : ''));
      else if (fresh.length) toast(`구글 캘린더에서 새 일정 ${fresh.length}개를 가져왔어요`);
      await loadAll();
      refreshSheet();
    } catch (e) {
      setSync('err'); toast('캘린더 동기화 실패: ' + (e.message || e));
    } finally { S.syncing = false; spinSync(false); }
  }
  function spinSync(on) { $('#btn-sync')?.classList.toggle('spinning', on); }
  // 앱을 열 때(새로고침 포함)마다 구글 캘린더에서 가져옴
  function maybeAutoSync() {
    if (!gasLinked() && !S.settings.ics_url) return;
    syncCalendar(false);
  }

  // ---- 구글 캘린더에 일정 추가 (추가 전용 · 삭제 기능 없음) ----
  function calTitle(ev) {
    const kw = keywords()[0] || '';
    let t = String(ev.title || '').trim();
    if (!t || !kw || t.includes(kw)) return t;
    // 개인 일정은 팀 캘린더 규칙대로 [동준] 제목, 일은 [클라이언트] 제목_동준
    const [c, rest] = splitClient(t);
    return c === PERSONAL ? `[${kw}] ${rest}` : `${t}_${kw}`;
  }
  const plus2h = hm => { const [h, m] = hm.split(':').map(Number); return `${pad(Math.min(23, h + 2))}:${pad(m)}`; };
  function gcalTemplateUrl(ev, title) {
    const ds = ev.date.replace(/-/g, '');
    let dates;
    if (ev.st) {
      dates = `${ds}T${ev.st.replace(':', '')}00/${(ev.end || ev.date).replace(/-/g, '')}T${(ev.et || plus2h(ev.st)).replace(':', '')}00`;
    } else {
      const last = ev.end && ev.end > ev.date ? ev.end : ev.date;
      dates = `${ds}/${ymd(addDays(fromYmd(last), 1)).replace(/-/g, '')}`;
    }
    return 'https://calendar.google.com/calendar/render?' + new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details: ev.memo || '', location: ev.loc || '', ctz: 'Asia/Seoul' });
  }
  async function addCalendarEvent(ev) {
    const title = calTitle(ev);
    if (!gasLinked()) {
      window.open(gcalTemplateUrl(ev, title), '_blank', 'noopener');
      toast('구글 캘린더 창에서 저장을 눌러주세요 · 설정에서 연결하면 바로 추가돼요');
      return true;
    }
    // 구글 캘린더에는 '내 일정 색'으로 칠해요 (팀 캘린더 색 규칙 유지). 클라이언트 색은 앱 안에서만.
    const data = await gasCall({ action: 'add', title, start: ev.date, end: ev.end && ev.end > ev.date ? ev.end : null,
      startTime: ev.st || null, endTime: ev.st ? (ev.et || plus2h(ev.st)) : null, location: ev.loc || '', description: ev.memo || '', color: myColor() || null });
    const row = { ext_id: 'gcal:' + data.id, title, project: bracketProject(title), due_date: ev.date,
      end_date: ev.end && ev.end > ev.date ? ev.end : ev.date, location: ev.loc || null, detail: ev.memo || null, source: 'gcal' };
    const r = await sb.from('tasks').upsert(row, { onConflict: 'ext_id' });
    if (r.error) throw r.error;
    toast(`📅 구글 캘린더에 “${short(title, 18)}” 추가했어요`);
    loadAll();
    return true;
  }

  // ================= render =================
  function requestRender() { if (S.dragging) { S.pendingRender = true; return; } render(); }
  function flushRender() { if (S.pendingRender) requestRender(); }

  function render() {
    if ($('#screen-app').hidden) return;
    S.pendingRender = false;
    document.body.classList.toggle('view-week', S.view === 'week');
    document.body.classList.toggle('view-month', S.view === 'month');
    $$('.view-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
    renderHeader(); renderTray();
    if (S.view === 'week') { renderStrip(); renderWeekNote(); renderRollover(); renderWeek(); } else renderMonth();
    $('#task-titles').innerHTML = S.tasks.filter(t => t.source !== 'gcal' && t.status !== '완료').map(t => `<option value="${esc(t.title)}"></option>`).join('');
    if (!S.sortablesReady) initSortables();
  }

  function renderHeader() {
    let title, rel, ps;
    if (S.view === 'month') {
      const m = S.month, now = new Date();
      const diff = (m.getFullYear() - now.getFullYear()) * 12 + m.getMonth() - now.getMonth();
      title = `${m.getFullYear()}년 ${m.getMonth() + 1}월`;
      rel = diff === 0 ? '이번 달' : diff === 1 ? '다음 달' : diff === -1 ? '지난 달' : diff > 0 ? `${diff}달 후` : `${-diff}달 전`;
      const prefix = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-`;
      ps = S.plans.filter(p => p.day.startsWith(prefix));
    } else {
      const days = weekDays(), ws = S.weekStart, we = addDays(ws, 6);
      title = `${ws.getMonth() + 1}.${ws.getDate()} – ${we.getMonth() + 1}.${we.getDate()}`;
      const diff = Math.round((ws - mondayOf(new Date())) / (7 * 864e5));
      rel = diff === 0 ? '이번 주' : diff === 1 ? '다음 주' : diff === -1 ? '지난 주' : diff > 0 ? `${diff}주 후` : `${-diff}주 전`;
      ps = S.plans.filter(p => days.includes(p.day));
    }
    const done = ps.filter(p => p.done).length;
    $('#week-range').textContent = title;
    $('#week-rel').textContent = ps.length ? `${rel} · ${done}/${ps.length} 완료` : rel;
    $('#progress-bar').style.width = ps.length ? `${Math.round(done / ps.length * 100)}%` : '0';
  }

  function renderStrip() {
    const days = weekDays(), td = today();
    $$('.strip-day').forEach((el, i) => {
      const d = days[i], ps = plansOn(d), dn = ps.filter(p => p.done).length, rest = S.notes['day:' + d]?.rest;
      const cls = [...eventsOn(d).filter(t => t.status !== '완료').map(clientOf), ...ps.filter(p => !p.done).map(clientOfPlan)];
      el.classList.toggle('is-today', d === td);
      el.classList.toggle('is-rest', !!rest && !ps.length);
      el.classList.toggle('all-done', ps.length > 0 && dn === ps.length);
      $('.d', el).textContent = DOW[i];
      $('.n', el).textContent = fromYmd(d).getDate();
      $('.c', el).innerHTML = cls.length ? cls.slice(0, 4).map(c => `<i ${kc(c)}></i>`).join('') : rest ? '휴식' : '';
      const drop = $('.strip-drop', el); drop.dataset.day = d; drop.innerHTML = '';
    });
  }

  function ddayHTML(d) {
    const n = Math.round((fromYmd(d) - fromYmd(today())) / 864e5);
    const label = n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `D+${-n}`;
    return `<span class="dday ${n >= 0 && n <= 2 ? 'soon' : ''}">${label}</span>`;
  }
  function doingHTML(t) {
    const cal = t.source === 'gcal', nx = nextDay(t);
    const when = nx ? `<span class="when ${nx === today() ? 'now' : ''}">${cal ? '📅 ' : ''}${whenLabel(nx)}</span>` : '<span class="when none">미배정</span>';
    return `<li class="item chip ${cal ? 'cal' : ''}" ${kc(clientOf(t))} data-kind="task" data-id="${t.id}" data-act="${cal ? 'open-event' : 'open-task'}">${when}
      <span class="t">${titleHTML(t.title, cal)}</span>${t.status ? `<span class="pill" data-s="${esc(t.status)}">${esc(t.status)}</span>` : ''}${t.ok ? '<span class="okb">OK</span>' : ''}${!cal && t.due_date ? ddayHTML(t.due_date) : ''}</li>`;
  }
  const DONE_SHOW = 6, DOING_SHOW = 6;
  function renderTray() {
    const collapsed = !!ls.get('weekly-tray-collapsed', false);
    $('#tray').classList.toggle('collapsed', collapsed);
    $('#btn-tray').textContent = collapsed ? '펼치기' : '접기';
    const all = doingTasks(true);
    // 클라이언트 필터 (진행 중 작업이 많은 순)
    const cnt = new Map();
    [...all, ...doneTasks(true)].forEach((t, i) => { const c = clientOf(t); if (c) cnt.set(c, (cnt.get(c) || 0) + (i < all.length ? 100 : 1)); });
    const clients = [...cnt.keys()].sort((a, b) => cnt.get(b) - cnt.get(a) || a.localeCompare(b));
    if (S.filter !== 'all' && !clients.includes(S.filter)) S.filter = 'all';
    $('#filters').innerHTML = [`<button class="filter ${S.filter === 'all' ? 'on' : ''}" data-act="filter" data-v="all">전체</button>`,
      ...clients.map(c => `<button class="filter kind ${S.filter === c ? 'on' : ''}" ${kc(c)} data-act="filter" data-v="${esc(c)}"><i></i>${esc(c)}</button>`)].join('');
    // 진행 중인 작업
    const list = doingTasks(), bl = $('#backlog');
    bl.dataset.empty = all.length ? '이 조건의 진행 중 작업은 없어요' : '진행 중인 작업이 없어요';
    // 폰에서는 가까운 순으로 몇 개만, 나머지는 '더 보기' (목록이 길어 아래로 내리기 힘들지 않게)
    const phone = matchMedia('(max-width: 719px)').matches, cut = phone && !S.doingAll && list.length > DOING_SHOW;
    bl.innerHTML = (cut ? list.slice(0, DOING_SHOW) : list).map(doingHTML).join('')
      + (phone && list.length > DOING_SHOW ? `<li class="more-chip" data-act="toggle-doing">${S.doingAll ? '접기' : `+${list.length - DOING_SHOW}개 더 보기`}</li>` : '');
    $('#backlog-count').textContent = all.length;
    $('#doing-count').textContent = list.length;
    $('#backlog-hint').hidden = !list.some(t => t.source !== 'gcal' && !nextPlanDay(t.id));
    // 완료된 작업
    const done = doneTasks(), doneAll = doneTasks(true).length;
    $('#done-count').textContent = done.length;
    $('#done-list').innerHTML = (S.doneAll ? done : done.slice(0, DONE_SHOW)).map(t => `<li ${kc(clientOf(t))} data-act="open-task" data-id="${t.id}"><span class="kdot"></span><span class="t">${titleHTML(t.title, t.source === 'gcal')}</span></li>`).join('')
      + (done.length > DONE_SHOW ? `<li class="more" data-act="toggle-done">${S.doneAll ? '접기' : `+${done.length - DONE_SHOW}개 더 보기`}</li>` : '');
    $('#done-archive').hidden = !doneAll;
    $('#done-archive').textContent = `${doneAll}개 보관`;
    // 다가오는 캘린더 일정 (맨 아래)
    const up = upcomingEvents();
    $('#upcoming').innerHTML = up.map(t => `<li class="item chip cal" ${kc(clientOf(t))} data-kind="task" data-id="${t.id}" data-act="open-event">${ddayHTML(t.due_date)}<span class="t">${md(t.due_date)}(${dowOf(t.due_date)}) ${titleHTML(t.title, true)}</span></li>`).join('');
    $('#upcoming-count').textContent = up.length;
  }
  function autosize(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  function renderWeekNote() {
    const el = $('#week-note');
    if (document.activeElement !== el) { el.value = S.notes['week:' + weekDays()[0]]?.content || ''; autosize(el); }
  }
  function renderRollover() {
    const el = $('#rollover');
    const n = isCurrentPeriod() ? pastUndone().length : 0;
    el.hidden = !n;
    if (n) el.innerHTML = `<span>⏪ 지난 미완료 ${n}개</span><button class="btn sm" data-act="rollover">오늘로 가져오기</button>`;
  }
  function planHTML(p) {
    const t = p.task_id ? taskById(p.task_id) : null;
    const meta = t ? `<div class="item-meta">${t.status ? `<span class="pill" data-s="${esc(t.status)}">${esc(t.status)}</span>` : ''}${t.ok ? '<span class="okb">OK</span>' : ''}</div>` : '';
    return `<li class="item plan ${p.done ? 'is-done' : ''}" ${kc(clientOfPlan(p))} data-kind="plan" data-id="${p.id}" data-act="open-plan">
      <button class="check" type="button" data-act="toggle-plan" aria-label="체크">${ICON.check}</button>
      <div class="item-body"><div class="item-title">${titleHTML(planTitle(p))}${p.goal ? ` <span class="goal">${esc(p.goal)}</span>` : ''}</div>${meta}</div></li>`;
  }
  function eventHTML(t) {
    const cal = t.source === 'gcal', done = t.status === '완료';
    return `<div class="event ${done ? 'is-done' : ''}" ${kc(clientOf(t))} data-act="open-event" data-id="${t.id}">
      <button class="check" type="button" data-act="toggle-event" data-id="${t.id}" aria-label="체크">${ICON.check}</button>
      <div class="eb"><span class="tag">${cal ? '📅' : '⏰ 마감'}</span>${titleHTML(t.title, cal)}${t.location ? `<small>📍 ${esc(t.location)}</small>` : ''}</div></div>`;
  }
  function renderWeek() {
    const days = weekDays(), td = today();
    $$('.day').forEach((art, i) => {
      const d = days[i], ps = plansOn(d), dn = ps.filter(p => p.done).length, nt = S.notes['day:' + d];
      art.dataset.day = d;
      art.classList.toggle('is-today', d === td);
      art.classList.toggle('is-weekend', i >= 5);
      art.classList.toggle('is-past', d < td);
      art.classList.toggle('is-rest', !!nt?.rest);
      // 폰: 이번 주 지난 요일은 접어서 오늘이 바로 보이게 (눌러서 펼치기)
      const foldable = isCurrentPeriod() && d < td, folded = foldable && !S.unfold.has(d);
      art.classList.toggle('is-folded', folded);
      const hd = $('.day-head', art);
      if (folded) { hd.dataset.act = 'fold-day'; hd.dataset.day = d; } else hd.removeAttribute('data-act');
      hd.innerHTML = `<button class="day-name" type="button" data-act="open-day" data-day="${d}"><span class="dn">${DOW[i]}</span><span class="dd">${md(d)}</span></button>`
        + (d === td ? '<span class="today-badge">오늘</span>' : '')
        + '<span class="spacer"></span>'
        + (ps.length ? `<span class="day-count ${dn === ps.length ? 'all' : ''}">${dn === ps.length ? '✓ ' : ''}${dn}/${ps.length}</span>` : '')
        + `<button class="memo-btn ${nt?.content ? 'has' : ''}" type="button" data-act="open-memo" data-day="${d}" aria-label="${DOW[i]}요일 메모">${ICON.pen}<span>메모</span></button>`
        + (foldable ? `<button class="fold-btn" type="button" data-act="fold-day" data-day="${d}" aria-expanded="${!folded}">${folded ? '펼치기' : '접기'}</button>` : '');
      $('.day-extra', art).innerHTML = (nt?.rest ? '<div class="rest-banner">🌙 휴식</div>' : '')
        + (nt?.content ? `<div class="day-memo" data-act="open-memo" data-day="${d}">${esc(nt.content)}</div>` : '');
      $('.events', art).innerHTML = eventsOn(d).map(eventHTML).join('');
      const ul = $('.day-list', art); ul.dataset.day = d; ul.innerHTML = ps.map(planHTML).join('');
      $('.quick-add input', art).placeholder = `+ ${DOW[i]}요일에 추가`;
    });
  }
  function renderMonth() {
    const days = monthDays(), td = today(), mm = S.month.getMonth();
    const max = innerWidth >= 720 ? 4 : 3;
    $$('.mcell').forEach((cell, i) => {
      const d = days[i];
      if (!d) { cell.hidden = true; return; }
      cell.hidden = false;
      const dt = fromYmd(d), ps = plansOn(d), evs = eventsOn(d), nt = S.notes['day:' + d];
      cell.dataset.day = d; $('.mdrop', cell).dataset.day = d; $('.mdrop', cell).innerHTML = '';
      cell.classList.toggle('out', dt.getMonth() !== mm);
      cell.classList.toggle('today', d === td);
      cell.classList.toggle('we', i % 7 >= 5);
      cell.classList.toggle('rest', !!nt?.rest);
      const dn = ps.filter(p => p.done).length;
      $('.mnum', cell).textContent = dt.getDate();
      $('.mmemo', cell).hidden = !nt?.content;
      const c = $('.mcount', cell);
      c.textContent = ps.length ? `${dn}/${ps.length}` : '';
      c.classList.toggle('all', ps.length > 0 && dn === ps.length);
      const items = [
        ...evs.map(t => ({ c: clientOf(t), title: (t.source === 'gcal' ? '' : '⏰ ') + splitClient(t.source === 'gcal' ? compactTitle(t.title) : t.title)[1], done: t.status === '완료', cal: true })),
        ...ps.map(p => ({ c: clientOfPlan(p), title: splitClient(planTitle(p))[1], done: p.done, cal: false })),
      ];
      $('.mbody', cell).innerHTML = items.slice(0, max).map(x => `<span class="mi ${x.cal ? 'cal' : ''} ${x.done ? 'done' : ''}" ${kc(x.c)} title="${esc(x.c || '')}">${esc(x.title)}</span>`).join('')
        + (items.length > max ? `<span class="mmore">+${items.length - max}</span>` : '');
    });
  }

  function buildSkeleton() {
    const week = $('#week'), strip = $('#strip'), mgrid = $('#mgrid');
    for (let i = 0; i < 7; i++) {
      week.insertAdjacentHTML('beforeend', `<article class="day card" data-i="${i}">
        <header class="day-head"></header><div class="day-extra"></div><div class="events"></div>
        <ul class="day-list"></ul>
        <form class="quick-add" data-i="${i}"><input type="text" enterkeyhint="done" list="task-titles" autocomplete="off" aria-label="${DOW[i]}요일에 추가"></form>
      </article>`);
      strip.insertAdjacentHTML('beforeend', `<div class="strip-day" data-act="jump-day" data-i="${i}" role="button" tabindex="0"><span class="d"></span><span class="n"></span><span class="c"></span><ul class="strip-drop" data-strip="1"></ul></div>`);
    }
    for (let i = 0; i < 42; i++) {
      mgrid.insertAdjacentHTML('beforeend', `<div class="mcell" data-act="open-mday" data-i="${i}" role="button" tabindex="0"><div class="mhead"><span class="mnum"></span><span class="mmemo" title="메모 있음" hidden>📝</span><span class="mcount"></span></div><div class="mbody"></div><ul class="mdrop" data-strip="1"></ul></div>`);
    }
    document.body.insertAdjacentHTML('beforeend', '<datalist id="task-titles"></datalist>');
  }

  // ================= drag & drop =================
  function initSortables() {
    if (!window.Sortable) return;
    S.sortablesReady = true;
    const common = {
      animation: 160, forceFallback: true, fallbackOnBody: true, fallbackTolerance: 4,
      delay: 200, delayOnTouchOnly: true, touchStartThreshold: 6,
      scroll: true, scrollSensitivity: 90, scrollSpeed: 16, bubbleScroll: true,
      draggable: '.item', ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen',
      onStart() { S.dragging = true; document.body.classList.add('is-dragging'); haptic(10); },
      onEnd: onDragEnd,
    };
    // 진행 중 목록은 다음 할 날 순서로 자동 정렬 → 목록 안에서 순서 바꾸기는 끔 (요일로 끌어가기 · 요일에서 되돌리기는 그대로)
    Sortable.create($('#backlog'), { ...common, sort: false, group: { name: 'board', pull: true, put: (to, from, el) => el.dataset.kind === 'plan' } });
    Sortable.create($('#upcoming'), { ...common, sort: false, group: { name: 'board', pull: 'clone', put: false } });
    $$('.day-list').forEach(el => Sortable.create(el, { ...common, group: { name: 'board', pull: true, put: true } }));
    $$('.strip-drop, .mdrop').forEach(el => Sortable.create(el, { ...common, sort: false, draggable: '.never-drag', emptyInsertThreshold: 0, group: { name: 'board', pull: false, put: true } }));
  }
  function onDragEnd(evt) {
    S.dragging = false; S.lastDragEnd = Date.now();
    document.body.classList.remove('is-dragging');
    const el = evt.item, kind = el.dataset.kind, id = el.dataset.id, to = evt.to, from = evt.from;
    let ops = [], seq = null;
    if (!(from === to && evt.oldIndex === evt.newIndex)) {
      const toDay = to.dataset.day;
      const idx = to.dataset.strip ? Infinity : evt.newIndex;
      if (toDay && kind === 'task') { ops = assignTask(id, toDay, idx, taskById(id)?.source === 'gcal' ? '준비' : null); toastAssigned(id, toDay); }
      else if (toDay && kind === 'plan') ops = movePlan(id, toDay, idx);
      else if (to.id === 'backlog' && kind === 'plan') {
        const p = planById(id);
        ops = planToBacklog(id);
        if (p && !p.task_id) { seq = ops; ops = []; }
      }
    }
    render();
    if (seq) persistSeq(seq.filter(o => o.table === 'tasks'), seq.filter(o => o.table !== 'tasks'));
    else persist(ops);
  }
  function toastAssigned(taskId, day) {
    const t = taskById(taskId); if (!t) return;
    if (S.view === 'month' || window.matchMedia('(max-width: 1179px)').matches) toast(`${md(day)}(${dowOf(day)})에 “${short(t.title)}” 배정`);
  }

  // ================= sheets =================
  const SHEETS = {};
  function openSheet(type, id, extra) {
    const wasOpen = !!S.sheet;
    S.sheet = { type, id, ...(extra || {}) };
    $('#sheet-body').innerHTML = SHEETS[type](id, S.sheet);
    const sh = $('#sheet');
    if (!wasOpen) {
      sh.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add('open')));
      try { history.pushState({ sheet: true }, ''); } catch (_) { /* noop */ }
    }
    afterSheet();
  }
  function refreshSheet() {
    if (!S.sheet || S.sheet.type === 'memo') return;
    const panel = $('.sheet-panel'), top = panel.scrollTop;
    $('#sheet-body').innerHTML = SHEETS[S.sheet.type](S.sheet.id, S.sheet);
    panel.scrollTop = top;
    afterSheet();
  }
  function afterSheet() {
    if (S.sheet?.type === 'add') { renderAddPreview(); updateFinalTitle(); }
    $$('#sheet-body textarea[data-autosize]').forEach(autosize);
  }
  function closeSheet(fromPop) {
    if (!S.sheet) return;
    const ae = document.activeElement; if (ae && $('#sheet').contains(ae)) ae.blur();
    S.sheet = null;
    const sh = $('#sheet'); sh.classList.remove('open');
    setTimeout(() => { if (!S.sheet) { sh.hidden = true; $('#sheet-body').innerHTML = ''; } }, 260);
    if (!fromPop && history.state?.sheet) { try { history.back(); } catch (_) { /* noop */ } }
    flushRender();
  }
  const head = (title, input) => `<div class="sh-head">${input || `<h3>${title}</h3>`}<button class="icon-btn" type="button" data-act="close-sheet" aria-label="닫기">${ICON.close}</button></div>`;
  const days7 = (act, isOn, extraAttr = '') => {
    const td = today();
    return `<div class="days7">${weekDays().map((d, i) => `<button type="button" data-act="${act}" data-day="${d}" ${extraAttr} class="${isOn(d) ? 'on' : ''} ${d === td ? 'today' : ''}">${DOW[i]}<small>${fromYmd(d).getDate()}</small></button>`).join('')}</div>`;
  };
  // 시트 위쪽: 이 항목의 클라이언트 (제목 [ ]에서 읽음)
  const clientLine = (c, extra = '') => `<p class="client-line" ${kc(c)}><span class="kdot"></span>${c ? `<b>${esc(c)}</b>` : '<span>클라이언트 없음</span>'}<small>· 제목 맨 앞 [ ]로 바꿔요${extra}</small></p>`;
  const statusSeg = (cur, tid) => `<div class="seg">${['', ...STATUSES].map(s => `<button type="button" data-act="task-status" data-s="${s}" ${tid ? `data-tid="${tid}"` : ''} class="${(cur || '') === s ? 'on' : ''}">${s || '없음'}</button>`).join('')}</div>`;
  const linkify = s => esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

  SHEETS.task = id => {
    const t = taskById(id); if (!t) return head('삭제된 항목이에요');
    const days = weekDays();
    const on = new Set(S.plans.filter(p => p.task_id === id && days.includes(p.day)).map(p => p.day));
    return head('', `<input class="sh-title" data-field="title" value="${esc(t.title)}" aria-label="제목" enterkeyhint="done">`)
      + clientLine(clientOf(t), ' (개인 일정은 [개인])')
      + `<div class="sh-sec"><p class="sh-label">진행 상태</p>${statusSeg(t.status)}</div>
      <div class="sh-sec"><p class="sh-label">${S.view === 'week' ? '이번 주' : `${md(days[0])} 주`} 요일 배정 <span>· 여러 날 선택 가능</span></p>${days7('task-day', d => on.has(d))}</div>
      <div class="sh-sec"><label class="toggle"><span>오케이 (컨펌 완료)</span><input type="checkbox" data-field="ok" ${t.ok ? 'checked' : ''}></label></div>
      <div class="sh-sec"><label class="field"><span>마감일</span><input type="date" data-field="due_date" value="${t.due_date || ''}"></label></div>
      <div class="sh-sec"><label class="field"><span>메모</span><textarea data-field="memo" data-autosize rows="3" placeholder="링크, 수정사항 등">${esc(t.memo || '')}</textarea></label></div>
      <div class="sh-actions"><button class="btn danger" type="button" data-act="task-delete">삭제</button><button class="btn" type="button" data-act="task-archive">보관</button><button class="btn primary" type="button" data-act="close-sheet">완료</button></div>`;
  };

  SHEETS.event = id => {
    const t = taskById(id); if (!t) return head('삭제된 항목이에요');
    const days = weekDays();
    const on = new Set(S.plans.filter(p => p.task_id === id && days.includes(p.day)).map(p => p.day));
    const range = t.end_date && t.end_date !== t.due_date ? `${dayLabel(t.due_date)} – ${dayLabel(t.end_date)}` : dayLabel(t.due_date);
    return head(`📅 ${esc(t.title)}`)
      + `<p class="muted" style="margin:-4px 0 10px">${range}${t.location ? ` · 📍 ${esc(t.location)}` : ''}</p>
      ${clientLine(clientOf(t), ' (구글 캘린더 제목)')}
      <div class="sh-sec"><label class="toggle"><span>완료 체크</span><input type="checkbox" data-field="evdone" ${t.status === '완료' ? 'checked' : ''}></label></div>
      <div class="sh-sec"><p class="sh-label">준비 일정 잡기 (${md(days[0])} 주)</p>${days7('task-day', d => on.has(d), 'data-goal="준비"')}</div>
      ${t.detail ? `<div class="sh-sec"><p class="sh-label">캘린더 내용</p><div class="detail">${linkify(t.detail)}</div></div>` : ''}
      <div class="sh-sec"><label class="field"><span>메모 (앱에만 저장)</span><textarea data-field="memo" data-autosize rows="2" placeholder="준비물, 장비 등">${esc(t.memo || '')}</textarea></label></div>
      <p class="hint">구글 캘린더 일정이에요. 여기서 숨겨도 구글 캘린더 원본은 그대로예요.</p>
      <div class="sh-actions"><button class="btn" type="button" data-act="task-archive">앱에서 숨기기</button><button class="btn primary" type="button" data-act="close-sheet">닫기</button></div>`;
  };

  SHEETS.plan = id => {
    const p = planById(id); if (!p) return head('삭제된 항목이에요');
    const t = p.task_id ? taskById(p.task_id) : null;
    const title = planTitle(p);
    return head(esc(title), t ? '' : `<input class="sh-title" data-field="ptitle" value="${esc(title)}" aria-label="제목" enterkeyhint="done">`)
      + `<p class="muted" style="margin:-4px 0 10px">${dayLabel(p.day)}</p>
      ${clientLine(clientOfPlan(p))}
      <div class="sh-sec"><label class="toggle"><span>이날 할 일 완료</span><input type="checkbox" data-field="pdone" ${p.done ? 'checked' : ''}></label></div>
      <div class="sh-sec"><label class="field"><span>이날 목표</span><input data-field="goal" value="${esc(p.goal || '')}" placeholder="예: 완료, 1차 편집, 컨펌 받기" enterkeyhint="done"></label>
        <div class="sugg">${GOALS.map(g => `<button type="button" data-act="plan-goal" data-goal="${g}">${g}</button>`).join('')}</div></div>
      ${t ? `<div class="sh-sec"><p class="sh-label">작업 상태 · ${esc(t.title)}</p>${statusSeg(t.status, t.id)}</div>` : ''}
      <div class="sh-sec"><p class="sh-label">다른 요일로 옮기기</p>${days7('plan-move', d => d === p.day)}</div>
      <div class="sh-sec"><p class="sh-label">다른 요일에도 추가 (복제)</p>${days7('plan-copy', d => S.plans.some(x => x !== p && x.day === d && (t ? x.task_id === t.id : x.title === p.title)))}</div>
      <div class="sh-actions"><button class="btn danger" type="button" data-act="plan-remove">요일에서 빼기</button>
      ${t ? '<button class="btn" type="button" data-act="plan-open-task">작업 열기</button>' : '<button class="btn" type="button" data-act="plan-to-task">할 일로 보내기</button>'}
      <button class="btn primary" type="button" data-act="close-sheet">완료</button></div>`;
  };

  SHEETS.day = d => {
    const n = S.notes['day:' + d] || {};
    const evs = eventsOn(d), ps = plansOn(d);
    const list = S.view === 'month' ? `<div class="sh-sec"><p class="sh-label">할 일 · 일정</p>
        <div class="sheet-list">${evs.map(eventHTML).join('')}<ul class="plain-list">${ps.map(planHTML).join('')}</ul>${!evs.length && !ps.length ? '<p class="empty">아직 없어요</p>' : ''}</div>
        <form class="quick-add sheet-qa" data-day="${d}"><input type="text" enterkeyhint="done" list="task-titles" autocomplete="off" placeholder="+ 이날 할 일 추가"></form>
        <div class="row" style="margin-top:10px"><button class="btn sm" type="button" data-act="add-event-on" data-day="${d}">📅 이날 일정 추가</button><button class="btn sm" type="button" data-act="goto-week" data-day="${d}">이 주 보기</button></div></div>` : '';
    return head(dayLabel(d)) + list
      + `<div class="sh-sec"><label class="toggle"><span>🌙 휴식일로 표시</span><input type="checkbox" data-field="rest" ${n.rest ? 'checked' : ''}></label></div>
      <div class="sh-sec"><label class="field"><span>이날 메모</span><textarea data-field="daymemo" data-autosize rows="2" placeholder="예: 오후 미팅, 외근">${esc(n.content || '')}</textarea></label></div>
      ${S.view === 'week' ? `<div class="sh-sec"><button class="btn block" type="button" data-act="add-event-on" data-day="${d}">📅 이날 구글 캘린더 일정 추가</button></div>` : ''}
      <div class="sh-actions"><button class="btn primary" type="button" data-act="close-sheet">완료</button></div>`;
  };

  SHEETS.memo = d => {
    const n = S.notes['day:' + d] || {};
    return head(`📝 ${dayLabel(d)} 메모`)
      + `<div class="sh-sec"><textarea class="input memo-area" data-field="daymemo" placeholder="이날 있었던 일, 해야 할 것, 아이디어… 자유롭게 적어요">${esc(n.content || '')}</textarea>
      <p class="sh-label memo-state" id="memo-state">${n.content ? '저장돼 있어요' : '적으면 자동으로 저장돼요'}</p></div>
      <div class="sh-actions"><button class="btn primary" type="button" data-act="close-sheet">완료</button></div>`;
  };
  let memoTimer;
  function saveMemo(d, v, now) {
    clearTimeout(memoTimer);
    const run = () => {
      const n = { ...note('day:' + d) }, val = v.trim() || null;
      if ((n.content || null) === val) return;
      n.content = val;
      const st = $('#memo-state'); if (st) st.textContent = '저장 중…';
      saveNote(n).then(ok => { const el = $('#memo-state'); if (el && S.sheet?.type === 'memo') el.textContent = ok ? '저장됐어요' : '저장 실패 · 다시 시도해주세요'; });
    };
    if (now) run(); else memoTimer = setTimeout(run, 700);
  }

  SHEETS.add = (_, ctx) => {
    const mode = ctx.mode || 'task';
    const tabs = `<div class="tabs"><button type="button" data-act="add-mode" data-v="task" class="${mode === 'task' ? 'on' : ''}">할 일</button><button type="button" data-act="add-mode" data-v="event" class="${mode === 'event' ? 'on' : ''}">📅 구글 캘린더 일정</button></div>`;
    if (mode === 'event') {
      const ev = ctx.ev || (ctx.ev = { date: today() });
      const linked = gasLinked(), gc = gcolor(myColor());
      return head('추가') + tabs
        + `<label class="field"><span>제목 · 맨 앞 [클라이언트], 개인 일정은 [개인]</span><input data-ef="title" value="${esc(ev.title || '')}" placeholder="예: [교촌] 신메뉴 촬영" enterkeyhint="done"></label>
        <p class="final-title" id="final-title"></p>
        <div class="sh-sec row">
          <label class="field"><span>날짜</span><input type="date" data-ef="date" value="${ev.date || ''}"></label>
          <label class="field"><span>종료일 (여러 날일 때)</span><input type="date" data-ef="end" value="${ev.end || ''}"></label>
        </div>
        <div class="sh-sec row">
          <label class="field"><span>시작 시간 (선택)</span><input type="time" data-ef="st" value="${ev.st || ''}"></label>
          <label class="field"><span>종료 시간</span><input type="time" data-ef="et" value="${ev.et || ''}"></label>
        </div>
        <label class="field"><span>장소 (선택)</span><input data-ef="loc" value="${esc(ev.loc || '')}" placeholder="예: 일산 킨텍스"></label>
        <div class="sh-sec"><label class="field"><span>메모 (선택)</span><textarea data-ef="memo" data-autosize rows="2" placeholder="인력, 장비, 노션 링크 등">${esc(ev.memo || '')}</textarea></label></div>
        <div class="notice ${linked ? '' : 'warn'}">${linked
          ? `구글 캘린더에 <b>바로 추가</b>돼요${gc ? ` (<span class="gdot" style="--gc:${gc[2]}"></span>${gc[1]} 색)` : ''}. 추가만 가능하고, 앱에서 지워도 구글 캘린더 일정은 <b>절대 지워지지 않아요.</b>`
          : '아직 바로 추가 연결 전이라, 누르면 <b>구글 캘린더 창</b>이 열려요. 거기서 저장을 눌러주세요. (설정에서 연결하면 바로 추가돼요)'}</div>
        <div class="sh-actions"><button class="btn" type="button" data-act="close-sheet">취소</button><button class="btn primary" type="button" data-act="cal-submit" id="cal-submit">${linked ? '구글 캘린더에 추가' : '구글 캘린더에서 열기'}</button></div>`;
    }
    const target = ctx.target || '';
    return head('추가') + tabs
      + `<label class="field"><span>한 줄에 하나씩 · <b>[클라이언트] 제목 (상태) 오케이</b> 형식 인식 · 같은 [ ]는 같은 색</span>
        <textarea id="add-text" rows="5" placeholder="[교촌] DID (편집) 오케이&#10;[준범] 소프라노 뮤비 (기획)&#10;[개인] 병원">${esc(ctx.text || '')}</textarea></label>
      <ul class="preview" id="add-preview"></ul>
      <div class="sh-sec"><p class="sh-label">어디에 둘까요?</p>
        <div class="seg" style="margin-bottom:6px"><button type="button" data-act="add-target" data-day="" class="${target ? '' : 'on'}">할 일 목록 (미배정)</button></div>
        ${days7('add-target', d => d === target)}</div>
      <div class="sh-actions"><button class="btn" type="button" data-act="close-sheet">취소</button><button class="btn primary" type="button" data-act="add-submit" id="add-submit">추가</button></div>`;
  };
  function addItems() {
    return ($('#add-text')?.value || '').split('\n').map(parseLine).filter(Boolean);
  }
  function renderAddPreview() {
    if (!$('#add-text')) return;
    const items = addItems();
    $('#add-preview').innerHTML = items.map(x => `<li ${kc(splitClient(x.title)[0])}><b>${titleHTML(x.title)}</b>${x.status ? `<span class="pill" data-s="${esc(x.status)}">${esc(x.status)}</span>` : ''}${x.ok ? '<span class="okb">OK</span>' : ''}</li>`).join('');
    const btn = $('#add-submit'); if (btn) { btn.textContent = items.length ? `${items.length}개 추가` : '추가'; btn.disabled = !items.length; }
  }
  function readEv() {
    const ev = S.sheet?.ev; if (!ev) return null;
    $$('#sheet-body [data-ef]').forEach(el => { ev[el.dataset.ef] = el.value.trim(); });
    return ev;
  }
  function updateFinalTitle() {
    const el = $('#final-title'); if (!el) return;
    const ev = readEv(); const t = ev && calTitle(ev);
    el.innerHTML = t ? `캘린더 제목: <b>${esc(t)}</b>` : '';
  }

  let deferredPrompt = null;
  SHEETS.settings = () => {
    const isOwner = S.me?.role === 'owner';
    const synced = S.settings.cal_synced_at ? new Date(S.settings.cal_synced_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '아직 없음';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
    const theme = ls.get('weekly-theme', 'dark');
    const mc = myColor(), gc = gcolor(mc), clients = allClients();
    return head('설정')
      + `<div class="sh-sec"><label class="field"><span>내 이름</span><input data-field="myname" value="${esc(S.me?.display_name || '')}" placeholder="예: 동준"></label>
        <p class="hint">${esc(S.session?.user.email || '')}</p></div>
      <div class="sh-sec"><p class="sh-label">🎨 화면</p><div class="seg">${[['dark', '다크'], ['light', '라이트'], ['auto', '기기 설정']].map(([v, l]) => `<button type="button" data-act="theme" data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="sh-sec"><p class="sh-label">🏷️ 클라이언트 색 <span>· 제목 맨 앞 [ ]로 구분, 모든 기기에 같이 적용</span></p>
        ${clients.length ? `<div class="ccolors">${clients.map(c => { const cur = clientColor(c); return `<div class="crow" ${kc(c)}><b>${esc(c)}</b><div class="cpal">${PALETTE.map(x => `<button type="button" data-act="client-color" data-c="${esc(c)}" data-color="${x}" style="--sw:${x}" class="${cur === x || (cur === 'var(--k-personal)' && x === GREEN) ? 'on' : ''}" aria-label="${esc(c)} 색 바꾸기"></button>`).join('')}</div></div>`; }).join('')}</div>`
          : '<p class="hint">아직 [ ]로 구분한 작업이 없어요. 예: [교촌] DID 편집</p>'}</div>
      <div class="sh-sec"><p class="sh-label">📅 구글 캘린더 연결 <span>· 읽기 + 추가만, 삭제 없음</span></p>
        <label class="field"><span>연결 주소 (Apps Script 웹앱 URL)</span><input type="password" data-field="gas_url" value="${esc(S.settings.gas_url || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"></label>
        <label class="field" style="margin-top:8px"><span>연결 비밀키 (스크립트의 TOKEN과 같은 값)</span><input type="password" data-field="gas_token" value="${esc(S.settings.gas_token || '')}" autocomplete="off" spellcheck="false"></label>
        <label class="field" style="margin-top:8px"><span>내 일정 색 · 이 색 일정은 전부 가져와요 ${gc ? `<span class="gdot" style="--gc:${gc[2]}"></span>` : ''}</span>
          <select data-field="cal_color"><option value="" ${mc ? '' : 'selected'}>색으로는 안 가져오기</option>${GCOLORS.map(([id, name]) => `<option value="${id}" ${mc === id ? 'selected' : ''}>${id}. ${name}${id === '1' ? ' (보라미디어 캘린더의 동준 색)' : ''}</option>`).join('')}</select></label>
        <label class="field" style="margin-top:8px"><span>내 일정 키워드 · 제목에 들어가면 가져와요 (쉼표로 여러 개)</span><input data-field="cal_keyword" value="${esc(S.settings.cal_keyword || '동준')}"></label>
        <div class="row" style="margin-top:8px"><button class="btn" type="button" data-act="gas-test">연결 테스트</button><button class="btn" type="button" data-act="cal-sync">지금 동기화</button></div>
        <p class="hint">마지막 동기화: ${synced} · 앱을 열 때 3시간마다 자동으로 가져와요. 앱에서 추가한 일정은 구글 캘린더에 내 일정 색으로 들어가요.</p>
        <p class="hint">이 연결은 일정을 <b>읽고 추가만</b> 할 수 있어요. 수정·삭제 기능이 없어서 구글 캘린더 일정이 지워질 일이 없어요.</p>
        <details class="sub"><summary>연결 없이 iCal 주소로 가져오기 (키워드만 · 색은 안 됨)</summary>
          <label class="field" style="margin-top:6px"><span>iCal 비공개 주소</span><input type="password" data-field="ics_url" value="${esc(S.settings.ics_url || '')}" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off" spellcheck="false"></label>
          <div class="tip" style="margin-top:8px">구글 캘린더(PC) → ⚙️ 설정 → <b>내 캘린더의 설정</b>에서 캘린더 선택 → <b>캘린더 통합</b> → <b>iCal 형식의 비공개 주소</b> 복사. 연결 주소가 있으면 그쪽이 먼저 쓰여요.</div>
        </details></div>
      ${isOwner ? `<div class="sh-sec"><p class="sh-label">👥 멤버</p>${S.members.map(m => `<div class="member"><div class="who"><b>${esc(m.display_name || m.email)}</b><small>${esc(m.email || '')} · ${m.role === 'owner' ? '관리자' : m.approved ? '멤버' : '승인 대기'}</small></div>
          ${m.role === 'owner' ? '' : `${m.approved ? `<button class="btn sm" type="button" data-act="member-approve" data-id="${m.user_id}" data-v="0">해제</button>` : `<button class="btn sm primary" type="button" data-act="member-approve" data-id="${m.user_id}" data-v="1">승인</button>`}<button class="btn sm danger" type="button" data-act="member-remove" data-id="${m.user_id}">삭제</button>`}</div>`).join('')}
        <p class="hint">다른 사람이 같은 주소에서 가입하면 여기서 승인해야 보드를 볼 수 있어요.</p></div>` : ''}
      <div class="sh-sec"><p class="sh-label">📱 앱으로 쓰기</p>
        ${deferredPrompt ? '<button class="btn primary block" type="button" data-act="install">홈 화면에 앱 설치</button>' : ''}
        <div class="tip">${ios ? '<b>아이폰</b>: Safari 하단 <b>공유</b> 버튼 → <b>홈 화면에 추가</b>' : '<b>안드로이드/PC 크롬</b>: 주소창 오른쪽 <b>설치</b> 아이콘 또는 메뉴(⋮) → <b>앱 설치</b> / <b>홈 화면에 추가</b>'}</div></div>
      <div class="sh-actions"><button class="btn danger" type="button" data-act="logout">로그아웃</button><button class="btn primary" type="button" data-act="close-sheet">닫기</button></div>`;
  };

  SHEETS.recovery = () => head('새 비밀번호 설정')
    + `<label class="field"><span>새 비밀번호 (6자 이상)</span><input type="password" id="new-pw" minlength="6" autocomplete="new-password"></label>
    <div class="sh-actions"><button class="btn primary" type="button" data-act="save-pw">저장</button></div>`;

  // ---- field changes inside sheets ----
  function onField(f, v) {
    const sh = S.sheet; if (!sh) return;
    if (sh.type === 'task' || sh.type === 'event') {
      const t = taskById(sh.id); if (!t) return;
      if (f === 'evdone') {
        if (v) S.prevStatus[t.id] = t.status;
        updateTask(t, { status: v ? '완료' : (S.prevStatus[t.id] ?? null) });
        return;
      }
      if (['title', 'project', 'due_date', 'memo', 'ok'].includes(f)) {
        let val = typeof v === 'string' ? v.trim() : v;
        if (f === 'title' && !val) { refreshSheet(); return; }
        if (val === '') val = null;
        updateTask(t, f === 'title' ? { title: val, project: splitClient(val)[0] } : { [f]: val });
        if (f === 'title') refreshSheet();
      }
    } else if (sh.type === 'plan') {
      const p = planById(sh.id); if (!p) return;
      if (f === 'goal') updatePlan(p, { goal: v.trim() || null });
      if (f === 'ptitle' && v.trim()) { updatePlan(p, { title: v.trim() }); refreshSheet(); }
      if (f === 'pdone') togglePlan(p, v);
    } else if (sh.type === 'memo') {
      if (f === 'daymemo') saveMemo(sh.id, v, true);
    } else if (sh.type === 'day') {
      const n = { ...note('day:' + sh.id) };
      if (f === 'rest') n.rest = v;
      if (f === 'daymemo') n.content = v.trim() || null;
      saveNote(n);
    } else if (sh.type === 'settings') {
      if (f === 'myname') {
        const name = v.trim(); if (S.me) S.me.display_name = name;
        sb.rpc('set_my_name', { p_name: name }).then(({ error }) => toast(error ? '저장 실패: ' + error.message : '이름을 저장했어요'));
      }
      if (f === 'ics_url') {
        saveSetting(f, v.trim()).then(ok => { if (ok && v.trim() && !gasLinked()) syncCalendar(true); });
      }
      if (f === 'cal_keyword' || f === 'cal_color') {
        saveSetting(f, v.trim()).then(ok => { refreshSheet(); if (ok && (gasLinked() || S.settings.ics_url)) syncCalendar(true); });
      }
      if (f === 'gas_url' || f === 'gas_token') {
        const u = v.trim();
        if (f === 'gas_url' && u && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/.test(u)) { toast('https://script.google.com/macros/s/…/exec 형식의 주소를 넣어주세요'); return; }
        saveSetting(f, u).then(async ok => { if (ok && gasLinked() && await A['gas-test']()) syncCalendar(true); });
      }
    }
  }

  // ================= actions =================
  const A = {};
  A['nav-prev'] = () => nav(-1);
  A['nav-next'] = () => nav(1);
  A['nav-today'] = () => nav(0);
  function nav(dir) {
    if (S.view === 'month') S.month = dir === 0 ? firstOfMonth(new Date()) : new Date(S.month.getFullYear(), S.month.getMonth() + dir, 1);
    else S.weekStart = dir === 0 ? mondayOf(new Date()) : addDays(S.weekStart, dir * 7);
    S.followToday = isCurrentPeriod();
    render(); loadAll();
    if (dir === 0) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function setView(v, focusDay) {
    if (v === 'month') {
      const base = focusDay ? fromYmd(focusDay) : (S.followToday ? new Date() : S.weekStart);
      S.month = firstOfMonth(base);
    } else {
      const now = new Date();
      const base = focusDay ? fromYmd(focusDay) : (ymd(S.month) === ymd(firstOfMonth(now)) ? now : S.month);
      S.weekStart = mondayOf(base);
    }
    S.view = v; ls.set('weekly-view', v);
    S.followToday = isCurrentPeriod();
    render(); loadAll();
  }
  A.view = a => { if (a.dataset.v !== S.view) setView(a.dataset.v); };
  A['jump-day'] = a => {
    const i = +a.dataset.i, d = weekDays()[i];
    if ($$('.day')[i]?.classList.contains('is-folded')) { S.unfold.add(d); renderWeek(); }
    const art = $$('.day')[i];
    if (art) art.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  A['open-mday'] = a => openSheet('day', a.dataset.day);
  A['goto-week'] = a => {
    const d = a.dataset.day; closeSheet(); setView('week', d);
    setTimeout(() => { const art = $$('.day')[(fromYmd(d).getDay() + 6) % 7]; if (art) art.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
  };
  A['fold-day'] = a => { const d = a.dataset.day; if (!d) return; if (S.unfold.has(d)) S.unfold.delete(d); else S.unfold.add(d); renderWeek(); };
  A['toggle-tray'] = () => { ls.set('weekly-tray-collapsed', !ls.get('weekly-tray-collapsed', false)); renderTray(); };
  A.filter = a => { const v = a.dataset.v; S.filter = v === 'all' || S.filter === v ? 'all' : v; renderTray(); };
  A['open-task'] = (a, id) => { const t = taskById(id); if (t) openSheet(t.source === 'gcal' ? 'event' : 'task', id); };
  A['open-event'] = (a, id) => { const t = taskById(id); if (t) openSheet(t.source === 'gcal' ? 'event' : 'task', id); };
  A['open-plan'] = (a, id) => openSheet('plan', id);
  A['open-day'] = a => openSheet('day', a.dataset.day);
  A['open-memo'] = a => {
    openSheet('memo', a.dataset.day);
    const ta = $('#sheet-body .memo-area');
    if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }
  };
  A['open-add'] = () => openSheet('add', null, { mode: 'task', target: '' });
  A['add-event-on'] = a => openSheet('add', null, { mode: 'event', ev: { date: a.dataset.day } });
  A['open-settings'] = () => openSheet('settings');
  A['close-sheet'] = () => closeSheet();
  A['toggle-plan'] = (a, id) => { const p = planById(id); if (p) togglePlan(p); };
  A['toggle-event'] = a => {
    const t = taskById(a.dataset.id); if (!t) return;
    const done = t.status !== '완료';
    if (done) { S.prevStatus[t.id] = t.status; haptic(15); }
    updateTask(t, { status: done ? '완료' : (S.prevStatus[t.id] ?? null) });
    if (S.sheet?.type === 'day') refreshSheet();
  };
  A.rollover = () => {
    const td = today(), items = pastUndone().sort((a, b) => a.day.localeCompare(b.day) || a.sort - b.sort);
    let ops = [];
    items.forEach(p => { ops = ops.concat(movePlan(p.id, td, Infinity)); });
    render(); persist(ops);
    toast(`${items.length}개를 오늘로 옮겼어요`);
  };
  A['client-color'] = a => {
    const c = a.dataset.c, v = a.dataset.color; if (!c || !isHex(v)) return;
    saveSetting('client_colors', JSON.stringify({ ...clientColors(), [c]: v }));
    render(); refreshSheet();
  };
  A['task-status'] = a => {
    const t = taskById(a.dataset.tid || S.sheet?.id); if (!t) return;
    const s = a.dataset.s || null;
    updateTask(t, { status: s }); refreshSheet();
    if (s === '완료') { haptic(15); toast(`“${short(t.title)}” 완료! 👏`); }
  };
  A['task-day'] = a => {
    const t = taskById(S.sheet?.id); if (!t) return;
    const d = a.dataset.day, ex = S.plans.find(p => p.task_id === t.id && p.day === d);
    const ops = ex ? removePlan(ex) : assignTask(t.id, d, Infinity, a.dataset.goal || null);
    render(); refreshSheet(); persist(ops);
  };
  A['task-archive'] = () => {
    const t = taskById(S.sheet?.id); if (!t) return;
    closeSheet(); updateTask(t, { archived: true });
    toast(t.source === 'gcal' ? '앱에서 숨겼어요 (구글 캘린더는 그대로)' : '보관했어요', '되돌리기', () => { t.archived = false; S.tasks.push(t); updateTask(t, { archived: false }); });
  };
  A['task-delete'] = () => {
    const t = taskById(S.sheet?.id); if (!t || t.source === 'gcal') return;
    if (!confirm(`“${t.title}” 작업을 삭제할까요?\n요일 배정도 함께 지워져요.`)) return;
    S.tasks = S.tasks.filter(x => x !== t); S.plans = S.plans.filter(p => p.task_id !== t.id);
    closeSheet(); render(); persist([{ op: 'delete', table: 'tasks', id: t.id }]);
  };
  A['toggle-done'] = () => { S.doneAll = !S.doneAll; renderTray(); };
  A['toggle-doing'] = () => { S.doingAll = !S.doingAll; renderTray(); };
  A['archive-done'] = () => {
    const done = doneTasks(true);
    if (!done.length || !confirm(`완료된 작업 ${done.length}개를 보관할까요? (목록에서 숨겨져요 · 구글 캘린더 원본은 그대로)`)) return;
    const ids = new Set(done.map(t => t.id));
    S.tasks = S.tasks.filter(t => !ids.has(t.id)); render();
    persist(done.map(t => ({ op: 'update', table: 'tasks', id: t.id, row: { archived: true } })));
  };
  A['plan-goal'] = a => { const p = planById(S.sheet?.id); if (p) { updatePlan(p, { goal: a.dataset.goal }); refreshSheet(); } };
  A['plan-move'] = a => { const p = planById(S.sheet?.id); if (!p || p.day === a.dataset.day) return; const ops = movePlan(p.id, a.dataset.day); render(); refreshSheet(); persist(ops); toast(`${dowOf(a.dataset.day)}요일로 옮겼어요`); };
  A['plan-copy'] = a => {
    const p = planById(S.sheet?.id); if (!p) return;
    const ops = p.task_id ? assignTask(p.task_id, a.dataset.day, Infinity, p.goal) : addFreePlan(p.title, a.dataset.day);
    render(); refreshSheet(); persist(ops); toast(`${dowOf(a.dataset.day)}요일에도 추가했어요`);
  };
  A['plan-remove'] = () => {
    const p = planById(S.sheet?.id); if (!p) return;
    const copy = { ...p };
    closeSheet(); const ops = removePlan(p); render(); persist(ops);
    toast('요일에서 뺐어요', '되돌리기', () => { S.plans.push(copy); render(); persist([{ op: 'insert', table: 'plans', row: planRow(copy) }]); });
  };
  A['plan-to-task'] = () => {
    const p = planById(S.sheet?.id); if (!p) return;
    const ops = planToBacklog(p.id); closeSheet(); render();
    persistSeq(ops.filter(o => o.table === 'tasks'), ops.filter(o => o.table !== 'tasks'));
    toast('할 일 목록으로 보냈어요');
  };
  A['plan-open-task'] = () => { const p = planById(S.sheet?.id); if (p?.task_id) openSheet('task', p.task_id); };
  A['add-mode'] = a => { if (!S.sheet) return; if (S.sheet.mode === 'event') readEv(); else S.sheet.text = $('#add-text')?.value || ''; S.sheet.mode = a.dataset.v; refreshSheet(); };
  A['add-target'] = a => { if (!S.sheet) return; S.sheet.target = a.dataset.day || ''; S.sheet.text = $('#add-text')?.value || ''; refreshSheet(); };
  A['add-submit'] = () => {
    const items = addItems();
    if (!items.length) return;
    const target = S.sheet?.target || '';
    const tasks = items.map(x => { const t = newTask(x); S.tasks.push(t); return t; });
    let planOps = [];
    if (target) tasks.forEach(t => { planOps = planOps.concat(assignTask(t.id, target)); });
    closeSheet(); render();
    persistSeq(tasks.map(t => ({ op: 'insert', table: 'tasks', row: taskRow(t) })), planOps);
    toast(target ? `${tasks.length}개를 ${dowOf(target)}요일에 추가했어요` : `${tasks.length}개를 할 일에 추가했어요`);
  };
  A['cal-submit'] = async a => {
    const ev = readEv(); if (!ev) return;
    if (!ev.title) { toast('제목을 입력해주세요'); $('[data-ef="title"]')?.focus(); return; }
    if (!ev.date) { toast('날짜를 골라주세요'); return; }
    if (ev.end && ev.end < ev.date) { toast('종료일이 시작일보다 빨라요'); return; }
    a.disabled = true; a.textContent = '추가하는 중…';
    try { if (await addCalendarEvent({ ...ev })) closeSheet(); }
    catch (e) { toast('캘린더 추가 실패: ' + (e.message || e)); a.disabled = false; a.textContent = '다시 시도'; }
  };
  A['gas-test'] = async () => {
    if (!gasUrl()) { toast('연결 주소를 먼저 넣어주세요'); return false; }
    if (!String(S.settings.gas_token || '').trim()) { toast('연결 비밀키를 먼저 넣어주세요'); return false; }
    try {
      const d = await gasCall({ action: 'ping' });
      if (d.app !== 'weekly-todo') { toast('연결은 됐지만 위클리용 스크립트가 아니에요'); return false; }
      toast(`✅ 구글 캘린더 연결 OK · ${d.calendar || '기본 캘린더'}`);
      return true;
    } catch (e) { toast('연결 실패: ' + (e.message || e)); return false; }
  };
  A.theme = a => { const v = a.dataset.v; ls.set('weekly-theme', v); applyTheme(v); refreshSheet(); };
  A['cal-sync'] = () => syncCalendar(true);
  // 상단 새로고침 버튼: 캘린더가 연결돼 있으면 캘린더까지, 아니면 할 일만 다시 불러옴
  A['sync-now'] = async () => {
    if (gasLinked() || S.settings.ics_url) return syncCalendar(true);
    if (S.syncing) return;
    S.syncing = true; spinSync(true);
    try { await loadAll(); toast('새로고침했어요'); } finally { S.syncing = false; spinSync(false); }
  };
  A['member-approve'] = a => {
    const m = S.members.find(x => x.user_id === a.dataset.id); if (!m) return;
    m.approved = a.dataset.v === '1'; refreshSheet();
    persist([{ op: 'update', table: 'members', key: 'user_id', id: m.user_id, row: { approved: m.approved } }]);
  };
  A['member-remove'] = a => {
    const m = S.members.find(x => x.user_id === a.dataset.id); if (!m || !confirm(`${m.email} 멤버를 삭제할까요?`)) return;
    S.members = S.members.filter(x => x !== m); refreshSheet();
    sb.from('members').delete().eq('user_id', m.user_id).then(({ error }) => error && toast('삭제 실패: ' + error.message));
  };
  A.install = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; refreshSheet(); };
  A.logout = async () => { closeSheet(); await sb.auth.signOut(); };
  A.reload = () => location.reload();
  A['save-pw'] = async () => {
    const pw = $('#new-pw')?.value || '';
    if (pw.length < 6) { toast('6자 이상 입력해주세요'); return; }
    const { error } = await sb.auth.updateUser({ password: pw });
    if (error) toast('변경 실패: ' + error.message); else { closeSheet(); toast('비밀번호를 바꿨어요'); }
  };

  // ================= static wiring =================
  // ---- 폰: 위쪽 바 · 주간 · 월간에서 좌우로 밀면 이전/다음 주 (월간이면 이전/다음 달) ----
  function initSwipe() {
    let sx = 0, sy = 0, st = 0, on = false;
    document.addEventListener('touchstart', e => {
      on = false;
      if (e.touches.length !== 1 || S.sheet || $('#screen-app').hidden) return;
      const el = e.target;
      if (!el.closest('.topbar, #week, #month') || el.closest('input, textarea, select, .view-seg')) return;
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = Date.now(); on = true;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (!on) return; on = false;
      if (S.dragging || Date.now() - S.lastDragEnd < 400) return;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      swipeNav(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('touchcancel', () => { on = false; }, { passive: true });
  }
  function swipeNav(dir) {
    S.lastSwipe = Date.now(); haptic(8);
    nav(dir);
    const cls = dir > 0 ? 'swipe-next' : 'swipe-prev';
    for (const el of [$('#strip'), $(S.view === 'month' ? '#month' : '#week')]) {
      el.classList.toggle('swipe-next', false); el.classList.toggle('swipe-prev', false);
      void el.offsetWidth;
      el.classList.add(cls);
    }
  }
  function initStatic() {
    buildSkeleton();
    initSwipe();
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act;
      if (/^open-(task|event|plan|mday)$|^toggle-(plan|event)$/.test(act) && Date.now() - S.lastDragEnd < 350) return;
      if (Date.now() - S.lastSwipe < 350) return;
      const fn = A[act]; if (!fn) return;
      const id = a.dataset.id || a.closest('[data-id]')?.dataset.id;
      fn(a, id, e);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
      const cell = e.target.closest?.('.strip-day, .mcell');
      if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); A[cell.dataset.act](cell); return; }
      if (S.sheet || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('#screen-app').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') nav(-1);
      else if (e.key === 'ArrowRight') nav(1);
      else if (e.key === 't') nav(0);
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else if (e.key === 'n') { e.preventDefault(); A['open-add'](); }
    });
    $('#week').addEventListener('submit', e => {
      e.preventDefault();
      const form = e.target.closest('.quick-add'); if (!form) return;
      const input = $('input', form), text = input.value.trim(); if (!text) return;
      const ops = quickAdd(text, weekDays()[+form.dataset.i]);
      input.value = ''; render(); persist(ops);
    });
    const wn = $('#week-note');
    wn.addEventListener('input', () => autosize(wn));
    wn.addEventListener('change', () => {
      const key = 'week:' + weekDays()[0];
      saveNote({ ...note(key), content: wn.value.trim() || null });
    });
    const body = $('#sheet-body');
    body.addEventListener('submit', e => {
      e.preventDefault();
      const form = e.target.closest('.sheet-qa'); if (!form) return;
      const input = $('input', form), text = input.value.trim(); if (!text) return;
      const ops = quickAdd(text, form.dataset.day);
      input.value = ''; render(); refreshSheet(); persist(ops);
      setTimeout(() => $('#sheet-body .sheet-qa input')?.focus(), 30);
    });
    body.addEventListener('change', e => {
      const f = e.target.dataset.field; if (!f) return;
      onField(f, e.target.type === 'checkbox' ? e.target.checked : e.target.value, e.target);
    });
    body.addEventListener('input', e => {
      if (e.target.id === 'add-text') renderAddPreview();
      if (e.target.dataset.ef) updateFinalTitle();
      if (e.target.matches('textarea[data-autosize]')) autosize(e.target);
      if (S.sheet?.type === 'memo' && e.target.dataset.field === 'daymemo') saveMemo(S.sheet.id, e.target.value);
    });
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input.sh-title, input[data-field="goal"], input[data-ef]')) { e.preventDefault(); e.target.blur(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'add-text') { e.preventDefault(); A['add-submit'](); }
    });
    window.addEventListener('popstate', () => { if (S.sheet) closeSheet(true); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
    let resizeT;
    window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { setTopH(); if (S.view === 'month' && !S.dragging) renderMonth(); }, 150); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !S.me) return;
      if (S.followToday && !isCurrentPeriod()) { nav(0); return; }
      render(); scheduleReload();
    });
    const setTopH = () => document.documentElement.style.setProperty('--top-h', ($('.topbar')?.offsetHeight || 132) + 'px');
    setTimeout(setTopH, 50);
    applyTheme(ls.get('weekly-theme', 'dark'));
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  function boot() {
    initStatic();
    S.followToday = true;
    if (!sb) { show('config'); return; }
    initAuth();
    sb.auth.onAuthStateChange((event, session) => {
      S.session = session;
      if (event === 'PASSWORD_RECOVERY') setTimeout(() => { show('app'); openSheet('recovery'); }, 400);
      if (event === 'SIGNED_OUT') { S.entered = false; S.me = null; if (channel) { sb.removeChannel(channel); channel = null; } show('auth'); return; }
      if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) setTimeout(enter, 0);
      if (!session && event === 'INITIAL_SESSION') show('auth');
    });
  }
  boot();
})();
