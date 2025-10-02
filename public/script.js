
let socket;
let mediaRecorder;
let isRecording = false;
let currentRoomId;
let partnerId; 

// WebRTC Variables
let localStream;
let remoteStream;
let peerConnection;
let isCallActive = false;
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // Uncomment TURN server if NAT issues occur
    // { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

// Dynamic Socket URL
const socketUrl = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000' 
  : 'https://shadowchat-3.onrender.com/';

document.getElementById('generate').onclick = async () => {
  try {
    const res = await fetch('/create-room');
    if (!res.ok) throw new Error('Failed to generate room');
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
    if (!res.ok) throw new Error('Failed to create custom room');
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

document.getElementById('copyLink').onclick = () => {
  const link = document.getElementById('link').textContent;
  navigator.clipboard.writeText(link).then(() => {
    alert('Link copied to clipboard!');
  }).catch(err => {
    console.error('Error copying link:', err);
    alert('Failed to copy link');
  });
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
          const res = await fetch('/upload-voice-note', {
            method: 'POST',
            body: formData,
          });
          if (!res.ok) throw new Error('Upload failed');
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
    const res = await fetch('/upload-media', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Upload failed');
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


async function startCall() {
  if (!partnerId) {
    console.error('Partner ID not set, cannot start call');
    alert('Partner not connected yet. Please wait for partner to join.');
    return;
  }
  console.log('Starting call with partner ID:', partnerId);
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;

    peerConnection = new RTCPeerConnection(configuration);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      console.log('Received remote stream');
      remoteStream = event.streams[0];
      document.getElementById('remoteVideo').srcObject = remoteStream;
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', partnerId);
        socket.emit('webrtc-ice-candidate', { to: partnerId, candidate: event.candidate });
      }
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('Sending WebRTC offer to:', partnerId);
    socket.emit('webrtc-offer', { to: partnerId, offer: offer });

    isCallActive = true;
    document.getElementById('startCallContainer').style.display = 'none';
    document.getElementById('endCall').style.display = 'inline-block';
    document.getElementById('videoCallContainer').style.display = 'block';
  } catch (error) {
    console.error('Error starting call:', error);
    alert('Error starting video call. Please check camera/mic permissions.');
  }
}

function endCall() {
  console.log('Ending call');
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
  document.getElementById('endCall').style.display = 'none';
  document.getElementById('toggleAudio').textContent = '🔇 Mute Audio';
  document.getElementById('toggleVideo').textContent = '🎥 Stop Video';
  document.getElementById('toggleAudio').classList.remove('muted');
  document.getElementById('toggleVideo').classList.remove('muted');
  document.getElementById('videoCallContainer').style.display = 'none';
  if (partnerId) document.getElementById('startCallContainer').style.display = 'block';
  isCallActive = false;
}

function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const btn = document.getElementById('toggleAudio');
      btn.textContent = audioTrack.enabled ? '🔇 Mute Audio' : '🔊 Unmute Audio';
      btn.classList.toggle('muted', !audioTrack.enabled);
      console.log('Audio toggled:', audioTrack.enabled ? 'Unmuted' : 'Muted');
    }
  }
}

function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      const btn = document.getElementById('toggleVideo');
      btn.textContent = videoTrack.enabled ? '🎥 Stop Video' : '▶️ Start Video';
      btn.classList.toggle('muted', !videoTrack.enabled);
      console.log('Video toggled:', videoTrack.enabled ? 'On' : 'Off');
    }
  }
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
    console.log('Waiting for partner...');
    document.getElementById('status').textContent = 'Waiting for partner...';
    document.getElementById('startCallContainer').style.display = 'none';
  });

  socket.on('partnerId', (id) => {
    partnerId = id;
    console.log('Partner ID received:', id);
  });

  socket.on('paired', () => {
    console.log('Partner connected, ready to chat/call');
    document.getElementById('status').textContent = 'Connected! Start chatting or video call.';
    if (partnerId) {
      document.getElementById('startCallContainer').style.display = 'block';
    } else {
      console.error('Partner ID not set on paired event');
      document.getElementById('status').textContent = 'Error: Partner ID not received. Please reconnect.';
    }
  });

  socket.on('partnerLeft', () => {
    console.log('Partner disconnected');
    document.getElementById('status').textContent = 'Partner left.';
    endCall();
    partnerId = null;
    document.getElementById('startCallContainer').style.display = 'none';
  });

  socket.on('webrtc-offer', async (data) => {
    console.log('Received WebRTC offer from:', data.from);
    partnerId = data.from; // Set if not set
    if (!peerConnection) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        peerConnection = new RTCPeerConnection(configuration);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.ontrack = (event) => {
          console.log('Received remote stream');
          remoteStream = event.streams[0];
          document.getElementById('remoteVideo').srcObject = remoteStream;
        };

        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('Sending ICE candidate to:', data.from);
            socket.emit('webrtc-ice-candidate', { to: data.from, candidate: event.candidate });
          }
        };
      } catch (error) {
        console.error('Error getting media for answer:', error);
        alert('Error accessing camera/mic for call');
        return;
      }
    }

    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log('Sending WebRTC answer to:', data.from);
      socket.emit('webrtc-answer', { to: data.from, answer: answer });

      isCallActive = true;
      document.getElementById('startCallContainer').style.display = 'none';
      document.getElementById('endCall').style.display = 'inline-block';
      document.getElementById('videoCallContainer').style.display = 'block';
    } catch (error) {
      console.error('Error handling offer:', error);
      alert('Error processing call offer');
    }
  });

  socket.on('webrtc-answer', async (data) => {
    if (peerConnection && peerConnection.remoteDescription === null) {
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        console.log('WebRTC answer set successfully');
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    }
  });

  socket.on('webrtc-ice-candidate', async (data) => {
    if (peerConnection) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('ICE candidate added successfully');
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
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
    console.log('Typing event received:', data);
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
    console.log('Emitting typing:', true);
    socket.emit('typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      console.log('Emitting typing:', false);
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
    console.log('Socket disconnected');
    endCall();
    partnerId = null;
    document.getElementById('startCallContainer').style.display = 'none';
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