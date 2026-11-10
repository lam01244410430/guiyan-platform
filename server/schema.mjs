export const schema = `
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', city TEXT, age INTEGER, gender TEXT, channel TEXT, preference TEXT, verified INTEGER DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS resources(id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, city TEXT NOT NULL, price INTEGER NOT NULL, unit TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, capacity INTEGER DEFAULT 0, stock INTEGER DEFAULT 100, tags TEXT DEFAULT '[]', meta TEXT DEFAULT '{}', status TEXT DEFAULT 'published', owner_id INTEGER REFERENCES users(id), views INTEGER DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, user_id INTEGER REFERENCES users(id), resource_id INTEGER REFERENCES resources(id), quantity INTEGER NOT NULL, amount INTEGER NOT NULL, booking_date TEXT NOT NULL, status TEXT NOT NULL, channel TEXT NOT NULL, note TEXT DEFAULT '', escrow TEXT DEFAULT '未支付', refund_reason TEXT DEFAULT '', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS demands(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, category TEXT NOT NULL, budget INTEGER NOT NULL, city TEXT NOT NULL, description TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), resource_id INTEGER REFERENCES resources(id), rating INTEGER NOT NULL, content TEXT NOT NULL, reply TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), sender_id INTEGER REFERENCES users(id), title TEXT NOT NULL, content TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER REFERENCES users(id), resource_id INTEGER REFERENCES resources(id), PRIMARY KEY(user_id,resource_id));
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_order_resource_date ON orders(resource_id,booking_date,status);
    CREATE INDEX IF NOT EXISTS idx_order_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_resource ON comments(resource_id,status);
`;
