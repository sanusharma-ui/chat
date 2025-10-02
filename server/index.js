// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://shadowchat-3.onrender.com"; // set in env for prod

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  pingTimeout: 20000,
  cors: {
    origin: (origin, callback) => {
      // Allow if origin matches env or is undefined (like direct curl/dev)
      if (!origin || origin === ALLOWED_ORIGIN || origin.includes("localhost")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  // transports: ["websocket", "polling"], // optional, fallback order
});

// Simple in-memory store for used room IDs (good enough for small demo)
const usedRoomIds = new Set();

// Serve frontend + uploaded files
app.use(express.static("public"));
app.use("/uploads", express.static(path.join(__dirname, "Uploads")));

app.use(express.json());

// Ensure upload directories exist
const voiceDir = path.join(__dirname, "Uploads", "voice_notes");
const mediaDir = path.join(__dirname, "Uploads", "media");
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

// Multer config (disk storage)
const voiceStorage = multer.diskStorage({
  destination: voiceDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});
const mediaStorage = multer.diskStorage({
  destination: mediaDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});

const voiceUpload = multer({
  storage: voiceStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files allowed"), false);
  },
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB limit as example
});

const mediaUpload = multer({
  storage: mediaStorage,
  fileFilter: (req, file, cb) => {
    const allowedPrefixes = ["image/", "video/", "application/pdf"];
    if (allowedPrefixes.some(t => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error("Only images, videos, PDFs allowed"), false);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB example
});

// Helper to build absolute file URL (works behind proxy if X-Forwarded-Host is set)
function buildFileUrl(req, relativePath) {
  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol;
  return `${proto}://${host}${relativePath}`;
}

// ---- Room creation endpoints ----
// POST create custom room
app.post("/create-room", (req, res) => {
  const { roomId } = req.body;
  if (!roomId || typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(roomId)) {
    return res.status(400).json({ error: "Invalid room ID (3-64 chars, letters/numbers/_/- allowed)" });
  }
  if (usedRoomIds.has(roomId)) return res.status(409).json({ error: "Room already exists" });

  usedRoomIds.add(roomId);
  const host = req.get("host");
  // We return URL using proto detection; however frontend also supports non-HTTPS hosts
  res.json({ link: `https://${host}/?room=${encodeURIComponent(roomId)}` });
});

// GET create random room
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  usedRoomIds.add(roomId);
  const host = req.get("host");
  res.json({ link: `https://${host}/?room=${roomId}` });
});

// ---- Upload endpoints ----
app.post("/upload-voice-note", voiceUpload.single("voiceNote"), (req, res) => {
  try {
    const { roomId, senderId } = req.body;
    if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });
    if (!req.file) return res.status(400).json({ error: "No voice file uploaded" });

    // Build URL that the client can use to play/download
    const relative = `/uploads/voice_notes/${req.file.filename}`;
    const fileUrl = buildFileUrl(req, relative);

    const message = {
      type: "voice",
      fileUrl,
      sender: senderId,
      time: new Date().toLocaleTimeString(),
      id: randomUUID(),
    };

    // Emit to room; clients should be joined with socket.join(roomId)
    io.to(roomId).emit("fileMessage", message);
    res.json({ success: true, filePath: relative, id: message.id });
  } catch (err) {
    console.error("Upload voice error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/upload-media", mediaUpload.single("media"), (req, res) => {
  try {
    const { roomId, senderId } = req.body;
    if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });
    if (!req.file) return res.status(400).json({ error: "No media file uploaded" });

    const relative = `/uploads/media/${req.file.filename}`;
    const fileUrl = buildFileUrl(req, relative);

    const type = req.file.mimetype.startsWith("image/") ? "image" :
                 req.file.mimetype.startsWith("video/") ? "video" : "file";

    const message = {
      type,
      fileUrl,
      sender: senderId,
      time: new Date().toLocaleTimeString(),
      id: randomUUID(),
    };

    io.to(roomId).emit("fileMessage", message);
    res.json({ success: true, filePath: relative, id: message.id });
  } catch (err) {
    console.error("Upload media error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Socket.io signaling ----
io.on("connection", (socket) => {
  const roomId = socket.handshake.query.room;
  if (!roomId) {
    socket.emit("error", "Room ID required");
    socket.disconnect(true);
    return;
  }

  // Limit clients to 2 per room
  const room = io.sockets.adapter.rooms.get(roomId) || new Set();
  if (room.size >= 2) {
    socket.emit("error", "Room is full");
    socket.disconnect(true);
    return;
  }

  socket.join(roomId);

  // Re-evaluate clients after join
  const updatedClients = io.sockets.adapter.rooms.get(roomId) || new Set();

  // If two clients: send each other's socket id
  if (updatedClients.size === 2) {
    const clientsArray = Array.from(updatedClients);
    // sort stable so both peers can compute polite flag consistently if needed
    clientsArray.sort();
    const user1 = clientsArray[0];
    const user2 = clientsArray[1];

    io.to(user1).emit("partnerId", user2);
    io.to(user2).emit("partnerId", user1);
    io.to(roomId).emit("paired");
  } else {
    socket.emit("waiting");
  }

  // Text message
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

  // Signaling: forward to target
  socket.on("webrtc-offer", (data) => {
    if (!data || !data.to) return;
    socket.to(data.to).emit("webrtc-offer", { offer: data.offer, from: socket.id });
  });
  socket.on("webrtc-answer", (data) => {
    if (!data || !data.to) return;
    socket.to(data.to).emit("webrtc-answer", { answer: data.answer, from: socket.id });
  });
  socket.on("webrtc-ice-candidate", (data) => {
    if (!data || !data.to) return;
    socket.to(data.to).emit("webrtc-ice-candidate", { candidate: data.candidate, from: socket.id });
  });

  socket.on("disconnect", () => {
    // Notify other peer(s)
    socket.to(roomId).emit("partnerLeft");

    // Clean up usedRoomIds only if no clients left
    const clientsAfter = io.sockets.adapter.rooms.get(roomId);
    if (!clientsAfter || clientsAfter.size === 0) {
      usedRoomIds.delete(roomId);
    }
  });
});

// Global error handlers for multer (so express returns JSON errors)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("Multer error:", err);
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
  next();
});

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
