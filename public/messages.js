const TOKEN_KEY = 'orchard_token';

const state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  currentUser: null,
  friends: [],
  conversations: [],
  selectedFriend: null,
  socket: null,
  messages: {}
};

// DOM Elements
const conversationsList = document.getElementById('conversationsList');
const chatTitle = document.getElementById('chatTitle');
const chatContainer = document.getElementById('chatContainer');
const chatInputArea = document.getElementById('chatInputArea');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const friendSearch = document.getElementById('friendSearch');
const searchResults = document.getElementById('searchResults');
const unfriendBtn = document.getElementById('unfriendBtn');
const tabButtons = document.querySelectorAll('.tab-button');

let currentTab = 'conversations';

// API Functions
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
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

function setToken(token) {
  state.token = token || '';
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function initialsFromName(name) {
  return name ? name.split(' ').map((piece) => piece[0]).slice(0, 2).join('').toUpperCase() : '?';
}

// Fetch Current User
async function loadCurrentUser() {
  try {
    const result = await apiFetch('/api/me');
    state.currentUser = result.user;
  } catch (error) {
    console.error('Failed to load user:', error);
    window.location.href = '/';
  }
}

// Fetch Friends
async function loadFriends() {
  try {
    const result = await apiFetch('/api/friends');
    state.friends = result.friends || [];
    renderFriendsList();
    updateConversations();
  } catch (error) {
    console.error('Failed to load friends:', error);
  }
}

// Search Users
async function searchUsers(query) {
  if (!query.trim()) {
    searchResults.style.display = 'none';
    return;
  }

  try {
    const result = await apiFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
    const users = result.users || [];

    if (users.length === 0) {
      searchResults.innerHTML = '<div style="padding: 16px; color: #94a3b8; text-align: center;">No users found</div>';
    } else {
      searchResults.innerHTML = users.map(user => `
        <div class="user-item" data-user-id="${user.id}">
          <div class="avatar">${initialsFromName(user.full_name || user.username)}</div>
          <div class="info">
            <strong>${user.full_name || user.username}</strong>
            <div class="username">@${user.username}</div>
          </div>
          <button type="button" style="background: #3b82f6; border: none; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px;">Add Friend</button>
        </div>
      `).join('');

      document.querySelectorAll('.search-results .user-item').forEach(item => {
        const userId = item.getAttribute('data-user-id');
        const addBtn = item.querySelector('button');
        const isFriend = state.friends.some(f => f.id === Number(userId));
        addBtn.textContent = isFriend ? 'Already Friends' : 'Add Friend';
        addBtn.disabled = isFriend;

        addBtn.addEventListener('click', () => {
          if (!isFriend) {
            addFriend(Number(userId));
          }
        });
      });
    }

    searchResults.style.display = 'block';
  } catch (error) {
    console.error('Search failed:', error);
  }
}

// Add Friend
async function addFriend(friendId) {
  try {
    await apiFetch('/api/friends/add', {
      method: 'POST',
      body: JSON.stringify({ friend_id: friendId })
    });

    await loadFriends();
    friendSearch.value = '';
    searchResults.style.display = 'none';
  } catch (error) {
    alert('Failed to add friend: ' + error.message);
  }
}

// Remove Friend
async function removeFriend(friendId) {
  if (!confirm('Remove this friend?')) return;

  try {
    await apiFetch(`/api/friends/${friendId}`, { method: 'DELETE' });
    state.friends = state.friends.filter(f => f.id !== friendId);

    if (state.selectedFriend === friendId) {
      selectConversation(null);
    }

    loadFriends();
  } catch (error) {
    alert('Failed to remove friend: ' + error.message);
  }
}

// Render Friends List
function renderFriendsList() {
  if (currentTab !== 'friends') return;

  conversationsList.innerHTML = state.friends.length === 0 
    ? '<div style="padding: 16px; color: #94a3b8; text-align: center;">No friends yet. Search to add some!</div>'
    : state.friends.map(friend => `
      <div class="conversation-item ${state.selectedFriend === friend.id ? 'active' : ''}" data-friend-id="${friend.id}">
        <strong>${friend.full_name || friend.username}</strong>
        <div class="meta">@${friend.username}</div>
      </div>
    `).join('');

  document.querySelectorAll('.conversation-item').forEach(item => {
    const friendId = Number(item.getAttribute('data-friend-id'));
    item.addEventListener('click', () => selectConversation(friendId));
  });
}

// Render Conversations
function renderConversations() {
  if (currentTab !== 'conversations') return;

  conversationsList.innerHTML = state.conversations.length === 0
    ? '<div style="padding: 16px; color: #94a3b8; text-align: center;">No conversations yet</div>'
    : state.conversations.map(conv => `
      <div class="conversation-item ${state.selectedFriend === conv.id ? 'active' : ''}" data-friend-id="${conv.id}">
        <strong>${conv.full_name || conv.username}</strong>
        <div class="meta">@${conv.username}</div>
      </div>
    `).join('');

  document.querySelectorAll('.conversation-item').forEach(item => {
    const friendId = Number(item.getAttribute('data-friend-id'));
    item.addEventListener('click', () => selectConversation(friendId));
  });
}

// Update Conversations from Friends
function updateConversations() {
  state.conversations = state.friends.sort((a, b) => {
    const aLastMsg = Math.max(state.messages[a.id]?.lastMessageTime || 0, a.created_at ? new Date(a.created_at).getTime() : 0);
    const bLastMsg = Math.max(state.messages[b.id]?.lastMessageTime || 0, b.created_at ? new Date(b.created_at).getTime() : 0);
    return bLastMsg - aLastMsg;
  });

  if (currentTab === 'conversations') {
    renderConversations();
  }
}

// Select Conversation
async function selectConversation(friendId) {
  state.selectedFriend = friendId;
  unfriendBtn.style.display = friendId ? 'block' : 'none';

  if (friendId) {
    const friend = state.friends.find(f => f.id === friendId);
    chatTitle.textContent = friend ? (friend.full_name || friend.username) : 'Direct Message';
    chatInputArea.style.display = 'block';

    unfriendBtn.onclick = () => removeFriend(friendId);

    if (currentTab === 'conversations') {
      renderConversations();
    } else {
      renderFriendsList();
    }

    await loadMessages(friendId);
    connectSocketRoom(friendId);
  } else {
    chatTitle.textContent = 'Select a conversation';
    chatContainer.innerHTML = '<div class="empty-state"><p>Select a conversation to start messaging</p></div>';
    chatInputArea.style.display = 'none';
  }
}

// Load Messages for a Friend
async function loadMessages(friendId) {
  try {
    const result = await apiFetch(`/api/messages?recipient_id=${friendId}`);
    state.messages[friendId] = {
      list: result.messages || [],
      lastMessageTime: result.messages?.length ? new Date(result.messages[result.messages.length - 1].created_at).getTime() : 0
    };
    renderMessages(friendId);
  } catch (error) {
    console.error('Failed to load messages:', error);
  }
}

// Render Messages
function renderMessages(friendId) {
  const messages = state.messages[friendId]?.list || [];

  if (messages.length === 0) {
    chatContainer.innerHTML = '<div class="empty-state"><p>No messages yet. Say hello!</p></div>';
    return;
  }

  chatContainer.innerHTML = messages.map(msg => {
    const isSelf = msg.sender_id === state.currentUser.id;
    return `
      <div class="message-bubble ${isSelf ? 'self' : ''}">
        ${!isSelf ? `<div class="avatar">${initialsFromName(msg.sender_name || msg.sender_username)}</div>` : ''}
        <div class="message-content">
          ${!isSelf ? `<span class="sender-name">${msg.sender_name || msg.sender_username}</span>` : ''}
          ${msg.content ? `<div class="text">${msg.content}</div>` : ''}
          ${msg.image_url ? `<img class="image" src="${msg.image_url}" alt="Message" />` : ''}
        </div>
        ${isSelf ? `<div class="avatar">${initialsFromName(state.currentUser.full_name || state.currentUser.username)}</div>` : ''}
      </div>
    `;
  }).join('');

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Send Message
async function sendMessage(event) {
  event.preventDefault();

  if (!state.selectedFriend) return;

  const content = messageInput.value.trim();
  if (!content) return;

  try {
    const payload = {
      content,
      recipient_id: state.selectedFriend
    };

    await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    messageInput.value = '';
    await loadMessages(state.selectedFriend);
    updateConversations();
  } catch (error) {
    alert('Failed to send message: ' + error.message);
  }
}

// Socket.IO Connection
function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({ auth: { token: state.token } });

  state.socket.on('new_message', (message) => {
    const relevantFriendId = message.sender_id === state.currentUser.id 
      ? message.recipient_id 
      : message.sender_id;

    if (state.messages[relevantFriendId]) {
      state.messages[relevantFriendId].list.push(message);
      state.messages[relevantFriendId].lastMessageTime = new Date(message.created_at).getTime();
    } else {
      state.messages[relevantFriendId] = {
        list: [message],
        lastMessageTime: new Date(message.created_at).getTime()
      };
    }

    if (state.selectedFriend === relevantFriendId) {
      renderMessages(relevantFriendId);
    }

    updateConversations();
  });

  state.socket.on('friend_added', (friend) => {
    loadFriends();
  });

  state.socket.on('friend_removed', (data) => {
    state.friends = state.friends.filter(f => f.id !== data.id);
    if (state.selectedFriend === data.id) {
      selectConversation(null);
    }
    loadFriends();
  });
}

function connectSocketRoom(friendId) {
  if (state.socket) {
    const roomName = [state.currentUser.id, friendId].sort((a, b) => a - b).join(':');
    state.socket.emit('join_room', roomName);
  }
}

// Tab Switching
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.getAttribute('data-tab');

    if (currentTab === 'friends') {
      renderFriendsList();
    } else {
      renderConversations();
    }
  });
});

// Search Handler
let searchTimeout;
friendSearch.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();

  if (!query) {
    searchResults.style.display = 'none';
    return;
  }

  searchTimeout = setTimeout(() => {
    searchUsers(query);
  }, 300);
});

// Message Form Handler
messageForm.addEventListener('submit', sendMessage);

// Close search on outside click
document.addEventListener('click', (e) => {
  if (e.target !== friendSearch && !searchResults.contains(e.target)) {
    searchResults.style.display = 'none';
  }
});

// Initialize
async function initialize() {
  if (!state.token) {
    window.location.href = '/';
    return;
  }

  try {
    await loadCurrentUser();
    await loadFriends();
    connectSocket();
  } catch (error) {
    console.error('Initialization failed:', error);
    window.location.href = '/';
  }
}

initialize();

