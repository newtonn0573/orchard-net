const TOKEN_KEY = 'orchard_token';
const authMessageEl = document.getElementById('authMessage');
const signupForm = document.getElementById('signupForm');
const loginForm = document.getElementById('loginForm');
const logoutButton = document.getElementById('logoutButton');
const userListEl = document.getElementById('userList');
const messagesEl = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const messageImageInput = document.getElementById('messageImageInput');
const profileForm = document.getElementById('profileForm');
const profilePhotoInput = document.getElementById('profilePhotoInput');
const activeChatTitle = document.getElementById('activeChatTitle');
const publicProfileEl = document.getElementById('publicProfile');
const profileDescriptionEl = document.getElementById('profileDescription');

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  currentUser: null,
  users: [],
  selectedRecipientId: null,
  socket: null
};

function showAuthMessage(message, isError = true) {
  if (!authMessageEl) return;
  authMessageEl.textContent = message;
  authMessageEl.style.color = isError ? '#a64242' : '#2e4b36';
}

function setToken(token) {
  state.token = token || '';
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function getAuthHeaders(formData = false) {
  const headers = {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (!formData && !headers.Authorization) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const isFormData = options.body instanceof FormData;

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (!isFormData && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload.error || 'Request failed.';
    throw new Error(message);
  }

  return payload;
}

function renderLandingTabs() {
  const tabs = document.querySelectorAll('.tab');
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((item) => item.classList.toggle('active', item === tab));
      const target = tab.dataset.tab;
      const showSignup = target === 'signup';
      signupForm?.classList.toggle('hidden', !showSignup);
      loginForm?.classList.toggle('hidden', showSignup);
    });
  });

  document.getElementById('signupHero')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const signupTab = document.querySelector('[data-tab="signup"]');
    signupTab?.click();
  });

  document.getElementById('openLogin')?.addEventListener('click', () => {
    const loginTab = document.querySelector('[data-tab="login"]');
    loginTab?.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function handleSignup(event) {
  event.preventDefault();
  const formData = new FormData(signupForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await apiFetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    setToken(result.token);
    showAuthMessage('Account created successfully.', false);
    window.location.href = '/messages';
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    setToken(result.token);
    window.location.href = '/messages';
  } catch (error) {
    showAuthMessage(error.message);
  }
}

function initialsFromName(name) {
  return name ? name.split(' ').map((piece) => piece[0]).slice(0, 2).join('').toUpperCase() : 'O';
}

function renderProfileCard(user) {
  if (!user) return;

  const profileSummary = document.getElementById('profileSummary');
  if (!profileSummary) return;

  const avatar = user.avatar ? `<img class="profile-avatar" src="${user.avatar}" alt="${user.full_name || user.username}" />` : `<div class="profile-avatar empty">${initialsFromName(user.full_name || user.username)}</div>`;

  profileSummary.innerHTML = `
    ${avatar}
    <div style="text-align:center;">
      <h3>${user.full_name || user.username}</h3>
      <div>@${user.username}</div>
      <p>${user.bio || 'No bio yet.'}</p>
    </div>
  `;

  const profileFormEl = document.getElementById('profileForm');
  if (profileFormEl) {
    profileFormEl.querySelector('[name="full_name"]').value = user.full_name || user.username;
    profileFormEl.querySelector('[name="bio"]').value = user.bio || '';
  }
}

async function loadCurrentUser() {
  const result = await apiFetch('/api/me');
  state.currentUser = result.user;
  renderProfileCard(state.currentUser);
}

function setActiveChatTitle() {
  if (!activeChatTitle) return;

  if (state.selectedRecipientId) {
    const selectedUser = state.users.find((user) => user.id === state.selectedRecipientId);
    activeChatTitle.textContent = selectedUser ? `${selectedUser.full_name || selectedUser.username}` : 'Direct chat';
  } else {
    activeChatTitle.textContent = 'Global chat';
  }
}

function renderUsers(users) {
  if (!userListEl) return;

  userListEl.innerHTML = '';

  const globalOption = document.createElement('button');
  globalOption.type = 'button';
  globalOption.className = `user-card ${!state.selectedRecipientId ? 'active' : ''}`;
  globalOption.innerHTML = `
    <div class="user-avatar">G</div>
    <div>
      <strong>Global chat</strong>
      <div class="muted-label">Public room</div>
    </div>
  `;
  globalOption.addEventListener('click', () => {
    state.selectedRecipientId = null;
    setActiveChatTitle();
    renderUsers(state.users);
    fetchMessages();
  });
  userListEl.appendChild(globalOption);

  users.forEach((user) => {
    if (user.id === state.currentUser?.id) return;

    const userCard = document.createElement('button');
    userCard.type = 'button';
    userCard.className = `user-card ${state.selectedRecipientId === user.id ? 'active' : ''}`;
    userCard.innerHTML = `
      <div class="user-avatar">${initialsFromName(user.full_name || user.username)}</div>
      <div>
        <strong>${user.full_name || user.username}</strong>
        <div class="muted-label">@${user.username}</div>
      </div>
    `;
    userCard.addEventListener('click', () => {
      state.selectedRecipientId = user.id;
      setActiveChatTitle();
      renderUsers(state.users);
      fetchMessages();
    });
    userListEl.appendChild(userCard);
  });
}

function renderMessages(messages) {
  if (!messagesEl) return;

  messagesEl.innerHTML = '';
  messages.forEach((message) => {
    const bubble = document.createElement('div');
    const isSelf = Number(message.sender_id) === Number(state.currentUser?.id);
    bubble.className = `message-bubble ${isSelf ? 'self' : ''}`;
    bubble.innerHTML = `
      <div class="message-meta">
        <strong>${message.sender_name || message.sender_username || 'Unknown'}</strong>
        <span>${new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      ${message.content ? `<div>${message.content}</div>` : ''}
      ${message.image_url ? `<img class="message-image" src="${message.image_url}" alt="Message attachment" />` : ''}
    `;
    messagesEl.appendChild(bubble);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function fetchMessages() {
  const query = state.selectedRecipientId ? `?recipient_id=${state.selectedRecipientId}` : '';
  const result = await apiFetch(`/api/messages${query}`);
  renderMessages(result.messages || []);
}

async function loadUsers() {
  const result = await apiFetch('/api/users');
  state.users = result.users || [];
  renderUsers(state.users);
}

function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('connect', () => {
    if (state.selectedRecipientId) {
      state.socket.emit('join_room', `chat:${[state.currentUser.id, state.selectedRecipientId].sort((a, b) => Number(a) - Number(b)).join(':')}`);
    }
  });

  state.socket.on('new_message', (message) => {
    const messages = [...(window.__orchardMessages || [])];
    const match = messages.find((item) => Number(item.id) === Number(message.id));
    if (!match) {
      messages.push(message);
    }
    window.__orchardMessages = messages;

    const isGlobal = !state.selectedRecipientId;
    const isRelevant =
      (!state.selectedRecipientId && !message.recipient_id) ||
      (state.selectedRecipientId && (Number(message.sender_id) === state.selectedRecipientId || Number(message.recipient_id) === state.selectedRecipientId));

    if (isRelevant) {
      renderMessages(messages.filter((item) => {
        if (!state.selectedRecipientId) {
          return !item.recipient_id;
        }

        return (
          (Number(item.sender_id) === state.currentUser.id && Number(item.recipient_id) === state.selectedRecipientId) ||
          (Number(item.sender_id) === state.selectedRecipientId && Number(item.recipient_id) === state.currentUser.id) ||
          (!item.recipient_id && Number(item.sender_id) === state.selectedRecipientId)
        );
      }));
    }
  });
}

async function uploadFile(file, endpoint = '/api/media') {
  const formData = new FormData();
  formData.append('photo', file);
  const result = await apiFetch(endpoint, {
    method: 'POST',
    body: formData
  });
  return result.url;
}

async function sendMessage(event) {
  event.preventDefault();
  const content = messageInput.value.trim();
  const file = messageImageInput.files[0];

  let imageUrl = null;
  if (file) {
    imageUrl = await uploadFile(file, '/api/media');
  }

  const payload = {
    content,
    recipient_id: state.selectedRecipientId,
    image_url: imageUrl
  };

  if (!payload.content && !payload.image_url) {
    return;
  }

  try {
    const response = await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const message = response.message;
    if (state.socket) {
      state.socket.emit('send_message', { ...payload, recipient_id: state.selectedRecipientId });
    }

    messageInput.value = '';
    messageImageInput.value = '';
    fetchMessages();
    if (message) {
      window.__orchardMessages = [...(window.__orchardMessages || []), message];
    }
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function handleProfileUpdate(event) {
  event.preventDefault();
  const formData = new FormData(profileForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const result = await apiFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        full_name: payload.full_name,
        bio: payload.bio
      })
    });

    state.currentUser = result.user;
    renderProfileCard(state.currentUser);
    loadUsers();
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function handleProfilePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const url = await uploadFile(file, '/api/upload');
    const result = await apiFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ avatar: url })
    });

    state.currentUser = result.user;
    renderProfileCard(state.currentUser);
    loadUsers();
  } catch (error) {
    showAuthMessage(error.message);
  }
}

async function renderPublicProfile() {
  const username = window.location.pathname.replace('/profile/', '').replace('/profile', '').trim();
  const profileTarget = username || state.currentUser?.username;

  if (!profileTarget) return;

  try {
    const result = await apiFetch(`/api/profile/${profileTarget}`);
    const user = result.user;
    const avatar = user.avatar ? `<img class="profile-avatar" src="${user.avatar}" alt="${user.full_name || user.username}" />` : `<div class="profile-avatar empty">${initialsFromName(user.full_name || user.username)}</div>`;
    publicProfileEl.innerHTML = `${avatar}<h2>${user.full_name || user.username}</h2><p>@${user.username}</p>`;
    profileDescriptionEl.textContent = user.bio || 'This community member has not added a bio yet.';
  } catch (error) {
    publicProfileEl.innerHTML = '<h2>Profile not found</h2>';
    profileDescriptionEl.textContent = error.message;
  }
}

async function initializeAppPage() {
  if (!state.token) {
    window.location.href = '/';
    return;
  }

  try {
    await loadCurrentUser();
    await loadUsers();
    setActiveChatTitle();
    state.selectedRecipientId = null;
    connectSocket();
    window.__orchardMessages = [];
    await fetchMessages();
    if (profileForm) {
      profileForm.addEventListener('submit', handleProfileUpdate);
    }
    if (profilePhotoInput) {
      profilePhotoInput.addEventListener('change', handleProfilePhotoUpload);
    }
    if (messageForm) {
      messageForm.addEventListener('submit', sendMessage);
    }
  } catch (error) {
    console.error(error);
    setToken('');
    window.location.href = '/';
  }
}

if (signupForm) {
  signupForm.addEventListener('submit', handleSignup);
}

if (loginForm) {
  loginForm.addEventListener('submit', handleLogin);
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    setToken('');
    if (state.socket) {
      state.socket.disconnect();
    }
    window.location.href = '/';
  });
}

if (messageForm) {
  messageForm.addEventListener('submit', sendMessage);
}

if (profilePhotoInput) {
  profilePhotoInput.addEventListener('change', handleProfilePhotoUpload);
}

renderLandingTabs();

if (document.body.classList.contains('dashboard-page')) {
  initializeAppPage();
}

if (publicProfileEl) {
  renderPublicProfile();
}

if (logoutButton && window.location.pathname === '/profile') {
  logoutButton.addEventListener('click', () => {
    setToken('');
    window.location.href = '/';
  });
}
