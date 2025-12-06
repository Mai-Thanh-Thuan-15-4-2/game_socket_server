const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "https://game-socket-7fls.vercel.app"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['polling', 'websocket'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 3001;

// Game state
const rooms = new Map();

class GameRoom {
  constructor(roomId, roomName, hostName) {
    this.roomId = roomId;
    this.roomName = roomName;
    this.hostName = hostName;
    this.players = new Map();
    this.gameState = {
      balloons: [],
      car: null,
      currentTurn: 0,
      isPlaying: false
    };
    this.createdAt = Date.now();
  }

  addPlayer(socketId, username) {
    this.players.set(socketId, {
      id: socketId,
      username: username
    });
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  updateGameState(gameState) {
    this.gameState = gameState;
  }

  getGameState() {
    return {
      ...this.gameState,
      players: Array.from(this.players.values())
    };
  }
  
  getRoomInfo() {
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      hostName: this.hostName,
      playerCount: this.players.size,
      isPlaying: this.gameState.isPlaying,
      createdAt: this.createdAt
    };
  }
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Gửi danh sách phòng khi client kết nối
  socket.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));

  // Tạo phòng mới
  socket.on('createRoom', ({ roomName, hostName }) => {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`${hostName} creating room ${roomName} (${roomId})`);
    
    const room = new GameRoom(roomId, roomName, hostName);
    rooms.set(roomId, room);
    
    // Thêm host vào phòng
    room.addPlayer(socket.id, hostName);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.isHost = true;

    // Gửi thông tin phòng cho host
    socket.emit('roomCreated', {
      roomId: roomId,
      roomInfo: room.getRoomInfo()
    });

    // Broadcast danh sách phòng mới cho tất cả
    io.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));
  });

  // Tham gia phòng
  socket.on('joinRoom', ({ username, roomId }) => {
    console.log(`${username} joining room ${roomId}`);
    
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Phòng không tồn tại' });
      return;
    }

    room.addPlayer(socket.id, username);
    socket.join(roomId);
    socket.roomId = roomId;

    // Gửi trạng thái game hiện tại
    socket.emit('joinedRoom', {
      roomInfo: room.getRoomInfo(),
      gameState: room.getGameState()
    });

    // Thông báo cho các player khác
    socket.to(roomId).emit('playerJoined', {
      player: { id: socket.id, username: username }
    });

    // Cập nhật danh sách phòng
    io.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));
  });

  // Cập nhật trạng thái game (chỉ host)
  socket.on('updateGameState', (gameState) => {
    if (!socket.roomId || !socket.isHost) return;
    
    const room = rooms.get(socket.roomId);
    if (!room) return;

    room.updateGameState(gameState);

    // Broadcast cho tất cả trong phòng (kể cả người xem)
    io.to(socket.roomId).emit('gameStateUpdated', room.getGameState());
    
    // Cập nhật danh sách phòng (trạng thái isPlaying)
    io.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));
  });

  // Yêu cầu danh sách phòng
  socket.on('getRoomList', () => {
    socket.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        room.removePlayer(socket.id);
        
        // Thông báo cho các player khác
        socket.to(socket.roomId).emit('playerLeft', {
          playerId: socket.id
        });

        // Nếu host rời đi hoặc không còn ai, xóa phòng
        if (socket.isHost || room.players.size === 0) {
          rooms.delete(socket.roomId);
          io.emit('roomClosed', { roomId: socket.roomId });
        }
        
        // Cập nhật danh sách phòng
        io.emit('roomList', Array.from(rooms.values()).map(room => room.getRoomInfo()));
      }
    }
  });
});

// API để kiểm tra server
app.get('/', (req, res) => {
  res.json({ 
    message: 'Balloon Car Game Server is running',
    activeRooms: rooms.size,
    totalPlayers: Array.from(rooms.values()).reduce((sum, room) => sum + room.players.size, 0),
    rooms: Array.from(rooms.values()).map(room => room.getRoomInfo())
  });
});

// Health check endpoint for Vercel
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export for Vercel serverless
module.exports = app;

// Local development
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
