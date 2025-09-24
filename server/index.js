
// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");
// const { randomUUID } = require("crypto");
// const multer = require("multer");
// const fs = require("fs");
// const path = require("path");

// const PORT = process.env.PORT || 3000;

// const app = express();
// const httpServer = http.createServer(app);
// const io = new Server(httpServer, {
//   pingTimeout: 20000,
//   cors: { origin: "*" },
// });

// // In-memory store for used room IDs
// const usedRoomIds = new Set();

// // Serve frontend
// app.use(express.static("public"));
// // Serve uploads folder so files can be accessed publicly
// app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// app.use(express.json());

// // Create upload directories
// const voiceDir = path.join(__dirname, "uploads/voice_notes");
// const mediaDir = path.join(__dirname, "uploads/media");
// if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
// if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

// // Multer config for voice
// const voiceUpload = multer({
//   storage: multer.diskStorage({
//     destination: voiceDir,
//     filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
//   }),
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith("audio/")) cb(null, true);
//     else cb(new Error("Only audio files allowed"), false);
//   },
// });

// // Multer config for media
// const mediaUpload = multer({
//   storage: multer.diskStorage({
//     destination: mediaDir,
//     filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
//   }),
//   fileFilter: (req, file, cb) => {
//     const allowed = ["image/", "video/", "application/pdf"];
//     if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
//     else cb(new Error("Only images, videos, PDFs allowed"), false);
//   },
// });

// // Create Room
// app.post("/create-room", (req, res) => {
//   const { roomId } = req.body;
//   if (!roomId || typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,20}$/.test(roomId)) {
//     return res.status(400).json({ error: "Invalid room ID" });
//   }
//   if (usedRoomIds.has(roomId)) return res.status(409).json({ error: "Room already exists" });

//   usedRoomIds.add(roomId);
//   res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
// });

// // Fallback random room
// app.get("/create-room", (req, res) => {
//   const roomId = randomUUID();
//   usedRoomIds.add(roomId);
//   res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
// });

// // Upload Voice Note
// app.post("/upload-voice-note", voiceUpload.single("voiceNote"), (req, res) => {
//   const { roomId, senderId } = req.body;
//   if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });

//   const filePath = `/uploads/voice_notes/${req.file.filename}`;
//   const message = {
//     type: "voice",
//     fileUrl: filePath,
//     sender: senderId,
//     time: new Date().toLocaleTimeString(),
//     id: randomUUID(),
//   };

//   io.to(roomId).emit("fileMessage", message);
//   res.json({ success: true, filePath, id: message.id });
// });

// // Upload Media
// app.post("/upload-media", mediaUpload.single("media"), (req, res) => {
//   const { roomId, senderId } = req.body;
//   if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });

//   const filePath = `/uploads/media/${req.file.filename}`;
//   const type = req.file.mimetype.startsWith("image/") ? "image" :
//                req.file.mimetype.startsWith("video/") ? "video" : "file";

//   const message = {
//     type,
//     fileUrl: filePath,
//     sender: senderId,
//     time: new Date().toLocaleTimeString(),
//     id: randomUUID(),
//   };

//   io.to(roomId).emit("fileMessage", message);
//   res.json({ success: true, filePath, id: message.id });
// });

// // Socket.io connection
// io.on("connection", (socket) => {
//   const roomId = socket.handshake.query.room;
//   if (!roomId) {
//     socket.emit("error", "Room ID required");
//     socket.disconnect();
//     return;
//   }

//   const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
//   if (clients.size >= 2) {
//     socket.emit("error", "Room is full");
//     socket.disconnect();
//     return;
//   }

//   socket.join(roomId);

//   const updatedClients = io.sockets.adapter.rooms.get(roomId);
//   if (updatedClients.size === 2) io.to(roomId).emit("paired");
//   else socket.emit("waiting");

//   // Text messages
//   socket.on("message", (msg) => {
//     const message = {
//       text: msg,
//       sender: socket.id,
//       time: new Date().toLocaleTimeString(),
//       id: randomUUID(),
//     };
//     io.to(roomId).emit("message", message);
//   });

//   socket.on("seen", (messageId) => socket.to(roomId).emit("messageSeen", messageId));
//   socket.on("typing", (isTyping) => socket.to(roomId).emit("typing", { user: socket.id, isTyping }));

//   socket.on("disconnect", () => {
//     socket.to(roomId).emit("partnerLeft");
//     const clients = io.sockets.adapter.rooms.get(roomId);
//     if (!clients || clients.size === 0) usedRoomIds.delete(roomId);
//   });
// });

// httpServer.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
const express = require("express");
const http = require("http");  // Keep HTTP, Render handles HTTPS
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;  // Render sets PORT

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 20000,
  cors: { origin: "*" },  // Update to your Render domain in production
});

// In-memory store for used room IDs
const usedRoomIds = new Set();

// Serve frontend
app.use(express.static("public"));
// Serve uploads folder
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));  // Fixed: 'uploads' not 'Uploads'

app.use(express.json());

// Create upload directories
const voiceDir = path.join(__dirname, "uploads/voice_notes");
const mediaDir = path.join(__dirname, "uploads/media");
if (!fs.existsSync(voiceDir)) fs.mkdirSync(voiceDir, { recursive: true });
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

// Multer config for voice (original)
const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: voiceDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) cb(null, true);
    else cb(new Error("Only audio files allowed"), false);
  },
});

// Multer config for media (original)
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: mediaDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  fileFilter: (req, file, cb) => {
    const allowed = ["image/", "video/", "application/pdf"];
    if (allowed.some(t => file.mimetype.startsWith(t))) cb(null, true);
    else cb(new Error("Only images, videos, PDFs allowed"), false);
  },
});

// Create Room - FORCE HTTPS for Render
app.post("/create-room", (req, res) => {
  const { roomId } = req.body;
  if (!roomId || typeof roomId !== "string" || !/^[a-zA-Z0-9_-]{3,20}$/.test(roomId)) {
    return res.status(400).json({ error: "Invalid room ID" });
  }
  if (usedRoomIds.has(roomId)) return res.status(409).json({ error: "Room already exists" });

  usedRoomIds.add(roomId);
  // FORCE HTTPS - Render will handle it
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

// Upload Voice Note (original logic)
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

// Upload Media (original logic)
app.post("/upload-media", mediaUpload.single("media"), (req, res) => {
  const { roomId, senderId } = req.body;
  if (!roomId || !senderId) return res.status(400).json({ error: "Room ID and sender required" });

  const filePath = `/uploads/media/${req.file.filename}`;
  const type = req.file.mimetype.startsWith("image/") ? "image" :
               req.file.mimetype.startsWith("video/") ? "video" : "file";

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

// Socket.io connection (original logic)
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
  if (updatedClients.size === 2) io.to(roomId).emit("paired");
  else socket.emit("waiting");

  // Text messages (plain text, original)
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

  socket.on("disconnect", () => {
    socket.to(roomId).emit("partnerLeft");
    const clients = io.sockets.adapter.rooms.get(roomId);
    if (!clients || clients.size === 0) usedRoomIds.delete(roomId);
  });
});

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));