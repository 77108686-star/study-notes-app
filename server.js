const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración de Socket.io con espacio para archivos/imágenes grandes (hasta 10MB)
const io = new Server(server, {
  maxHttpBufferSize: 1e7
});

app.use(express.static(path.join(__dirname, 'public')));

// Almacenamiento en memoria
const users = {};     // { username: { username, password, profilePic, friends: [] } }
const statuses = [];  // [{ id, username, content, type, time }]

io.on('connection', (socket) => {
  let currentUser = null;

  // --- REGISTRO DE USUARIOS ---
  socket.on('register', async ({ username, password, initialFriends }, callback) => {
    const cleanUsername = username ? username.trim().toLowerCase() : '';
    if (!cleanUsername || !password) {
      return callback({ success: false, message: 'Por favor completa usuario y contraseña.' });
    }
    if (users[cleanUsername]) {
      return callback({ success: false, message: 'El nombre de usuario ya está ocupado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const addedFriends = [];

    // Agregar amigos ingresados en el registro (separados por comas)
    if (initialFriends && typeof initialFriends === 'string') {
      const friendList = initialFriends.split(',').map(f => f.trim().toLowerCase());
      
      friendList.forEach(friendName => {
        if (users[friendName] && friendName !== cleanUsername && !addedFriends.includes(friendName)) {
          addedFriends.push(friendName);
          users[friendName].friends.push(cleanUsername); // Vínculo mutuo
          
          // Notificar al amigo si está conectado
          io.to(friendName).emit('friend_added', cleanUsername);
        }
      });
    }

    // Crear cuenta
    users[cleanUsername] = {
      username: cleanUsername,
      password: hashedPassword,
      profilePic: 'https://via.placeholder.com/150/075e54/ffffff?text=User',
      friends: addedFriends
    };

    const msgExtra = addedFriends.length > 0 
      ? ` y se vincularon ${addedFriends.length} amigo(s).` 
      : '.';

    callback({ success: true, message: `¡Cuenta creada con éxito${msgExtra}` });
  });

  // --- INICIO DE SESIÓN ---
  socket.on('login', async ({ username, password }, callback) => {
    const cleanUsername = username ? username.trim().toLowerCase() : '';
    const user = users[cleanUsername];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return callback({ success: false, message: 'Usuario o contraseña incorrectos.' });
    }

    currentUser = cleanUsername;
    socket.join(currentUser); // Unirse a su sala personal

    callback({
      success: true,
      userData: {
        username: user.username,
        profilePic: user.profilePic,
        friends: user.friends
      }
    });
  });

  // --- ACTUALIZAR FOTO DE PERFIL ---
  socket.on('update_profile_pic', (base64Image) => {
    if (!currentUser) return;
    users[currentUser].profilePic = base64Image;
    io.emit('user_updated', { username: currentUser, profilePic: base64Image });
  });

  // --- AGREGAR AMIGO DESDE EL CHAT ---
  socket.on('add_friend', (targetUsername, callback) => {
    if (!currentUser) return;
    const cleanTarget = targetUsername.trim().toLowerCase();

    if (!users[cleanTarget]) {
      return callback({ success: false, message: 'El usuario no existe.' });
    }
    if (cleanTarget === currentUser) {
      return callback({ success: false, message: 'No te puedes agregar a ti mismo.' });
    }
    if (users[currentUser].friends.includes(cleanTarget)) {
      return callback({ success: false, message: 'Ya está en tu lista de amigos.' });
    }

    users[currentUser].friends.push(cleanTarget);
    users[cleanTarget].friends.push(currentUser);

    io.to(cleanTarget).emit('friend_added', currentUser);
    callback({ success: true, friend: cleanTarget });
  });

  // --- ENVIAR MENSAJES (Texto, Imagen, Sticker) ---
  socket.on('send_message', ({ to, content, type }) => {
    if (!currentUser) return;
    const payload = {
      from: currentUser,
      to,
      content,
      type, // 'text', 'image', 'sticker'
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.to(to).emit('receive_message', payload);
    socket.emit('receive_message', payload);
  });

  // --- PUBLICAR Y OBTENER ESTADOS ---
  socket.on('post_status', (statusData) => {
    if (!currentUser) return;
    const statusObj = {
      id: Date.now(),
      username: currentUser,
      content: statusData.content,
      type: statusData.type,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    statuses.unshift(statusObj);
    io.emit('new_status', statusObj);
  });

  socket.on('get_statuses', (callback) => {
    callback(statuses);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});
