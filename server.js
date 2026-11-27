
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 6;
const rooms = new Map();

// เปิดเกมจาก index.html ที่อยู่ในโฟลเดอร์หลัก
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ online: true, rooms: rooms.size });
});

function createCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function cleanName(name) {
  return String(name || "Player")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 16) || "Player";
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;

  if (!room) return;

  room.players.delete(socket.id);

  io.to(code).emit("player:left", socket.id);

  if (room.players.size === 0) {
    rooms.delete(code);
  } else if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value;
    io.to(code).emit("room:host", room.hostId);
  }
}

io.on("connection", socket => {
  socket.data.roomCode = null;
  socket.data.lastMove = 0;
  socket.data.lastChat = 0;
  socket.data.lastCast = 0;
  socket.data.casting = false;

  socket.emit("server:ready", true);

  // สร้างห้อง
  socket.on("room:create", data => {
    leaveRoom(socket);

    const code = createCode();
    const player = {
      id: socket.id,
      name: cleanName(data?.name),
      x: 300,
      y: 300,
      direction: "down"
    };

    const room = {
      hostId: socket.id,
      players: new Map([[socket.id, player]])
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      hostId: room.hostId,
      players: [...room.players.values()]
    });
  });

  // เข้าร่วมห้อง
  socket.on("room:join", data => {
    leaveRoom(socket);

    const code = String(data?.code || "")
      .trim().toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      socket.emit("room:error", "ไม่พบห้องนี้");
      return;
    }

    if (room.players.size >= MAX_PLAYERS) {
      socket.emit("room:error", "ห้องเต็มแล้ว");
      return;
    }

    const player = {
      id: socket.id,
      name: cleanName(data?.name),
      x: 350,
      y: 300,
      direction: "down"
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.roomCode = code;

    socket.emit("room:joined", {
      code,
      hostId: room.hostId,
      players: [...room.players.values()]
    });

    socket.to(code).emit("player:joined", player);
  });

  // ซิงก์ตำแหน่ง
  socket.on("player:move", data => {
    const now = Date.now();
    if (now - socket.data.lastMove < 40) return;
    socket.data.lastMove = now;

    const room = rooms.get(socket.data.roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const x = Number(data?.x);
    const y = Number(data?.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    player.x = Math.max(0, Math.min(100000, x));
    player.y = Math.max(0, Math.min(100000, y));

    if (["up", "down", "left", "right"].includes(data?.direction)) {
      player.direction = data.direction;
    }

    socket.to(socket.data.roomCode).emit("player:moved", {
      id: socket.id,
      x: player.x,
      y: player.y,
      direction: player.direction
    });
  });

  // เริ่มตกปลา
  socket.on("fish:cast", () => {
    const code = socket.data.roomCode;
    if (!rooms.has(code) || socket.data.casting) return;
    if (Date.now() - socket.data.lastCast < 2000) return;

    socket.data.lastCast = Date.now();
    socket.data.casting = true;
    socket.data.castAt = Date.now();

    io.to(code).emit("fish:cast", {
      playerId: socket.id
    });
  });

  // ดึงปลา
  socket.on("fish:reel", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room || !socket.data.casting) return;
    if (Date.now() - socket.data.castAt < 1200) return;

    socket.data.casting = false;

    const fish = [
      { name: "Blue Fish", rarity: "Common", value: 10 },
      { name: "Golden Carp", rarity: "Rare", value: 150 },
      { name: "Crystal Fish", rarity: "Epic", value: 500 },
      { name: "Ocean Dragon", rarity: "Legendary", value: 2000 },
      { name: "Secret Leviathan", rarity: "Mythical", value: 10000 }
    ];

    const caught = fish[Math.floor(Math.random() * fish.length)];

    io.to(code).emit("fish:caught", {
      playerId: socket.id,
      playerName: room.players.get(socket.id)?.name,
      fish: caught
    });
  });

  // แชต
  socket.on("chat:send", message => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);

    if (!room || Date.now() - socket.data.lastChat < 800) return;
    socket.data.lastChat = Date.now();

    const text = String(message || "")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 120);

    if (!text) return;

    io.to(code).emit("chat:message", {
      id: socket.id,
      name: room.players.get(socket.id)?.name,
      text
    });
  });

  socket.on("room:leave", () => leaveRoom(socket));

  socket.on("disconnect", () => leaveRoom(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("PIXEL FISCH WORLD ONLINE");
  console.log("PORT:", PORT);
});
