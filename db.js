const Database = require('better-sqlite3');
const path = require('path');

// Create or connect to local SQLite database
const dbPath = path.join(__dirname, 'auth.db');
const db = new Database(dbPath);

console.log('Connected to local SQLite database:', dbPath);

// Initialize database tables
function initDatabase() {
  try {
    // Create users table
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Users table ready');
    
    // Create profiles table
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        username TEXT PRIMARY KEY NOT NULL,
        real_name TEXT,
        farm_size REAL,
        country TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Profiles table ready');

    // Create pest trap images table
    db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        area_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        dark_pixel_ratio REAL,
        estimated_pest_count INTEGER,
        pest_amount TEXT,
        analysis_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    console.log('Images table ready');

    // Create forecasts table
    db.exec(`
      CREATE TABLE IF NOT EXISTS forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        area_id TEXT NOT NULL,
        horizon_minutes INTEGER NOT NULL,
        risk_score REAL NOT NULL,
        risk_level TEXT NOT NULL,
        details_json TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    console.log('Forecasts table ready');

    // Create microclimate data table
db.exec(`
CREATE TABLE IF NOT EXISTS microclimate_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  area_id TEXT NOT NULL,
  air_temperature REAL NOT NULL,
  soil_temperature REAL NOT NULL,
  soil_moisture REAL NOT NULL,
  relative_humidity REAL NOT NULL,
  heat_stress_level TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
`);

// Social feed posts table
db.exec(`
CREATE TABLE IF NOT EXISTS social_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  real_name TEXT,
  area_id TEXT NOT NULL,
  post_type TEXT NOT NULL,
  forecast_level TEXT NOT NULL,
  forecast_description TEXT NOT NULL,
  snapshot_data TEXT NOT NULL,
  post_text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
`);

// Comments table
db.exec(`
CREATE TABLE IF NOT EXISTS social_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  username TEXT NOT NULL,
  real_name TEXT,
  comment_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
`);

    console.log('Microclimate data table ready');
    console.log('Social posts table ready');
    console.log('Social comments table ready');

    // Verify table structure
    const usersInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    const profilesInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='profiles'").get();
    const imagesInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='images'").get();
    const forecastsInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='forecasts'").get();
    
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

// Initialize database on module load
initDatabase();

// Prepare queries for better performance
const preparedQueries = {
  createUser: db.prepare('INSERT INTO users (username, password) VALUES (?, ?)'),
  getUser: db.prepare('SELECT * FROM users WHERE username = ?'),
  getUserData: db.prepare('SELECT username, created_at FROM users WHERE username = ?'),
  createProfile: db.prepare(`INSERT INTO profiles (username, real_name, farm_size, country) 
                             VALUES (?, ?, ?, ?)`),
  updateProfile: db.prepare(`INSERT OR REPLACE INTO profiles (username, real_name, farm_size, country, updated_at) 
                             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`),
  getProfile: db.prepare('SELECT real_name as realName, farm_size as farmSize, country FROM profiles WHERE username = ?'),
  
  // persisted_snippet_analysis
  insertImage: db.prepare(`INSERT INTO images (username, area_id, file_path, width, height, dark_pixel_ratio, estimated_pest_count, pest_amount, analysis_json)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getUserImages: db.prepare('SELECT * FROM images WHERE username = ? ORDER BY id DESC LIMIT ?'),
  getUserImagesByArea: db.prepare('SELECT * FROM images WHERE username = ? AND area_id = ? ORDER BY id DESC LIMIT ?'),
  insertForecast: db.prepare(`INSERT INTO forecasts (username, area_id, horizon_minutes, risk_score, risk_level, details_json)
                              VALUES (?, ?, ?, ?, ?, ?)`),
  
  insertMicroclimate: db.prepare(`INSERT INTO microclimate_data (username, area_id, air_temperature, soil_temperature, soil_moisture, relative_humidity, heat_stress_level)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getUserMicroclimate: db.prepare('SELECT * FROM microclimate_data WHERE username = ? ORDER BY id DESC LIMIT ?'),
  getUserMicroclimateByArea: db.prepare('SELECT * FROM microclimate_data WHERE username = ? AND area_id = ? ORDER BY id DESC LIMIT ?'),
  getRecentMicroclimateForForecast: db.prepare(`SELECT id, air_temperature, soil_temperature, soil_moisture, relative_humidity, heat_stress_level
                                                FROM microclimate_data
                                                WHERE username = ? AND area_id = ?
                                                ORDER BY id DESC LIMIT 10`),
  
  // Community-wide aggregation queries
  getCommunityPestData: db.prepare(`SELECT username, dark_pixel_ratio, estimated_pest_count, pest_amount, created_at
                                   FROM images
                                   WHERE area_id = ?
                                   ORDER BY created_at DESC LIMIT 100`),
  getCommunityPestDataRecent: db.prepare(`SELECT username, dark_pixel_ratio, estimated_pest_count, pest_amount, created_at
                                           FROM images
                                           WHERE area_id = ?
                                           ORDER BY created_at DESC LIMIT 50`),
  getCommunityMicroclimateData: db.prepare(`SELECT username, air_temperature, soil_temperature, soil_moisture, relative_humidity, heat_stress_level, created_at
                                            FROM microclimate_data
                                            WHERE area_id = ?
                                            ORDER BY created_at DESC LIMIT 100`),
  getCommunityMicroclimateDataRecent: db.prepare(`SELECT username, air_temperature, soil_temperature, soil_moisture, relative_humidity, heat_stress_level, created_at
                                                  FROM microclimate_data
                                                  WHERE area_id = ?
                                                  ORDER BY created_at DESC LIMIT 50`),
  getCommunityUserCount: db.prepare(`SELECT COUNT(DISTINCT username) as user_count FROM images WHERE area_id = ?`),
  getCommunityUserCountMicroclimate: db.prepare(`SELECT COUNT(DISTINCT username) as user_count FROM microclimate_data WHERE area_id = ?`),
  
  // Social feed queries
  insertSocialPost: db.prepare(`INSERT INTO social_posts (username, real_name, area_id, post_type, forecast_level, forecast_description, snapshot_data, post_text)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getSocialPosts: db.prepare('SELECT * FROM social_posts ORDER BY created_at DESC LIMIT ?'),
  getSocialComments: db.prepare('SELECT * FROM social_comments WHERE post_id = ? ORDER BY created_at ASC'),
  insertSocialComment: db.prepare(`INSERT INTO social_comments (post_id, username, real_name, comment_text)
                                  VALUES (?, ?, ?, ?)`)
};

module.exports = {
  ...preparedQueries,
  exec: (query) => db.exec(query),
  prepare: (query) => db.prepare(query),
  close: () => db.close(),
  db: db // expose actual db instance
};