// ─── 순수 함수 레이어 ────────────────────────────────────────────────────────

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createCard(title, description, meta = {}) {
  return {
    id: generateId(),
    title: title.trim(),
    description,
    priority: meta.priority || 'medium',
    dueDate: meta.dueDate || null,
    tags: meta.tags || [],
  };
}

function addCard(state, column, title, description, meta = {}) {
  if (!title.trim()) return state;
  const card = createCard(title, description, meta);
  return { ...state, [column]: [...state[column], card] };
}

function editCard(state, cardId, title, description, meta = {}) {
  if (!title.trim()) return state;
  const next = {};
  for (const col of Object.keys(state)) {
    next[col] = state[col].map((c) =>
      c.id === cardId
        ? {
            ...c,
            title: title.trim(),
            description,
            priority: meta.priority !== undefined ? meta.priority : c.priority,
            dueDate: meta.dueDate !== undefined ? meta.dueDate : c.dueDate,
            tags: meta.tags !== undefined ? meta.tags : c.tags,
          }
        : c
    );
  }
  return next;
}

function moveCard(state, cardId, toColumn) {
  let found = null;
  for (const col of Object.keys(state)) {
    const card = state[col].find((c) => c.id === cardId);
    if (card) { found = card; break; }
  }
  if (!found) return state;
  const next = {};
  for (const col of Object.keys(state)) {
    next[col] = state[col].filter((c) => c.id !== cardId);
  }
  next[toColumn] = [...next[toColumn], found];
  return next;
}

function deleteCard(state, cardId) {
  const next = {};
  for (const col of Object.keys(state)) {
    next[col] = state[col].filter((c) => c.id !== cardId);
  }
  return next;
}

// ─── DOM 레이어 (브라우저 전용) ──────────────────────────────────────────────

if (typeof document !== 'undefined') {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const COLUMNS = [
    { key: 'todo',        label: 'To-Do' },
    { key: 'in-progress', label: 'In-Progress' },
    { key: 'done',        label: 'Done' },
  ];
  const DEFAULT_STATE = { 'todo': [], 'in-progress': [], 'done': [] };
  const PRIORITY_LABELS = { high: '높음', medium: '보통', low: '낮음' };
  const ACTION_LABELS   = { add: '추가', edit: '편집', move: '이동', delete: '삭제' };

  let state           = DEFAULT_STATE;
  let dragCardId      = null;
  let currentUser     = null;
  let currentBoardId  = null;
  let realtimeChannel = null;

  // ── 인증 ──────────────────────────────────────────────────────────────────

  async function initAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      updateHeaderUser(currentUser);
      await renderBoard();
    } else {
      renderAuthScreen('login');
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUser = session.user;
        updateHeaderUser(currentUser);
        await renderBoard();
      } else if (event === 'SIGNED_OUT') {
        currentUser    = null;
        currentBoardId = null;
        state          = DEFAULT_STATE;
        unsubscribeBoard();
        updateHeaderUser(null);
        renderAuthScreen('login');
      }
    });
  }

  function renderAuthScreen(mode) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card">
          <h2 class="auth-title">${mode === 'login' ? '로그인' : '회원가입'}</h2>
          <button class="btn-social btn-google" id="btn-google">
            <span class="social-icon">G</span> Google로 로그인
          </button>
          <button class="btn-social btn-github" id="btn-github">
            <span class="social-icon">&#9670;</span> GitHub로 로그인
          </button>
          <div class="auth-divider"><span>또는</span></div>
          <form class="auth-form" id="auth-form" novalidate>
            <input class="form-input" type="email" id="auth-email" placeholder="이메일" autocomplete="email" />
            <input class="form-input" type="password" id="auth-password" placeholder="비밀번호 (6자 이상)" autocomplete="current-password" />
            <p class="auth-error" id="auth-error"></p>
            <button class="btn-auth btn-primary" type="submit">
              ${mode === 'login' ? '로그인' : '회원가입'}
            </button>
          </form>
          <p class="auth-toggle">
            ${mode === 'login'
              ? '계정이 없으신가요? <button class="btn-link" id="btn-toggle">회원가입</button>'
              : '이미 계정이 있으신가요? <button class="btn-link" id="btn-toggle">로그인</button>'}
          </p>
        </div>
      </div>
    `;
    document.getElementById('btn-google').addEventListener('click', signInWithGoogle);
    document.getElementById('btn-github').addEventListener('click', signInWithGitHub);
    document.getElementById('btn-toggle').addEventListener('click', () => {
      renderAuthScreen(mode === 'login' ? 'signup' : 'login');
    });
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errorEl  = document.getElementById('auth-error');
      errorEl.style.color = '';
      errorEl.textContent = '';
      if (mode === 'login') {
        await signInWithEmail(email, password, errorEl);
      } else {
        await signUpWithEmail(email, password, errorEl);
      }
    });
  }

  async function signInWithGoogle() {
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href } });
  }
  async function signInWithGitHub() {
    await sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: window.location.href } });
  }
  async function signInWithEmail(email, password, errorEl) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) errorEl.textContent = error.message;
  }
  async function signUpWithEmail(email, password, errorEl) {
    const { error } = await sb.auth.signUp({ email, password });
    if (error) {
      errorEl.textContent = error.message;
    } else {
      errorEl.style.color = 'var(--success)';
      errorEl.textContent = '인증 메일을 발송했습니다. 메일을 확인해 주세요.';
    }
  }
  async function signOut() { await sb.auth.signOut(); }

  function updateHeaderUser(user) {
    const el = document.getElementById('header-user');
    if (!el) return;
    if (user) {
      el.innerHTML = `
        <span class="header-email">${escapeHtml(user.email)}</span>
        <button class="btn-logout" id="btn-logout">로그아웃</button>
      `;
      el.querySelector('#btn-logout').addEventListener('click', signOut);
    } else {
      el.innerHTML = '';
    }
  }

  // ── Supabase DB ────────────────────────────────────────────────────────────

  async function getOrCreateBoard() {
    // 소유자 보드 조회
    const { data: memberRows, error: memberErr } = await sb
      .from('board_members')
      .select('board_id')
      .eq('user_id', currentUser.id)
      .eq('role', 'owner')
      .limit(1);

    if (memberErr) console.error('[getOrCreateBoard] board_members 조회 오류 (RLS 문제일 수 있음):', memberErr);
    if (memberRows && memberRows.length > 0) return memberRows[0].board_id;

    // 보드 생성
    const { data: board, error } = await sb
      .from('boards')
      .insert({ owner_id: currentUser.id, name: '내 칸반 보드' })
      .select()
      .single();
    if (error) { console.error('createBoard:', error); return null; }

    // 소유자를 board_members에 추가
    await sb.from('board_members').insert({
      board_id:   board.id,
      user_id:    currentUser.id,
      user_email: currentUser.email,
      role:       'owner',
    });
    return board.id;
  }

  function rowToCard(row) {
    return {
      id:          row.id,
      title:       row.title,
      description: row.description || '',
      priority:    row.priority || 'medium',
      dueDate:     row.due_date || null,
      tags:        row.tags || [],
      _persisted:  true,
    };
  }

  async function loadCards() {
    const { data, error } = await sb
      .from('cards')
      .select('*')
      .eq('board_id', currentBoardId)
      .order('created_at');
    if (error) { console.error('loadCards:', error); return DEFAULT_STATE; }
    const next = { 'todo': [], 'in-progress': [], 'done': [] };
    (data || []).forEach((row) => {
      if (next[row.status]) next[row.status].push(rowToCard(row));
    });
    return next;
  }

  async function saveCard(card) {
    const status = findCardStatus(card.id);
    if (!status) return;

    if (!card._persisted) {
      const { error } = await sb.from('cards').insert({
        id:          card.id,
        user_id:     currentUser.id,
        board_id:    currentBoardId,
        created_by:  currentUser.id,
        title:       card.title,
        description: card.description,
        status,
        priority:    card.priority || 'medium',
        due_date:    card.dueDate || null,
        tags:        card.tags || [],
        updated_at:  new Date().toISOString(),
      });
      if (error) { console.error('saveCard insert:', error); return; }
      state[status] = state[status].map((c) =>
        c.id === card.id ? { ...c, _persisted: true } : c
      );
    } else {
      const { error } = await sb.from('cards').update({
        title:       card.title,
        description: card.description,
        status,
        priority:    card.priority || 'medium',
        due_date:    card.dueDate || null,
        tags:        card.tags || [],
        updated_at:  new Date().toISOString(),
      }).eq('id', card.id);
      if (error) console.error('saveCard update:', error);
    }
  }

  async function deleteCardRemote(cardId) {
    const { error } = await sb.from('cards').delete().eq('id', cardId);
    if (error) console.error('deleteCardRemote:', error);
  }

  function findCardStatus(cardId) {
    for (const col of Object.keys(state)) {
      if (state[col].find((c) => c.id === cardId)) return col;
    }
    return null;
  }

  async function logActivity(action, cardId, cardTitle, extra = {}) {
    const { error } = await sb.from('activity_logs').insert({
      board_id:   currentBoardId,
      user_id:    currentUser.id,
      user_email: currentUser.email,
      action,
      card_id:    cardId,
      card_title: cardTitle,
      old_status: extra.oldStatus || null,
      new_status: extra.newStatus || null,
    });
    if (error) console.error('logActivity:', error);
  }

  async function loadActivityLogs() {
    const { data, error } = await sb
      .from('activity_logs')
      .select('*')
      .eq('board_id', currentBoardId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { console.error('loadActivityLogs:', error); return []; }
    return data || [];
  }

  async function inviteMember(email) {
    const { error } = await sb.rpc('invite_to_board', {
      p_board_id: currentBoardId,
      p_email:    email,
    });
    if (error) throw new Error(error.message);
  }

  async function loadMembers() {
    const { data, error } = await sb.rpc('get_board_members', { p_board_id: currentBoardId });
    if (error) { console.error('loadMembers:', error); return []; }
    return data || [];
  }

  // ── Realtime ───────────────────────────────────────────────────────────────

  function subscribeBoard() {
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    realtimeChannel = sb
      .channel(`board-${currentBoardId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cards', filter: `board_id=eq.${currentBoardId}` },
        handleRealtimeChange
      )
      .subscribe();
  }

  function unsubscribeBoard() {
    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  function handleRealtimeChange({ eventType, new: newRow, old: oldRow }) {
    if (eventType === 'INSERT') {
      const card   = rowToCard(newRow);
      const exists = Object.values(state).flat().some((c) => c.id === card.id);
      if (!exists && newRow.status && state[newRow.status]) {
        state = { ...state, [newRow.status]: [...state[newRow.status], card] };
        render();
        refreshActivityLog();
      }
    } else if (eventType === 'UPDATE') {
      const card = rowToCard(newRow);
      const next = {};
      for (const col of Object.keys(state)) {
        next[col] = state[col].filter((c) => c.id !== card.id);
      }
      if (newRow.status && next[newRow.status]) {
        next[newRow.status] = [...next[newRow.status], card];
      }
      if (JSON.stringify(state) !== JSON.stringify(next)) {
        state = next;
        render();
        refreshActivityLog();
      }
    } else if (eventType === 'DELETE') {
      if (Object.values(state).flat().some((c) => c.id === oldRow.id)) {
        state = deleteCard(state, oldRow.id);
        render();
        refreshActivityLog();
      }
    }
  }

  async function refreshActivityLog() {
    const logs = await loadActivityLogs();
    renderActivityLog(logs);
  }

  // ── 보드 렌더링 ────────────────────────────────────────────────────────────

  async function renderBoard() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div class="board-layout">
        <main class="board">
          ${COLUMNS.map(({ key, label }) => `
            <section class="column" id="col-${key}" data-column="${key}">
              <h2 class="column-title">${label}</h2>
              <div class="card-list" id="cards-${key}"></div>
              <button class="btn-add-card">+ 카드 추가</button>
            </section>
          `).join('')}
        </main>
        <aside class="sidebar">
          <div class="sidebar-section">
            <h3 class="sidebar-title">멤버</h3>
            <div class="member-list" id="member-list"></div>
            <form class="invite-form" id="invite-form" novalidate>
              <input class="form-input" type="email" id="invite-email" placeholder="이메일로 팀원 초대" />
              <button class="btn-invite btn-primary" type="submit">초대</button>
              <p class="invite-error" id="invite-error"></p>
            </form>
          </div>
          <div class="sidebar-section sidebar-log">
            <h3 class="sidebar-title">활동 로그</h3>
            <div class="activity-list" id="activity-list"></div>
          </div>
        </aside>
      </div>
    `;

    currentBoardId = await getOrCreateBoard();
    if (!currentBoardId) {
      app.innerHTML = '<p style="padding:24px;color:red">보드를 불러올 수 없습니다. Phase 13 SQL을 실행했는지 확인하세요.</p>';
      return;
    }

    state = await loadCards();

    const [members, logs] = await Promise.all([loadMembers(), loadActivityLogs()]);

    bindColumnEvents();
    render();
    renderMemberPanel(members);
    renderActivityLog(logs);

    document.getElementById('invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email   = document.getElementById('invite-email').value.trim();
      const errorEl = document.getElementById('invite-error');
      errorEl.textContent = '';
      if (!email) return;
      try {
        await inviteMember(email);
        document.getElementById('invite-email').value = '';
        renderMemberPanel(await loadMembers());
      } catch (err) {
        errorEl.textContent = err.message || '초대에 실패했습니다.';
      }
    });

    subscribeBoard();
  }

  function render() {
    COLUMNS.forEach(({ key }) => {
      const list = document.getElementById(`cards-${key}`);
      if (!list) return;
      list.innerHTML = '';
      state[key].forEach((card) => list.appendChild(renderCard(card)));
    });
  }

  function renderCard(card) {
    const el       = document.createElement('div');
    el.className   = 'card';
    el.draggable   = true;
    el.dataset.id  = card.id;

    const isOverdue     = card.dueDate && new Date(card.dueDate + 'T23:59:59') < new Date();
    const priorityBadge = card.priority && card.priority !== 'medium'
      ? `<span class="badge-priority ${card.priority}">${PRIORITY_LABELS[card.priority]}</span>`
      : '';
    const dueBadge  = card.dueDate
      ? `<span class="badge-due${isOverdue ? ' overdue' : ''}">${formatDate(card.dueDate)}</span>`
      : '';
    const tagBadges = (card.tags || []).map((t) => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('');
    const hasMeta   = priorityBadge || dueBadge || tagBadges;

    el.innerHTML = `
      <div class="card-body">
        <p class="card-title">${escapeHtml(card.title)}</p>
        ${card.description ? `<p class="card-description">${escapeHtml(card.description)}</p>` : ''}
        ${hasMeta ? `<div class="card-meta">${priorityBadge}${dueBadge}${tagBadges}</div>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn-edit"   data-id="${card.id}">편집</button>
        <button class="btn-delete" data-id="${card.id}">삭제</button>
      </div>
    `;

    el.addEventListener('dragstart', (e) => {
      dragCardId = card.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => el.classList.add('dragging'), 0);
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    el.querySelector('.btn-edit').addEventListener('click', () => openEditForm(el, card));
    el.querySelector('.btn-delete').addEventListener('click', async () => {
      const { id, title } = card;
      state = deleteCard(state, id);
      render();
      await deleteCardRemote(id);
      await logActivity('delete', id, title);
      await refreshActivityLog();
    });

    return el;
  }

  function openEditForm(cardEl, card) {
    const tagsStr = (card.tags || []).join(', ');
    const form    = document.createElement('div');
    form.className = 'edit-form';
    form.innerHTML = `
      <input class="form-input" type="text" value="${escapeHtml(card.title)}" placeholder="제목" />
      <textarea class="form-textarea" placeholder="설명">${escapeHtml(card.description)}</textarea>
      <div class="form-meta">
        <label class="form-label">마감일
          <input class="form-input" type="date" id="edit-due" value="${card.dueDate || ''}" />
        </label>
        <label class="form-label">우선순위
          <select class="form-select" id="edit-priority">
            <option value="high"   ${card.priority === 'high'   ? 'selected' : ''}>높음</option>
            <option value="medium" ${(!card.priority || card.priority === 'medium') ? 'selected' : ''}>보통</option>
            <option value="low"    ${card.priority === 'low'    ? 'selected' : ''}>낮음</option>
          </select>
        </label>
        <label class="form-label">태그 (쉼표 구분)
          <input class="form-input" type="text" id="edit-tags" value="${escapeHtml(tagsStr)}" placeholder="기획, 개발" />
        </label>
      </div>
      <div class="form-actions">
        <button class="btn-primary btn-edit-save">저장</button>
        <button class="btn-ghost btn-edit-cancel">취소</button>
      </div>
    `;
    cardEl.replaceWith(form);
    form.querySelector('.form-input').focus();

    form.querySelector('.btn-edit-save').addEventListener('click', async () => {
      const newTitle = form.querySelector('.form-input').value;
      if (!newTitle.trim()) return;
      const meta = {
        dueDate:  form.querySelector('#edit-due').value || null,
        priority: form.querySelector('#edit-priority').value,
        tags:     parseTags(form.querySelector('#edit-tags').value),
      };
      state = editCard(state, card.id, newTitle, form.querySelector('.form-textarea').value, meta);
      render();
      const updated = Object.values(state).flat().find((c) => c.id === card.id);
      if (updated) {
        await saveCard(updated);
        await logActivity('edit', card.id, updated.title);
        await refreshActivityLog();
      }
    });
    form.querySelector('.btn-edit-cancel').addEventListener('click', () => render());
  }

  function openAddForm(columnKey, btnEl) {
    const form    = document.createElement('div');
    form.className = 'add-form';
    form.innerHTML = `
      <input class="form-input" type="text" placeholder="제목 (필수)" />
      <textarea class="form-textarea" placeholder="설명"></textarea>
      <div class="form-meta">
        <label class="form-label">마감일
          <input class="form-input" type="date" id="add-due" />
        </label>
        <label class="form-label">우선순위
          <select class="form-select" id="add-priority">
            <option value="high">높음</option>
            <option value="medium" selected>보통</option>
            <option value="low">낮음</option>
          </select>
        </label>
        <label class="form-label">태그 (쉼표 구분)
          <input class="form-input" type="text" id="add-tags" placeholder="기획, 개발" />
        </label>
      </div>
      <div class="form-actions">
        <button class="btn-primary btn-save">저장</button>
        <button class="btn-ghost btn-cancel">취소</button>
      </div>
    `;
    btnEl.insertAdjacentElement('beforebegin', form);
    btnEl.style.display = 'none';
    form.querySelector('.form-input').focus();

    form.querySelector('.btn-save').addEventListener('click', async () => {
      const title = form.querySelector('.form-input').value;
      if (!title.trim()) return;
      const meta = {
        dueDate:  form.querySelector('#add-due').value || null,
        priority: form.querySelector('#add-priority').value,
        tags:     parseTags(form.querySelector('#add-tags').value),
      };
      state = addCard(state, columnKey, title, form.querySelector('.form-textarea').value, meta);
      form.remove();
      btnEl.style.display = '';
      render();
      const newCard = state[columnKey][state[columnKey].length - 1];
      await saveCard(newCard);
      await logActivity('add', newCard.id, newCard.title);
      await refreshActivityLog();
    });
    form.querySelector('.btn-cancel').addEventListener('click', () => {
      form.remove();
      btnEl.style.display = '';
    });
  }

  function renderActivityLog(logs) {
    const list = document.getElementById('activity-list');
    if (!list) return;
    if (logs.length === 0) {
      list.innerHTML = '<p class="activity-empty">활동 없음</p>';
      return;
    }
    list.innerHTML = logs.map((log) => {
      const isMe   = log.user_id === currentUser?.id;
      const actor  = isMe ? '나' : escapeHtml(log.user_email || '알 수 없음');
      const action = ACTION_LABELS[log.action] || log.action;
      const time   = new Date(log.created_at).toLocaleString('ko-KR', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      return `
        <div class="activity-item">
          <div class="activity-main">
            <strong>${actor}</strong> · ${action} · <em>"${escapeHtml(log.card_title)}"</em>
          </div>
          <div class="activity-time">${time}</div>
        </div>
      `;
    }).join('');
  }

  function renderMemberPanel(members) {
    const list = document.getElementById('member-list');
    if (!list) return;
    list.innerHTML = members.map((m) => {
      const isMe  = m.user_id === currentUser?.id;
      const email = isMe ? currentUser.email : (m.user_email || '알 수 없음');
      const role  = m.role === 'owner' ? '소유자' : '편집자';
      return `
        <div class="member-item">
          <span class="member-email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
          <span class="member-role ${m.role}">${role}</span>
        </div>
      `;
    }).join('');
  }

  // ── 드래그 & 드롭 ─────────────────────────────────────────────────────────

  function bindColumnEvents() {
    COLUMNS.forEach(({ key }) => {
      const col = document.getElementById(`col-${key}`);
      if (!col) return;

      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });
      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
      });
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        if (!dragCardId) return;
        const id        = dragCardId;
        const oldStatus = findCardStatus(id);
        dragCardId = null;
        if (oldStatus === key) return;
        state = moveCard(state, id, key);
        render();
        const movedCard = state[key].find((c) => c.id === id);
        if (movedCard) {
          await saveCard(movedCard);
          await logActivity('move', id, movedCard.title, { oldStatus, newStatus: key });
          await refreshActivityLog();
        }
      });
      col.querySelector('.btn-add-card').addEventListener('click', (e) => {
        openAddForm(key, e.currentTarget);
      });
    });
  }

  // ── 유틸 ──────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  }

  function parseTags(str) {
    return String(str || '').split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────

  initAuth();
}
