// ─── 순수 함수 레이어 ────────────────────────────────────────────────────────

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createCard(title, description) {
  return { id: generateId(), title: title.trim(), description };
}

function addCard(state, column, title, description) {
  if (!title.trim()) return state;
  const card = createCard(title, description);
  return { ...state, [column]: [...state[column], card] };
}

function editCard(state, cardId, title, description) {
  if (!title.trim()) return state;
  const next = {};
  for (const col of Object.keys(state)) {
    next[col] = state[col].map((c) =>
      c.id === cardId ? { ...c, title: title.trim(), description } : c
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

// localStorage 기반 저장 — 테스트 및 fallback용으로 유지
function saveState(state) {
  localStorage.setItem('kanban-state', JSON.stringify(state));
}

function loadState() {
  const raw = localStorage.getItem('kanban-state');
  return raw ? JSON.parse(raw) : null;
}

if (typeof module !== 'undefined') {
  module.exports = { createCard, addCard, editCard, moveCard, deleteCard, saveState, loadState };
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

  let state = DEFAULT_STATE;
  let dragCardId = null;
  let currentUser = null;

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
        currentUser = null;
        state = DEFAULT_STATE;
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
          <h2 class="auth-title">로그인</h2>
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
              : '이미 계정이 있으신가요? <button class="btn-link" id="btn-toggle">로그인</button>'
            }
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
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errorEl = document.getElementById('auth-error');
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
    await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
  }

  async function signInWithGitHub() {
    await sb.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: window.location.href },
    });
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

  async function signOut() {
    await sb.auth.signOut();
  }

  function updateHeaderUser(user) {
    const el = document.getElementById('header-user');
    if (!el) return;
    if (user) {
      el.innerHTML = `
        <span class="header-email">${escapeHtml(user.email)}</span>
        <button class="btn-logout">로그아웃</button>
      `;
      el.querySelector('.btn-logout').addEventListener('click', signOut);
    } else {
      el.innerHTML = '';
    }
  }

  // ── Supabase DB ────────────────────────────────────────────────────────────

  async function loadCards(userId) {
    const { data, error } = await sb
      .from('cards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at');
    if (error) { console.error('loadCards:', error); return DEFAULT_STATE; }
    const next = { 'todo': [], 'in-progress': [], 'done': [] };
    (data || []).forEach((row) => {
      if (next[row.status]) {
        next[row.status].push({ id: row.id, title: row.title, description: row.description });
      }
    });
    return next;
  }

  async function saveCard(card) {
    const status = findCardStatus(card.id);
    if (!status) return;
    const { error } = await sb.from('cards').upsert({
      id: card.id,
      user_id: currentUser.id,
      title: card.title,
      description: card.description,
      status,
      updated_at: new Date().toISOString(),
    });
    if (error) console.error('saveCard:', error);
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

  // ── 보드 렌더링 ────────────────────────────────────────────────────────────

  async function renderBoard() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <main class="board">
        ${COLUMNS.map(({ key, label }) => `
          <section class="column" id="col-${key}" data-column="${key}">
            <h2 class="column-title">${label}</h2>
            <div class="card-list" id="cards-${key}"></div>
            <button class="btn-add-card">+ 카드 추가</button>
          </section>
        `).join('')}
      </main>
    `;
    state = await loadCards(currentUser.id);
    bindColumnEvents();
    render();
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
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.dataset.id = card.id;
    el.innerHTML = `
      <div class="card-body">
        <p class="card-title">${escapeHtml(card.title)}</p>
        ${card.description ? `<p class="card-description">${escapeHtml(card.description)}</p>` : ''}
      </div>
      <div class="card-actions">
        <button class="btn-edit" data-id="${card.id}">편집</button>
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
      state = deleteCard(state, card.id);
      render();
      await deleteCardRemote(card.id);
    });

    return el;
  }

  function openEditForm(cardEl, card) {
    const form = document.createElement('div');
    form.className = 'edit-form';
    form.innerHTML = `
      <input class="form-input" type="text" value="${escapeHtml(card.title)}" placeholder="제목" />
      <textarea class="form-textarea" placeholder="설명">${escapeHtml(card.description)}</textarea>
      <div class="form-actions">
        <button class="btn-primary btn-edit-save">저장</button>
        <button class="btn-ghost btn-edit-cancel">취소</button>
      </div>
    `;
    cardEl.replaceWith(form);
    const inputEl = form.querySelector('.form-input');
    inputEl.focus();

    form.querySelector('.btn-edit-save').addEventListener('click', async () => {
      const newTitle = inputEl.value;
      if (!newTitle.trim()) return;
      state = editCard(state, card.id, newTitle, form.querySelector('.form-textarea').value);
      render();
      const updated = Object.values(state).flat().find((c) => c.id === card.id);
      if (updated) await saveCard(updated);
    });
    form.querySelector('.btn-edit-cancel').addEventListener('click', () => render());
  }

  function openAddForm(columnKey, btnEl) {
    const form = document.createElement('div');
    form.className = 'add-form';
    form.innerHTML = `
      <input class="form-input" type="text" placeholder="제목 (필수)" />
      <textarea class="form-textarea" placeholder="설명"></textarea>
      <div class="form-actions">
        <button class="btn-primary btn-save">저장</button>
        <button class="btn-ghost btn-cancel">취소</button>
      </div>
    `;
    btnEl.insertAdjacentElement('beforebegin', form);
    btnEl.style.display = 'none';
    const inputEl = form.querySelector('.form-input');
    inputEl.focus();

    form.querySelector('.btn-save').addEventListener('click', async () => {
      const title = inputEl.value;
      if (!title.trim()) return;
      state = addCard(state, columnKey, title, form.querySelector('.form-textarea').value);
      form.remove();
      btnEl.style.display = '';
      render();
      const newCard = state[columnKey][state[columnKey].length - 1];
      await saveCard(newCard);
    });
    form.querySelector('.btn-cancel').addEventListener('click', () => {
      form.remove();
      btnEl.style.display = '';
    });
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
        const moved = Object.values(state).flat().find((c) => c.id === dragCardId);
        state = moveCard(state, dragCardId, key);
        dragCardId = null;
        render();
        if (moved) await saveCard(moved);
      });
      col.querySelector('.btn-add-card').addEventListener('click', (e) => {
        openAddForm(key, e.currentTarget);
      });
    });
  }

  // ── 유틸 ──────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── 초기화 ────────────────────────────────────────────────────────────────

  initAuth();
}
