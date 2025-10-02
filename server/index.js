const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 20000,
  cors: { origin: "https://shadowchat-3.onrender.com/" },
});

// In-memory store for used room IDs
const usedRoomIds = new Set();

// Serve frontend
app.use(express.static("public"));
// Serve uploads folder so files can be accessed publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.json());

// Create upload directories
const voiceDir = path.join(__dirname, "uploads/voice_notes");
const mediaDir = path.join(__dirname, "uploads/media");
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

// Multer config for voice
const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: voiceDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files allowed"), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Multer config for media
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ["image/", "video/", "application/pdf", "audio/"];
    if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error("Only images, videos, PDFs, and audio files allowed"), false);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for media
});

// Create Room - FORCE HTTPS for Render
app.post("/create-room", (req, res) => {
  const { roomId } = req.body;
  if (!roomId || typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,20}$/.test(roomId)) {
    return res.status(400).json({ error: "Invalid room ID" });
  }
  if (usedRoomIds.has(roomId)) return res.status(409).json({ error: "Room already exists" });

  usedRoomIds.add(roomId);
  const host = req.get("host");
  res.json({ link: `https://${host}/?room=${roomId}` });
});

// Fallback random room - HTTPS link
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  usedRoomIds.add(roomId);
  const host = req.get("host");
  res.json({ link: `https://${host}/?room=${roomId}` });
});

// Upload Voice Note
app.post("/upload-voice-note", voiceUpload.single("voiceNote"), (req, res) => {
  const { roomId, senderId } = req.body;
  if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });

  const filePath = `/uploads/voice_notes/${req.file.filename}`;
  const message = {
    type: "voice",
    fileUrl: filePath,
    sender: senderId,
    time: new Date().toLocaleTimeString(),
    id: randomUUID(),
  };

  io.to(roomId).emit("fileMessage", message);
  res.json({ success: true, filePath, id: message.id });
});

// Upload Media
app.post("/upload-media", mediaUpload.single("media"), (req, res) => {
  const { roomId, senderId } = req.body;
  if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });

  const filePath = `/uploads/media/${req.file.filename}`;
  let type;
  if (req.file.mimetype.startsWith("image/")) type = "image";
  else if (req.file.mimetype.startsWith("video/")) type = "video";
  else if (req.file.mimetype.startsWith("audio/")) type = "audio";
  else type = "file";

  const message = {
    type,
    fileUrl: filePath,
    sender: senderId,
    time: new Date().toLocaleTimeString(),
    id: randomUUID(),
  };

  io.to(roomId).emit("fileMessage", message);
  res.json({ success: true, filePath, id: message.id });
});

// Socket.io connection
io.on("connection", (socket) => {
  const roomId = socket.handshake.query.room;
  if (!roomId) {
    socket.emit("error", "Room ID required");
    socket.disconnect();
    return;
  }

  const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
  if (clients.size >= 2) {
    socket.emit("error", "Room is full");
    socket.disconnect();
    return;
  }

  socket.join(roomId);

  const updatedClients = io.sockets.adapter.rooms.get(roomId);
  if (updatedClients.size === 2) {
    const clientsArray = Array.from(updatedClients);
    const user1 = clientsArray[0];
    const user2 = clientsArray[1];
    // Emit partner ID to each client
    io.to(user1).emit('partnerId', user2);
    io.to(user2).emit('partnerId', user1);
    io.to(roomId).emit("paired");
  } else {
    socket.emit("waiting");
  }

  // Text messages
  socket.on("message", (msg) => {
    const message = {
      text: msg,
      sender: socket.id,
      time: new Date().toLocaleTimeString(),
      id: randomUUID(),
    };
    io.to(roomId).emit("message", message);
  });

  socket.on("seen", (messageId) => socket.to(roomId).emit("messageSeen", messageId));
  socket.on("typing", (isTyping) => socket.to(roomId).emit("typing", { user: socket.id, isTyping }));

  // Video/Audio Signaling
  socket.on("webrtc-offer", (data) => {
    socket.to(data.to).emit("webrtc-offer", { offer: data.offer, from: socket.id });
  });
  socket.on("webrtc-answer", (data) => {
    socket.to(data.to).emit("webrtc-answer", { answer: data.answer, from: socket.id });
  });
  socket.on("webrtc-ice-candidate", (data) => {
    socket.to(data.to).emit("webrtc-ice-candidate", { candidate: data.candidate, from: socket.id });
  });

  socket.on("disconnect", () => {
    socket.to(roomId).emit("partnerLeft");
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (!clients || clients.size === 0) usedRoomIds.delete(roomId);
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));