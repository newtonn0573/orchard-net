const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const JWT_SECRET = process.env.JWT_SECRET || 'orchard-net-super-secret';
const PORT = Number(process.env.PORT) || 3000;

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const db = new sqlite3.Database(path.join(__dirname, 'orchard-net.db'));

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname) || '.png';
    const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image uploads are allowed.'));
  }
});

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.replace('Bearer ', '').trim()
    : req.cookies?.token || req.query.token || null;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function pageAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.replace('Bearer ', '').trim()
    : req.cookies?.token || req.query.token || null;

  if (!token) {
    return res.redirect('/');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.redirect('/');
  }
}

function userPayload(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    full_name: user.full_name,
    bio: user.bio,
    avatar: user.avatar,
    created_at: user.created_at
  };
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function makeChatRoom(userIdA, userIdB) {
  return [userIdA, userIdB].sort((a, b) => Number(a) - Number(b)).join(':');
}

function sendJsonError(res, status, message) {
  return res.status(status).json({ error: message });
}

function initializeDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        bio TEXT DEFAULT '',
        avatar TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER,
        content TEXT,
        image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(recipient_id) REFERENCES users(id)
      )
    `);
  });
}

initializeDatabase();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Orchard Net' });
});

app.post('/api/signup', async (req, res) => {
  const { username, email, password, full_name } = req.body;

  if (!username || !email || !password) {
    return sendJsonError(res, 400, 'Username, email, and password are required.');
  }

  if (String(password).length < 8) {
    return sendJsonError(res, 400, 'Password must be at least 8 characters long.');
  }

  const cleanUsername = String(username).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, email, password_hash, full_name, bio) VALUES (?, ?, ?, ?, ?)`,
    [cleanUsername, cleanEmail, passwordHash, full_name || cleanUsername, ''],
    function onInsert(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return sendJsonError(res, 409, 'That username or email already exists.');
        }
        return sendJsonError(res, 500, 'Unable to create the account.');
      }

      db.get('SELECT * FROM users WHERE id = ?', [this.lastID], (rowErr, user) => {
        if (rowErr || !user) {
          return sendJsonError(res, 500, 'Failed to load user after sign up.');
        }

        const token = createToken(user);
        return res.json({ token, user: userPayload(user) });
      });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return sendJsonError(res, 400, 'Username and password are required.');
  }

  db.get(
    `SELECT * FROM users WHERE username = ? OR email = ?`,
    [String(username).trim(), String(username).trim().toLowerCase()],
    async (err, user) => {
      if (err || !user) {
        return sendJsonError(res, 401, 'Invalid login credentials.');
      }

      const isValid = await bcrypt.compare(String(password), user.password_hash);
      if (!isValid) {
        return sendJsonError(res, 401, 'Invalid login credentials.');
      }

      const token = createToken(user);
      return res.json({ token, user: userPayload(user) });
    }
  );
});

app.get('/api/me', authMiddleware, (req, res) => {
  db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) {
      return sendJsonError(res, 404, 'User not found.');
    }
    res.json({ user: userPayload(user) });
  });
});

app.get('/api/users', authMiddleware, (_req, res) => {
  db.all(
    'SELECT id, username, email, full_name, bio, avatar, created_at FROM users ORDER BY username ASC',
    [],
    (err, rows) => {
      if (err) {
        return sendJsonError(res, 500, 'Unable to load users.');
      }
      res.json({ users: rows });
    }
  );
});

app.get('/api/profile/:username', (req, res) => {
  const { username } = req.params;

  db.get(
    'SELECT id, username, email, full_name, bio, avatar, created_at FROM users WHERE username = ?',
    [String(username).trim()],
    (err, user) => {
      if (err || !user) {
        return sendJsonError(res, 404, 'User profile not found.');
      }
      return res.json({ user });
    }
  );
});

app.put('/api/profile', authMiddleware, (req, res) => {
  const { full_name, bio, avatar } = req.body;

  if (!full_name && !bio && !avatar) {
    return sendJsonError(res, 400, 'No profile changes supplied.');
  }

  const values = [];
  const updates = [];

  if (typeof full_name === 'string') {
    updates.push('full_name = ?');
    values.push(full_name.trim());
  }

  if (typeof bio === 'string') {
    updates.push('bio = ?');
    values.push(bio.trim());
  }

  if (typeof avatar === 'string') {
    updates.push('avatar = ?');
    values.push(avatar);
  }

  values.push(req.user.id);

  db.run(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    values,
    function onUpdate(err) {
      if (err) {
        return sendJsonError(res, 500, 'Failed to update profile.');
      }

      db.get('SELECT * FROM users WHERE id = ?', [req.user.id], (userErr, user) => {
        if (userErr || !user) {
          return sendJsonError(res, 500, 'User could not be reloaded.');
        }
        return res.json({ user: userPayload(user) });
      });
    }
  );
});

app.post('/api/upload', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return sendJsonError(res, 400, 'No image uploaded.');
  }

  const imageUrl = `/uploads/${req.file.filename}`;

  db.run('UPDATE users SET avatar = ? WHERE id = ?', [imageUrl, req.user.id], (err) => {
    if (err) {
      return sendJsonError(res, 500, 'Upload failed.');
    }

    return res.json({ url: imageUrl });
  });
});

app.post('/api/media', authMiddleware, upload.single('photo'), (req, res) => {
  if (!req.file) {
    return sendJsonError(res, 400, 'No image uploaded.');
  }

  return res.json({ url: `/uploads/${req.file.filename}` });
});

app.get('/api/messages', authMiddleware, (req, res) => {
  const recipientId = req.query.recipient_id ? Number(req.query.recipient_id) : null;

  let query = `
    SELECT m.id, m.sender_id, m.recipient_id, m.content, m.image_url, m.created_at,
           u.username AS sender_username,
           u.full_name AS sender_name,
           r.username AS recipient_username
    FROM messages m
    INNER JOIN users u ON u.id = m.sender_id
    LEFT JOIN users r ON r.id = m.recipient_id
  `;

  const params = [];

  if (recipientId) {
    query += ` WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`;
    params.push(req.user.id, recipientId, recipientId, req.user.id);
  } else {
    query += ' WHERE m.recipient_id IS NULL';
  }

  query += ' ORDER BY m.created_at ASC LIMIT 200';

  db.all(query, params, (err, rows) => {
    if (err) {
      return sendJsonError(res, 500, 'Unable to load message history.');
    }
    res.json({ messages: rows });
  });
});

app.post('/api/messages', authMiddleware, (req, res) => {
  const { content = '', recipient_id, image_url } = req.body || {};
  const cleanContent = String(content || '').trim();

  if (!cleanContent && !image_url) {
    return sendJsonError(res, 400, 'Message content or photo is required.');
  }

  const recipientId = recipient_id ? Number(recipient_id) : null;
  const message = {
    sender_id: req.user.id,
    recipient_id: recipientId,
    content: cleanContent || null,
    image_url: image_url || null,
    created_at: new Date().toISOString()
  };

  db.run(
    `INSERT INTO messages (sender_id, recipient_id, content, image_url, created_at) VALUES (?, ?, ?, ?, ?)`,
    [message.sender_id, message.recipient_id, message.content, message.image_url, message.created_at],
    function onInsert(err) {
      if (err) {
        return sendJsonError(res, 500, 'Message could not be saved.');
      }

      const payload = {
        id: this.lastID,
        ...message,
        sender_username: req.user.username,
        sender_name: req.user.username,
        recipient_username: recipientId ? null : null
      };

      if (recipientId) {
        const roomName = makeChatRoom(req.user.id, recipientId);
        io.to(roomName).emit('new_message', payload);
        io.to(`user:${recipientId}`).emit('new_message', payload);
      } else {
        io.emit('new_message', payload);
      }

      return res.status(201).json({ message: payload });
    }
  );
});

app.get('/app', pageAuthMiddleware, (_req, res) => {
  res.sendFile(path.join(publicDir, 'app.html'));
});

app.get('/profile', pageAuthMiddleware, (_req, res) => {
  res.sendFile(path.join(publicDir, 'profile.html'));
});

app.get('/profile/:username', (_req, res) => {
  res.sendFile(path.join(publicDir, 'profile.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.' });
  }

  if (req.path === '/app' || req.path === '/profile') {
    return res.redirect('/');
  }

  res.sendFile(path.join(publicDir, 'index.html'));
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization || null;

  if (!token) {
    return next(new Error('Authentication required for socket connection.'));
  }

  try {
    const cleanToken = String(token).replace(/^Bearer\s+/i, '');
    const decoded = jwt.verify(cleanToken, JWT_SECRET);
    socket.user = decoded;
    return next();
  } catch (error) {
    return next(new Error('Invalid socket token.'));
  }
});

io.on('connection', (socket) => {
  const { user } = socket;

  if (!user) {
    return;
  }

  socket.join(`user:${user.id}`);

  socket.on('join_room', (roomName) => {
    if (roomName) {
      socket.join(roomName);
    }
  });

  socket.on('send_message', async (payload) => {
    const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
    const imageUrl = payload?.image_url || null;
    const recipientId = payload?.recipient_id ? Number(payload.recipient_id) : null;

    if (!content && !imageUrl) {
      return;
    }

    const message = {
      sender_id: user.id,
      recipient_id: recipientId,
      content: content || null,
      image_url: imageUrl,
      created_at: new Date().toISOString(),
      sender_username: user.username,
      sender_name: user.username
    };

    db.run(
      `INSERT INTO messages (sender_id, recipient_id, content, image_url, created_at) VALUES (?, ?, ?, ?, ?)`,
      [message.sender_id, message.recipient_id, message.content, message.image_url, message.created_at],
      function onMessageInsert(err) {
        if (err) {
          return;
        }

        const payloadMessage = { ...message, id: this.lastID };

        if (recipientId) {
          const room = makeChatRoom(user.id, recipientId);
          io.to(room).emit('new_message', payloadMessage);
          io.to(`user:${recipientId}`).emit('new_message', payloadMessage);
          return;
        }

        io.emit('new_message', payloadMessage);
      }
    );
  });
});

async function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const instance = server.listen(port, () => {
      resolve(instance);
    });

    instance.on('error', reject);
  });
}

function stopServer(instance) {
  return new Promise((resolve, reject) => {
    if (!instance) {
      resolve();
      return;
    }

    instance.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

if (require.main === module) {
  startServer(PORT)
    .then(() => {
      console.log(`Orchard Net is running on http://localhost:${PORT}`);
    })
    .catch((error) => {
      console.error('Failed to start the server:', error);
      process.exit(1);
    });
}

module.exports = { app, startServer, stopServer };
