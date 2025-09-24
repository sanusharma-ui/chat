let socket;
let mediaRecorder;
let isRecording = false;
let currentRoomId;

// WebRTC Variables
let localStream;
let remoteStream;
let peerConnection;
let isCallActive = false;
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Dynamic Socket URL
const socketUrl = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : 'https://shadowchat-3.onrender.com/'; // Replace with your Render URL

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
    console.error('Error generating room:', error);
    alert('Error generating room');
  }
};

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
    console.error('Error creating custom room:', error);
    roomAvailability.style.display = 'block';
    roomAvailability.style.color = '#ff4081';
    roomAvailability.textContent = 'Error creating room';
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
    roomId = input;
  }

  if (!roomId) return alert('Invalid input');
  joinRoom(roomId);
  updateURL(roomId);
};

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
          console.error('Error uploading voice note:', error);
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
      console.error('Error accessing microphone:', error);
      alert('Error accessing microphone');
    }
  } else {
    mediaRecorder.stop();
  }
};

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
    console.error('Error uploading file:', error);
    alert('Error uploading file');
  }

  e.target.value = '';
});

document.getElementById('mediaMenuBtn').onclick = () => {
  const mediaMenu = document.getElementById('mediaMenu');
  mediaMenu.style.display = mediaMenu.style.display === 'none' ? 'flex' : 'none';
};

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

document.getElementById('imageModal').onclick = (e) => {
  if (e.target === document.getElementById('imageModal')) {
    document.getElementById('imageModal').style.display = 'none';
  }
};

// WebRTC Functions
async function startCall() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;

    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      remoteStream = event.streams[0];
      document.getElementById('remoteVideo').srcObject = remoteStream;
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', { to: getOtherUserId(), candidate: event.candidate });
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('webrtc-offer', { to: getOtherUserId(), offer: offer });

    isCallActive = true;
    document.getElementById('startCall').style.display = 'none';
    document.getElementById('endCall').style.display = 'inline-block';
    document.getElementById('videoCallContainer').style.display = 'block';
  } catch (error) {
    console.error('Error starting call:', error);
    alert('Error starting video call. Please check permissions.');
  }
}

function endCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach(track => track.stop());
    remoteStream = null;
  }
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('startCall').style.display = 'inline-block';
  document.getElementById('endCall').style.display = 'none';
  document.getElementById('toggleAudio').textContent = '🔇 Mute Audio';
  document.getElementById('toggleVideo').textContent = '🎥 Stop Video';
  document.getElementById('videoCallContainer').style.display = 'none';
  isCallActive = false;
}

function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
    document.getElementById('toggleAudio').textContent = audioTrack.enabled ? '🔇 Mute Audio' : '🔊 Unmute Audio';
    document.getElementById('toggleAudio').classList.toggle('muted', !audioTrack.enabled);
  }
}

function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
    document.getElementById('toggleVideo').textContent = videoTrack.enabled ? '🎥 Stop Video' : '🎥 Start Video';
    document.getElementById('toggleVideo').classList.toggle('muted', !videoTrack.enabled);
  }
}

function getOtherUserId() {
  // Since it's 1:1, the other user is the only one in the room besides self
  // For simplicity, assume socket.id is unique; in practice, track partner ID
  // Here, we emit to room, but backend routes to the other
  return 'room'; // Backend handles to: data.to, but since 1:1, emit to room or use partner ID
}

function joinRoom(roomId) {
  currentRoomId = roomId;
  document.getElementById('landing').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';

  socket = io(socketUrl, { query: { room: roomId } });

  socket.on('error', (msg) => {
    console.error('Socket error:', msg);
    alert(msg);
    window.location.href = '/';
  });

  socket.on('waiting', () => {
    document.getElementById('status').textContent = 'Waiting for partner...';
  });

  socket.on('paired', () => {
    document.getElementById('status').textContent = 'Connected! Start chatting.';
    // Show video call button after paired
    document.getElementById('startCall').style.display = 'inline-block';
  });

  socket.on('partnerLeft', () => {
    document.getElementById('status').textContent = 'Partner left.';
    endCall(); // End call if active
  });

  // WebRTC Signaling Events
  socket.on('webrtc-offer', async (data) => {
    if (!peerConnection) {
      peerConnection = new RTCPeerConnection(configuration);
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      document.getElementById('localVideo').srcObject = localStream;
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      peerConnection.ontrack = (event) => {
        remoteStream = event.streams[0];
        document.getElementById('remoteVideo').srcObject = remoteStream;
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-ice-candidate', { to: data.from, candidate: event.candidate });
        }
      };
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', { to: data.from, answer: answer });

    isCallActive = true;
    document.getElementById('startCall').style.display = 'none';
    document.getElementById('endCall').style.display = 'inline-block';
    document.getElementById('videoCallContainer').style.display = 'block';
  });

  socket.on('webrtc-answer', async (data) => {
    if (peerConnection && peerConnection.remoteDescription === null) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    if (peerConnection) {
      peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
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

  socket.on('typing', (data) => {
    console.log('Typing event received:', data); // Debug log
    const typingIndicator = document.getElementById('typing');
    if (data.isTyping && data.user !== socket.id) {
      typingIndicator.textContent = 'Partner is typing...';
    } else {
      typingIndicator.textContent = '';
    }
  });

  // Call Controls Event Listeners
  document.getElementById('startCall').onclick = startCall;
  document.getElementById('endCall').onclick = endCall;
  document.getElementById('toggleAudio').onclick = toggleAudio;
  document.getElementById('toggleVideo').onclick = toggleVideo;

  const messageInput = document.getElementById('messageInput');
  let typingTimeout;

  messageInput.addEventListener('input', () => {
    console.log('Emitting typing:', true); // Debug log
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      console.log('Emitting typing:', false); // Debug log
      socket.emit('typing', false);
    }, 1000);
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

  // Cleanup on disconnect
  socket.on('disconnect', () => {
    endCall();
  });
}

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