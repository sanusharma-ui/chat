
let socket;
let mediaRecorder;
let isRecording = false;
let currentRoomId; // Store current room globally

document.getElementById('generate').onclick = async () => {
  try {
    const res = await fetch('/create-room');
    const { link } = await res.json();
    const linkElement = document.getElementById('link');
    linkElement.textContent = link;
    linkElement.href = link;
    document.getElementById('linkDisplay').style.display = 'block';
    document.getElementById('roomAvailability').style.display = 'none';
  } catch (error) {
    alert('Error generating room');
  }
};

// Custom Room Creation
document.getElementById('createCustomRoom').onclick = async () => {
  const customRoomInput = document.getElementById('customRoomInput').value.trim();
  const roomAvailability = document.getElementById('roomAvailability');

  if (!customRoomInput || !/^[a-zA-Z0-9-]{5,20}$/.test(customRoomInput)) {
    roomAvailability.style.display = 'block';
    roomAvailability.style.color = '#ff4081';
    roomAvailability.textContent = 'Room ID must be 5-20 alphanumeric characters or hyphens.';
    return;
  }

  try {
    const res = await fetch('/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId: customRoomInput })
    });
    const data = await res.json();
    if (data.error) {
      roomAvailability.style.display = 'block';
      roomAvailability.style.color = '#ff4081';
      roomAvailability.textContent = data.error;
      return;
    }

    const linkElement = document.getElementById('link');
    linkElement.textContent = data.link;
    linkElement.href = data.link;
    document.getElementById('linkDisplay').style.display = 'block';
    roomAvailability.style.display = 'block';
    roomAvailability.style.color = '#00ff88';
    roomAvailability.textContent = 'Room created successfully!';
  } catch (error) {
    roomAvailability.style.display = 'block';
    roomAvailability.style.color = '#ff4081';
    roomAvailability.textContent = 'Error creating room';
  }
};

// Join Generated Room
document.getElementById('joinGenerated').onclick = () => {
  const link = document.getElementById('link').textContent;
  const url = new URL(link);
  const roomId = url.searchParams.get('room');
  if (roomId) {
    joinRoom(roomId);
    updateURL(roomId);
  }
};

// Join by Input
document.getElementById('join').onclick = () => {
  let input = document.getElementById('roomInput').value.trim();
  if (!input) return alert('Enter a link or room ID');

  let roomId;
  try {
    const url = new URL(input);
    roomId = url.searchParams.get('room');
  } catch {
    roomId = input;
  }

  if (!roomId) return alert('Invalid input');
  joinRoom(roomId);
  updateURL(roomId);
};

// Voice Note Recording & Upload
document.getElementById('voiceNoteBtn').onclick = async () => {
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      let chunks = [];

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('voiceNote', blob, `voice-note-${Date.now()}.webm`);
        formData.append('roomId', currentRoomId);
        formData.append('senderId', socket.id);

        try {
          await fetch('/upload-voice-note', {
            method: 'POST',
            body: formData,
          });
        } catch (error) {
          alert('Error uploading voice note');
        }

        stream.getTracks().forEach(track => track.stop());
        document.getElementById('voiceNoteBtn').classList.remove('recording');
        isRecording = false;
      };

      mediaRecorder.start();
      document.getElementById('voiceNoteBtn').classList.add('recording');
      isRecording = true;
    } catch (error) {
      alert('Error accessing microphone');
    }
  } else {
    mediaRecorder.stop();
  }
};

// Media Upload
document.getElementById('mediaInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('media', file);
  formData.append('roomId', currentRoomId);
  formData.append('senderId', socket.id);

  try {
    await fetch('/upload-media', { method: 'POST', body: formData });
  } catch (error) {
    alert('Error uploading file');
  }

  e.target.value = '';
});

// Media Menu Toggle for Mobile
document.getElementById('mediaMenuBtn').onclick = () => {
  const mediaMenu = document.getElementById('mediaMenu');
  mediaMenu.style.display = mediaMenu.style.display === 'none' ? 'flex' : 'none';
};

// Image Modal Handling
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.message')) {
    const modal = document.getElementById('imageModal');
    const modalImg = document.getElementById('modalImage');
    modalImg.src = e.target.src;
    modal.style.display = 'flex';
  }
});

document.getElementById('closeModal').onclick = () => {
  document.getElementById('imageModal').style.display = 'none';
};

// Close modal when clicking outside image
document.getElementById('imageModal').onclick = (e) => {
  if (e.target === document.getElementById('imageModal')) {
    document.getElementById('imageModal').style.display = 'none';
  }
};

function joinRoom(roomId) {
  currentRoomId = roomId;
  document.getElementById('landing').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';

  socket = io({ query: { room: roomId } });

  socket.on('error', (msg) => {
    alert(msg);
    window.location.href = '/';
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
    if (msg.sender !== socket.id) socket.emit('seen', msg.id);
    scrollToBottom();
  });

  socket.on('fileMessage', (msg) => {
    appendFileMessage(msg);
    if (msg.sender !== socket.id) socket.emit('seen', msg.id);
    scrollToBottom();
  });

  socket.on('messageSeen', (messageId) => {
    const msgEl = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgEl) {
      const status = msgEl.querySelector('.status');
      if (status) status.textContent = 'Seen';
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

  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('send').click();
  });
}

// Display Text Messages
function appendMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.dataset.id = msg.id;
  div.classList.add(msg.sender === socket.id ? 'me' : 'other');
  const text = msg.sender === socket.id ? msg.text : `Partner: ${msg.text}`;
  div.innerHTML = `<p>${text}</p><small>${msg.time}</small>`;

  if (msg.sender === socket.id) {
    const status = document.createElement('small');
    status.classList.add('status');
    status.textContent = 'Sent';
    div.appendChild(status);
  }

  document.getElementById('messages').appendChild(div);
}

// Display File Messages
function appendFileMessage(msg) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.dataset.id = msg.id;
  div.classList.add(msg.sender === socket.id ? 'me' : 'other');

  const prefix = msg.sender === socket.id ? '' : 'Partner: ';
  let content = '';

  if (msg.type === 'voice' || msg.type === 'audio') {
    content = `${prefix}<audio controls src="${msg.fileUrl}"></audio>`;
  } else if (msg.type === 'image') {
    content = `${prefix}<img src="${msg.fileUrl}" alt="Image" />`;
  } else if (msg.type === 'video') {
    content = `${prefix}<video controls src="${msg.fileUrl}"></video>`;
  } else {
    content = `${prefix}<a href="${msg.fileUrl}" download>Download File</a>`;
  }

  div.innerHTML = `${content}<small>${msg.time}</small>`;

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

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room');
  if (roomId) joinRoom(roomId);
});