/*
  Fixed WebRTC + Socket signaling frontend for your chat app.
  Improvements included:
  - Implements "perfect negotiation" pattern to avoid glare (simultaneous-offer) issues
  - Uses onnegotiationneeded to create offers reliably
  - Handles ICE candidates robustly
  - Safer checks for local/remote tracks and media access
  - Better UI state updates and defensive logging

  IMPORTANT: server must support signaling events:
    - 'partnerId' (sends partner socket id)
    - 'paired'
    - 'waiting'
    - 'webrtc-offer' (payload { from, offer })
    - 'webrtc-answer' (payload { from, answer })
    - 'webrtc-ice-candidate' (payload { from, candidate })
    - the server should forward offers/answers/candidates between peers
*/

let socket;
let mediaRecorder;
let isRecording = false;
let currentRoomId;
let partnerId = null;

// WebRTC Variables
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let isCallActive = false;
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // TURN servers should be added here if needed
  ]
};

// Perfect negotiation flags
let isMakingOffer = false;
let isPolite = false; // determined after connection (tie-breaker)
let ignoreOffer = false;

// Dynamic Socket URL
const socketUrl = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://shadowchat-3.onrender.com/';

// ----------------- UI Helpers -----------------
function showStartCallButton(show) {
  document.getElementById('startCallContainer').style.display = show ? 'block' : 'none';
}

function showVideoContainer(show) {
  document.getElementById('videoCallContainer').style.display = show ? 'block' : 'none';
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

// ----------------- Room / Link logic (unchanged) -----------------
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

// ----------------- Media upload / voice note (unchanged) -----------------
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

// ----------------- WebRTC helpers -----------------
function createPeerConnection() {
  const pc = new RTCPeerConnection(configuration);

  pc.ontrack = (event) => {
    console.log('Received remote track');
    remoteStream = event.streams[0];
    const rv = document.getElementById('remoteVideo');
    if (rv) rv.srcObject = remoteStream;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && partnerId) {
      console.log('Sending ICE candidate to:', partnerId);
      socket.emit('webrtc-ice-candidate', { to: partnerId, candidate: event.candidate });
    }
  };

  // Perfect negotiation: create offers when needed
  pc.onnegotiationneeded = async () => {
    try {
      console.log('onnegotiationneeded fired');
      isMakingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (!partnerId) {
        console.warn('No partnerId set yet; negotiation aborted');
        return;
      }
      socket.emit('webrtc-offer', { to: partnerId, offer: pc.localDescription });
      console.log('Sent offer via socket');
    } catch (err) {
      console.error('Error during negotiationneeded:', err);
    } finally {
      isMakingOffer = false;
    }
  };

  return pc;
}

async function startLocalMedia() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const lv = document.getElementById('localVideo');
    if (lv) lv.srcObject = localStream;
    return localStream;
  } catch (error) {
    console.error('Error accessing local media:', error);
    throw error;
  }
}

// ----------------- Call Controls -----------------
async function startCall() {
  if (!partnerId) {
    console.error('Partner ID not set, cannot start call');
    alert('Partner not connected yet. Please wait for partner to join.');
    return;
  }

  try {
    await startLocalMedia();

    if (!peerConnection) {
      peerConnection = createPeerConnection();
    }

    // Add tracks if not already added
    localStream.getTracks().forEach(track => {
      // Avoid adding duplicate senders for same track
      const senders = peerConnection.getSenders().map(s => s.track).filter(Boolean);
      if (!senders.includes(track)) peerConnection.addTrack(track, localStream);
    });

    // UI updates
    isCallActive = true;
    showStartCallButton(false);
    document.getElementById('endCall').style.display = 'inline-block';
    showVideoContainer(true);

    console.log('Call started - waiting for negotiation to proceed (offer will be created automatically)');
  } catch (error) {
    console.error('Error starting call:', error);
    alert('Error starting video call. Please check camera/mic permissions.');
  }
}

function endCall() {
  console.log('Ending call');
  if (peerConnection) {
    try { peerConnection.close(); } catch (e) { console.warn(e); }
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  // Do not stop remote tracks; they are managed by the peer connection
  if (remoteStream) {
    remoteStream = null;
  }
  const lv = document.getElementById('localVideo'); if (lv) lv.srcObject = null;
  const rv = document.getElementById('remoteVideo'); if (rv) rv.srcObject = null;
  document.getElementById('endCall').style.display = 'none';
  document.getElementById('toggleAudio').textContent = '🔇 Mute Audio';
  document.getElementById('toggleVideo').textContent = '🎥 Stop Video';
  document.getElementById('toggleAudio').classList.remove('muted');
  document.getElementById('toggleVideo').classList.remove('muted');
  showVideoContainer(false);
  if (partnerId) showStartCallButton(true);
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

// ----------------- Signaling and Room join -----------------
function joinRoom(roomId) {
  currentRoomId = roomId;
  document.getElementById('landing').style.display = 'none';
  document.getElementById('chat').style.display = 'flex';

  socket = io(socketUrl, { query: { room: roomId } });

  socket.on('connect', () => {
    console.log('Socket connected:', socket.id);
    setStatus('Connected to signaling server. Waiting for partner...');
  });

  socket.on('error', (msg) => {
    console.error('Socket error:', msg);
    alert(msg);
    window.location.href = '/';
  });

  socket.on('waiting', () => {
    console.log('Waiting for partner...');
    setStatus('Waiting for partner...');
    showStartCallButton(false);
  });

  socket.on('partnerId', (id) => {
    console.log('Partner ID received:', id);
    partnerId = id;
    // Determine polite peer via socket id ordering (consistent tie-breaker)
    try {
      isPolite = socket.id > partnerId; // higher id is polite
    } catch (e) {
      console.warn('Could not compute polite flag yet');
    }
    setStatus('Partner found. Ready to chat/call.');
    showStartCallButton(true);
  });

  socket.on('paired', () => {
    console.log('Partner connected, ready to chat/call');
    setStatus('Connected! Start chatting or video call.');
  });

  socket.on('partnerLeft', () => {
    console.log('Partner disconnected');
    setStatus('Partner left.');
    endCall();
    partnerId = null;
    showStartCallButton(false);
  });

  // Offer from remote
  socket.on('webrtc-offer', async (data) => {
    console.log('Received WebRTC offer from:', data.from);

    // If we don't have pc yet, create one
    if (!peerConnection) {
      peerConnection = createPeerConnection();
    }

    const offer = new RTCSessionDescription(data.offer);

    const offerCollision = isMakingOffer || peerConnection.signalingState !== 'stable';
    const shouldIgnoreOffer = !isPolite && offerCollision;

    if (shouldIgnoreOffer) {
      console.warn('Offer collision detected and we are impolite -> ignoring offer');
      return;
    }

    try {
      await peerConnection.setRemoteDescription(offer);

      // Get local media and add tracks AFTER setting remote description
      await startLocalMedia();
      localStream.getTracks().forEach(track => {
        const senders = peerConnection.getSenders().map(s => s.track).filter(Boolean);
        if (!senders.includes(track)) peerConnection.addTrack(track, localStream);
      });

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('webrtc-answer', { to: data.from, answer: peerConnection.localDescription });

      // UI updates
      isCallActive = true;
      showStartCallButton(false);
      document.getElementById('endCall').style.display = 'inline-block';
      showVideoContainer(true);
    } catch (error) {
      console.error('Error handling offer:', error);
      alert('Error processing call offer');
    }
  });

  // Answer from remote
  socket.on('webrtc-answer', async (data) => {
    console.log('Received WebRTC answer from:', data.from);
    if (!peerConnection) return console.warn('No peerConnection when answer arrived');
    try {
      const answerDesc = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answerDesc);
      console.log('WebRTC answer applied');
    } catch (error) {
      console.error('Error setting remote description from answer:', error);
    }
  });

  // ICE candidate from remote
  socket.on('webrtc-ice-candidate', async (data) => {
    if (!peerConnection) return console.warn('No peerConnection to add ICE candidate');
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      console.log('ICE candidate added successfully');
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
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
    showStartCallButton(false);
  });
}

// ----------------- Message UI helpers (unchanged) -----------------
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