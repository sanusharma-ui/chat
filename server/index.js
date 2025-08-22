const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

const PORT = process.env.PORT || 3000;

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  pingTimeout: 20000,
  cors: { origin: "*" },
});

// Serve frontend (public folder)
app.use(express.static("public"));

// API endpoint to create new chat room
app.get("/create-room", (req, res) => {
  const roomId = randomUUID();
  res.json({ link: `${req.protocol}://${req.get("host")}/?room=${roomId}` });
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
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});