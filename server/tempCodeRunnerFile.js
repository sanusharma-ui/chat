
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
  cors: { origin: "*" },
});

// In-memory store for used room IDs (replace with DB for production)
const usedRoomIds = new Set();

// Serve frontend (public folder)
app.use(express.static("public"));

// Parse JSON bodies for POST requests
app.use(express.json());

// Configure Multer for voice notes
const voiceStorage = multer.diskStorage({
  destination: "./uploads/voice_notes",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const voiceUpload = multer({
  storage: voiceStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed"), false);
    }
  },
});

// Configure Multer for media files
const mediaStorage = multer.diskStorage({
  destination: "./uploads/media",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const mediaUpload = multer({
  storage: mediaStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/", "video/", "application/pdf"];
    if (allowedTypes.some((type) => file.mimetype.startsWith(type))) {
      cb(null, true);
    } else {
      cb(new Error("Only images, videos, and PDFs are allowed"), false);
    }
  },
});

// Create upload directories
const voiceDir = path.join(__dirname, "uploads/voice_notes");
const mediaDir = path.join(__dirname, "uploads/media");
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

// API endpoint to create new chat room with custom ID
app.post("/create-room", (req, res) => {
  const { roomId } = req.body;

  // Validate room ID
  if (!roomId || typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,20}$/.test(roomId)) {
    return res.status(400).json({ error: "Room ID must be 3-20 characters long, alphanumeric with hyphens or underscores." });
  }

  // Check if room ID is already taken
  if (usedRoomIds.has(roomId)) {
    return res.status(409).json({ error: "Room ID already exists. Choose another." });
  }

  // Reserve the room ID
  usedRoomIds.add(roomId);
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
});

// Fallback: Create random room ID
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  usedRoomIds.add(roomId);
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
});

// Voice note upload endpoint
app.post("/upload-voice-note", voiceUpload.single("voiceNote"), (req, res) => {
  const { roomId, senderId } = req.body;
  if (!roomId || !senderId) {
    return res.status(400).json({ error: "Room ID and sender ID are required" });
  }

  const filePath = `/uploads/voice_notes/${req.file.filename}`;
  const message = {
    type: "voice",
    filePath,
    sender: senderId,
    time: new Date().toLocaleTimeString(),
    id: randomUUID(),
  };

  // Emit voice note to room
  io.to(roomId).emit("message", message);
  res.json({ success: true, filePath });
});

// Media upload endpoint
app.post("/upload-media", mediaUpload.single("media"), (req, res) => {
  const { roomId, senderId } = req.body;
  if (!roomId || !senderId) {
    return res.status(400).json({ error: "Room ID and sender ID are required" });
  }

  const filePath = `/uploads/media/${req.file.filename}`;
  const message = {
    type: req.file.mimetype.startsWith("image/") ? "image" : req.file.mimetype.startsWith("video/") ? "video" : "document",
    filePath,
    sender: senderId,
    time: new Date().toLocaleTimeString(),
    id: randomUUID(),
  };

  // Emit media to room
  io.to(roomId).emit("message", message);
  res.json({ success: true, filePath });
});

// Socket connection
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id}`);
  const roomId = socket.handshake.query.room;

  if (!roomId) {
    socket.emit("error", "❌ Room ID required to join chat.");
    socket.disconnect();
    return;
  }

  // Check room capacity before joining
  const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
  if (clients.size >= 2) {
    socket.emit("error", "❌ Room is full.");
    socket.disconnect();
    return;
  }

  // Join room
  socket.join(roomId);
  console.log(`🏠 User joined room: ${roomId}`);

  // Notify participants
  const updatedClients = io.sockets.adapter.rooms.get(roomId);
  if (updatedClients.size === 2) {
    io.to(roomId).emit("paired");
  } else {
    socket.emit("waiting");
  }

  // Handle message
  socket.on("message", (msg) => {
    const message = {
      text: msg,
      sender: socket.id,
      time: new Date().toLocaleTimeString(),
      id: randomUUID(),
    };
    io.to(roomId).emit("message", message);
  });

  // Seen handler
  socket.on("seen", (messageId) => {
    socket.to(roomId).emit("messageSeen", messageId);
  });

  // Typing indicator
  socket.on("typing", (isTyping) => {
    socket.to(roomId).emit("typing", { user: socket.id, isTyping });
  });

  // Disconnect
  socket.on("disconnect", () => {
    socket.to(roomId).emit("partnerLeft");
    console.log(`❌ User left: ${socket.id}`);
    // Remove roomId from usedRoomIds if room is empty
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (!clients || clients.size === 0) {
      usedRoomIds.delete(roomId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});