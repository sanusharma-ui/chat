let socket;

document.getElementById('generate').onclick = async () => {
  try {
    const res = await fetch('/create-room');
    const { link } = await res.json();
    const linkElement = document.getElementById('link');
    linkElement.textContent = link;
    linkElement.href = link;
    document.getElementById('linkDisplay').style.display = 'block';
  } catch (error) {
    alert('Error generating room');
  }
};

document.getElementById('joinGenerated').onclick = () => {
  const link = document.getElementById('link').textContent;
  const url = new URL(link);
  const roomId = url.searchParams.get('room');
  if (roomId) {
    joinRoom(roomId);
    updateURL(roomId);
  }
};

document.getElementById('join').onclick = () => {
  let input = document.getElementById('roomInput').value.trim();
  if (!input) return alert('Enter a link or room ID');
  
  let roomId;
  try {
    const url = new URL(input);
    roomId = url.searchParams.get('room');
  } catch {
    roomId = input; // Assume it's a room ID
  }
  
  if (!roomId) return alert('Invalid input');
  joinRoom(roomId);
  updateURL(roomId);
};

function joinRoom(roomId) {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';

  socket = io({ query: { room: roomId } });

  socket.on('error', (msg) => {
    alert(msg);
    window.location.href = '/'; // Redirect to landing page on error
  });

  socket.on('waiting', () => {
    document.getElementById('status').textContent = 'Waiting for partner...';
  });

  socket.on('paired', () => {
    document.getElementById('status').textContent = 'Connected! Start chatting.';
  });

  socket.on('partnerLeft', () => {
    document.getElementById('status').textContent = 'Partner left.';
  });

  socket.on('message', (msg) => {
    appendMessage(msg);
    if (msg.sender !== socket.id) {
      socket.emit('seen', msg.id);
    }
    scrollToBottom();
  });

  socket.on('messageSeen', (messageId) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgEl) {
      const status = msgEl.querySelector('.status');
      if (status) status.textContent = 'Seen';
    }
  });

  socket.on('typing', ({ user, isTyping }) => {
    if (user !== socket.id) {
      document.getElementById('typing').textContent = isTyping ? 'Shadow is typing...' : '';
    }
  });

  const messageInput = document.getElementById('messageInput');
  let typingTimeout;

  messageInput.addEventListener('input', () => {
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit('typing', false), 1000);
  });

  document.getElementById('send').onclick = () => {
    const text = messageInput.value.trim();
    if (!text) return;
    socket.emit('message', text);
    messageInput.value = '';
    socket.emit('typing', false);
    scrollToBottom();
  };

  // Handle Enter key for sending messages
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('send').click();
    }
  });
}

function appendMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.dataset.id = msg.id;
  div.classList.add(msg.sender === socket.id ? 'me' : 'other');
  const text = msg.sender === socket.id ? msg.text : `Shadow: ${msg.text}`;
  div.innerHTML = `<p>${text}</p><small>${msg.time}</small>`;
  
  if (msg.sender === socket.id) {
    const status = document.createElement('small');
    status.classList.add('status');
    status.textContent = 'Sent';
    div.appendChild(status);
  }
  
  document.getElementById('messages').appendChild(div);
}

function scrollToBottom() {
  const messages = document.getElementById('messages');
  messages.scrollTop = messages.scrollHeight;
}

function updateURL(roomId) {
  const newURL = `${window.location.origin}/?room=${roomId}`;
  window.history.replaceState({}, '', newURL);
}

// Auto-join if room ID is in URL
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  if (roomId) {
    joinRoom(roomId);
  }
});