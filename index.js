const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const cookieSession = require('cookie-session');
const multer = require('multer');
const cors = require('cors');

const app = express();
const db = require('./db.js');
const analysis = require('./analysis.js');

// Setup multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'data', 'uploads'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const base = path.basename(file.originalname || 'trap', ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    const stamp = Date.now();
    cb(null, `${base}_${stamp}${ext}`);
  }
});
const upload = multer({ storage });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

// Serve logo file
app.get('/logo.png', (req, res) => {
	res.sendFile(path.join(__dirname, 'logo.png'));
});
app.use(cookieSession({
  name: 'sessionId',
  keys: ['local-session-secret-key-for-development'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  httpOnly: true,
  secure: false, // Set to false for localhost
  sameSite: 'lax'
}));

// Auth middleware
function requireAuth(req, res, next) {
  console.log('requireAuth check - username:', req.session.username, 'path:', req.path);
  if (req.session.username) {
    // Check if user actually exists in database
    try {
      const user = db.getUser.get(req.session.username);
      if (!user) {
        console.log('User not found in database, clearing session');
        req.session = null;
        return res.redirect('/login');
      }
    } catch (err) {
      console.log('Error checking user in database, clearing session');
      req.session = null;
      return res.redirect('/login');
    }
    next();
  } else {
    console.log('No username in session, redirecting to login');
    res.redirect('/login');
  }
}

// Require profile completion middleware
function requireProfileComplete(req, res, next) {
  console.log('requireProfileComplete check - username:', req.session.username, 'path:', req.path);
  
  // If no session, redirect to login
  if (!req.session.username) {
    console.log('No username in session, redirecting to login');
    return res.redirect('/login');
  }
  
  try {
    const profile = db.getProfile.get(req.session.username);
    console.log('Profile found:', profile);
    
    // If profile doesn't exist in database but session exists, clear session and redirect to login
    if (!profile) {
      console.log('Profile not found in database, clearing session and redirecting to login');
      req.session = null;
      return res.redirect('/login');
    }
    
    // Check if user has selected a country
    if (!profile.country) {
      console.log('No country set, redirecting to profile');
      return res.redirect('/profile');
    }
    
    console.log('Profile complete, proceeding');
    next();
  } catch (err) {
    console.error('Error checking profile:', err);
    res.redirect('/profile');
  }
}

// Routes
app.get('/', (req, res) => {
  console.log('Root route accessed. Session username:', req.session.username);
  if (!req.session.username) {
    console.log('No session, redirecting to login');
    return res.redirect('/login');
  }
  console.log('Session exists, applying profile completion check');
  // If authenticated, require profile completion
  requireProfileComplete(req, res, () => {
    res.sendFile(path.join(__dirname, 'public', 'my_farm.html'));
  });
});

app.get('/my-farm', requireProfileComplete, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'my_farm.html'));
});

app.get('/login', (req, res) => {
  if (req.session.username) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/profile', requireAuth, (req, res) => {
  // Always show profile page for authenticated users, no redirect loops
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});


app.get('/submissions', requireProfileComplete, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'submissions.html'));
});

app.get('/microclimate-submissions', requireProfileComplete, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'microclimate-submissions.html'));
});

app.get('/feed', requireProfileComplete, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'feed.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Profile endpoints
app.get('/api/profile', requireAuth, (req, res) => {
  try {
    console.log('Fetching profile for user:', req.session.username);
    const result = db.getProfile.get(req.session.username);
    console.log('Raw database result:', result);
    console.log('JSON.stringify result:', JSON.stringify(result));
    
    if (!result) {
      console.log('No profile found, returning default values');
      return res.json({ realName: '', farmSize: '', country: '' });
    }
    
    // Ensure we handle NULL values properly
    const cleanResult = {
      realName: result.realName || '',
      farmSize: result.farmSize || '',
      country: result.country || ''
    };
    
    console.log('Cleaned result being sent:', cleanResult);
    res.json(cleanResult);
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/profile', requireAuth, (req, res) => {
  const { realName, farmSize, country } = req.body;
  
  console.log('Profile update request:', {
    username: req.session.username,
    realName,
    farmSize,
    country
  });
  
  try {
    const result = db.updateProfile.run(req.session.username, realName || null, farmSize || null, country || null);
    console.log('Profile update result:', result);
    
    // If country is set, clear the newUser flag
    if (country) {
      req.session.newUser = false;
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving profile:', err);
    res.status(500).json({ error: 'Database error', message: err.message });
  }
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.createUser.run(username, hashedPassword);

    req.session.username = username;
    req.session.newUser = true; // Flag for new users
    console.log('User created successfully:', username);
    res.json({ success: true, message: 'User created successful', newUser: true });
  } catch (err) {
    console.error('Error during signup:', err);
    if (err.message.includes('UNIQUE constraint failed') || err.message.includes('PRIMARY KEY')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: `Error creating user: ${err.message}` });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = db.getUser.get(username);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const match = await bcrypt.compare(password, user.password);

    if (match) {
      req.session.username = username;
      console.log('Login successful for:', username);
      res.json({ success: true, message: 'Login successful' });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true, message: 'Logged out successfully' });
});

// Get current user
app.get('/api/user', requireAuth, (req, res) => {
  try {
    const user = db.getUserData.get(req.session.username);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ----------------------------------------
// Pest Trap Analysis API Endpoints
// ----------------------------------------

// Upload and analyze pest trap image
app.post('/api/upload-pest-trap', requireAuth, upload.single('image'), async (req, res) => {
  try {
    // Get user's country from profile (this becomes the area)
    let userCountry = 'Unknown Location';
    try {
      const profile = db.getProfile.get(req.session.username);
      userCountry = profile?.country || 'Unknown Location';
    } catch (err) {
      console.log('Profile not found for user:', req.session.username);
    }
    
    const areaId = userCountry; // Use country as area
    
    if (!req.file) {
      return res.status(400).json({ error: 'image is required' });
    }


    const filePath = req.file.path;
    const { width, height, darkPixelRatio, estimatedPestCount, analysis: analysisResult } = 
      await analysis.analyzeStickyTrapImage(filePath);

    const pestAmountCategory = analysis.categorizePestAmount(estimatedPestCount, darkPixelRatio);

    // Save to database
    db.insertImage.run(
      req.session.username,
      areaId,
      path.relative(__dirname, filePath).replace(/\\/g, '/'),
      width,
      height,
      darkPixelRatio,
      estimatedPestCount,
      pestAmountCategory,
      JSON.stringify(analysisResult)
    );

    // Compute and save forecast
    const forecast = analysis.computeForecastForArea(req.session.username, areaId, db);
    db.insertForecast.run(
      req.session.username,
      areaId,
      60,
      forecast.riskScore,
      forecast.riskLevel,
      JSON.stringify(forecast.details)
    );

    const advice = analysis.simpleAdviceForLevel(forecast.riskLevel);

    res.json({
      success: true,
      pestAmount: pestAmountCategory,
      riskLevel: forecast.riskLevel,
      advice,
      fileUrl: `/uploads/${path.basename(filePath)}`,
      metrics: {
        width,
        height,
        darkPixelRatio,
        estimatedPestCount
      },
      country: userCountry,
      areaId: areaId
    });
  } catch (err) {
    console.error('Error uploading pest trap image:', err);
    res.status(500).json({ error: 'analysis_failed', message: err.message });
  }
});

// Get forecast for user's area
app.get('/api/pest-forecast', requireAuth, (req, res) => {
  try {
    const areaId = req.query.areaId || 'greenhouse-1';
    
    console.log('Computing forecast for:', req.session.username, 'area:', areaId); // Debug logging
    
    const forecast = analysis.computeForecastForArea(req.session.username, areaId, db);
    const advice = analysis.simpleAdviceForLevel(forecast.riskLevel);
    
    console.log('Forecast result:', forecast); // Debug logging
    
    res.json({
      success: true,
      areaId,
      riskLevel: forecast.riskLevel,
      riskScore: forecast.riskScore,
      advice,
      details: forecast.details
    });
  } catch (err) {
    console.error('Error computing forecast:', err);
    res.status(500).json({ error: 'forecast_failed', message: err.message });
  }
});

// Get user's submission history
app.get('/api/submissions', requireAuth, (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
    const areaId = req.query.areaId || null;
    
    let rows;
    if (areaId) {
      rows = db.getUserImagesByArea.all(req.session.username, areaId, limit);
    } else {
      rows = db.getUserImages.all(req.session.username, limit);
    }

    const submissions = rows.map(row => ({
      id: row.id,
      area_id: row.area_id,
      pest_amount: row.pest_amount,
      file_url: `/uploads/${path.basename(row.file_path)}`,
      width: row.width,
      height: row.height,
      dark_pixel_ratio: row.dark_pixel_ratio,
      estimated_pest_count: row.estimated_pest_count,
      created_at: row.created_at
    }));
    
    res.json({
      success: true,
      submissions,
      total: submissions.length
    });
  } catch (err) {
    console.error('Error fetching submissions:', err);
    res.status(500).json({ error: 'submissions_failed', message: err.message });
  }
});

// ----------------------------------------
// Microclimate Data API Endpoints
// ----------------------------------------

// Submit microclimate data
app.post('/api/submit-microclimate', requireAuth, (req, res) => {
  try {
    const { airTemperature, soilTemperature, soilMoisture, relativeHumidity } = req.body;
    
    // Validate inputs
    if (!airTemperature || !soilTemperature || !soilMoisture || !relativeHumidity) {
      return res.status(400).json({ error: 'All microclimate values are required' });
    }
    
    if (isNaN(airTemperature) || isNaN(soilTemperature) || isNaN(soilMoisture) || isNaN(relativeHumidity)) {
      return res.status(400).json({ error: 'All values must be numbers' });
    }
    
    // Get user's country from profile (this becomes the area)
    let userCountry = 'Unknown Location';
    try {
      const profile = db.getProfile.get(req.session.username);
      userCountry = profile?.country || 'Unknown Location';
    } catch (err) {
      console.log('Profile not found for user:', req.session.username);
    }
    
    const areaId = userCountry;
    
    // Compute heat stress level
    const heatStressLevel = analysis.computeHeatStressLevel(airTemperature, soilTemperature, soilMoisture, relativeHumidity);
    
    // Insert microclimate data
    db.insertMicroclimate.run(
      req.session.username,
      areaId,
      parseFloat(airTemperature),
      parseFloat(soilTemperature),
      parseFloat(soilMoisture),
      parseFloat(relativeHumidity),
      heatStressLevel
    );
    
    const advice = analysis.heatStressAdviceForLevel(heatStressLevel);
    
    res.json({
      success: true,
      heatStressLevel,
      advice,
      areaId,
      country: userCountry,
      values: {
        airTemperature: parseFloat(airTemperature),
        soilTemperature: parseFloat(soilTemperature),
        soilMoisture: parseFloat(soilMoisture),
        relativeHumidity: parseFloat(relativeHumidity)
      }
    });
    
  } catch (err) {
    console.error('Error submitting microclimate data:', err);
    res.status(500).json({ error: 'submission_failed', message: err.message });
  }
});

// Get microclimate submissions
app.get('/api/microclimate-submissions', requireAuth, (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
    const areaId = req.query.areaId || null;
    
    let rows;
    if (areaId) {
      rows = db.getUserMicroclimateByArea.all(req.session.username, areaId, limit);
    } else {
      rows = db.getUserMicroclimate.all(req.session.username, limit);
    }

    const submissions = rows.map(row => ({
      id: row.id,
      area_id: row.area_id,
      air_temperature: row.air_temperature,
      soil_temperature: row.soil_temperature,
      soil_moisture: row.soil_moisture,
      relative_humidity: row.relative_humidity,
      heat_stress_level: row.heat_stress_level,
      created_at: row.created_at
    }));
    
    res.json({
      success: true,
      submissions,
      total: submissions.length
    });
  } catch (err) {
    console.error('Error fetching microclimate submissions:', err);
    res.status(500).json({ error: 'submissions_failed', message: err.message });
  }
});

// Heat stress forecast endpoint
app.get('/api/heat-stress-forecast', requireAuth, (req, res) => {
  try {
    const areaId = req.query.areaId || null;
    
    if (!areaId) {
      return res.status(400).json({ error: 'areaId is required' });
    }
    
    const rows = db.getRecentMicroclimateForForecast.all(req.session.username, areaId);
    
    let overallStressLevel = 'minimal';
    let advice = 'No recent data available.';
    
    if (rows.length > 0) {
      // Calculate average heat stress level from recent data
      const stressLevels = ['minimal', 'low', 'moderate', 'high', 'critical'];
      const stressCounts = rows.map(row => stressLevels.indexOf(row.heat_stress_level));
      const avgStressIndex = stressCounts.reduce((sum, level) => sum + level, 0) / stressCounts.length;
      const roundedIndex = Math.round(avgStressIndex);
      
      overallStressLevel = stressLevels[Math.min(roundedIndex, stressLevels.length - 1)];
      advice = analysis.heatStressAdviceForLevel(overallStressLevel);
    }
    
    res.json({
      success: true,
      areaId,
      heatStressLevel: overallStressLevel,
      advice,
      recentSubmissions: rows.length,
      details: rows.slice(0, 5).map(row => ({
        temperature: row.air_temperature,
        humidity: row.relative_humidity,
        stressLevel: row.heat_stress_level
      }))
    });
  } catch (err) {
    console.error('Error computing Heat stress forecast:', err);
    res.status(500).json({ error: 'forecast_failed', message: err.message });
  }
});

// ----------------------------------------
// Community Feed API Endpoints
// ----------------------------------------

// Get community pest trend
app.get('/api/community-pest-trend', requireAuth, (req, res) => {
  try {
    console.log('Community pest trend request from:', req.session.username);
    
    // Get user's country from profile
    const profile = db.getProfile.get(req.session.username);
    console.log('User profile:', profile);
    
    if (!profile) {
      console.log('No profile found for user:', req.session.username);
      return res.status(400).json({ 
        success: false, 
        error: 'profile_not_found',
        message: 'User profile not found' 
      });
    }
    
    const areaId = profile.country || 'Unknown Location';
    console.log('Area ID for trend:', areaId);
    
    const { type = 'recent' } = req.query; // 'recent' or 'all'
    
    const trend = analysis.computeCommunityPestTrend(areaId, db, type);
    console.log(`Computed pest trend (${type}):`, trend);
    
    res.json({
      success: true,
      areaId,
      trend,
      type,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error getting community pest trend:', err);
    res.status(500).json({ 
      success: false, 
      error: 'trend_failed', 
      message: err.message 
    });
  }
});

// Get community heat stress trend
app.get('/api/community-heat-trend', requireAuth, (req, res) => {
  try {
    console.log('Community heat stress trend request from:', req.session.username);
    
    // Get user's country from profile
    const profile = db.getProfile.get(req.session.username);
    console.log('User profile:', profile);
    
    if (!profile) {
      console.log('No profile found for user:', req.session.username);
      return res.status(400).json({ 
        success: false, 
        error: 'profile_not_found',
        message: 'User profile not found' 
      });
    }
    
    const areaId = profile.country || 'Unknown Location';
    console.log('Area ID for trend:', areaId);
    
    const { type = 'recent' } = req.query; // 'recent' or 'all'
    
    const trend = analysis.computeCommunityHeatStressTrend(areaId, db, type);
    console.log(`Computed heat stress trend (${type}):`, trend);
    
    res.json({
      success: true,
      areaId,
      trend,
      type,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error getting community heat stress trend:', err);
    res.status(500).json({ 
      success: false, 
      error: 'trend_failed', 
      message: err.message 
    });
  }
});

// Get pest classification counts for pie chart
app.get('/api/community-pest-counts', requireAuth, (req, res) => {
  try {
    console.log('Community pest counts request from:', req.session.username);
    
    const profile = db.getProfile.get(req.session.username);
    console.log('Profile for counts:', profile);
    
    const areaId = profile?.country;
    console.log('Area ID for counts:', areaId);
    
    const { type = 'recent' } = req.query; // 'recent' or 'all'
    
    let query;
    let params = [];
    
    if (areaId) {
      if (type === 'recent') {
        query = `SELECT pest_amount FROM images WHERE area_id = ? ORDER BY created_at DESC LIMIT 50`;
        params.push(areaId);
      } else {
        query = 'SELECT pest_amount FROM images WHERE area_id = ?';
        params.push(areaId);
      }
    } else {
      if (type === 'recent') {
        query = 'SELECT pest_amount FROM images ORDER BY created_at DESC LIMIT 50';
      } else {
        query = 'SELECT pest_amount FROM images';
      }
    }
    
    console.log('Pest counts query:', query, 'params:', params, 'type:', type);
    const rows = db.prepare(query).all(...params);
    console.log(`Raw pest count rows (${type}):`, rows.length);
    
    const levelKeys = ['very_low', 'low', 'moderate', 'high', 'very_high'];
    const counts = {};
    levelKeys.forEach(k => counts[k] = 0);
    
    rows.forEach(row => {
      const amount = row.pest_amount?.toLowerCase().replace(' ', '_');
      if (levelKeys.includes(amount)) {
        counts[amount]++;
      }
    });
    
    console.log(`Processed pest counts (${type}):`, counts);
    res.json({ success: true, counts, type, totalSubmissions: rows.length });
  } catch (err) {
    console.error('Error fetching community pest counts:', err);
    res.status(500).json({ 
      success: false, 
      error: 'counts_failed', 
      message: err.message 
    });
  }
});

// Get heat stress classification counts for pie chart
app.get('/api/community-heat-counts', requireAuth, (req, res) => {
  try {
    console.log('Community heat counts request from:', req.session.username);
    
    const profile = db.getProfile.get(req.session.username);
    console.log('Profile for counts:', profile);
    
    const areaId = profile?.country;
    console.log('Area ID for counts:', areaId);
    
    const { type = 'recent' } = req.query; // 'recent' or 'all'
    
    let query;
    let params = [];
    
    if (areaId) {
      if (type === 'recent') {
        query = `SELECT heat_stress_level FROM microclimate_data WHERE area_id = ? ORDER BY created_at DESC LIMIT 50`;
        params.push(areaId);
      } else {
        query = 'SELECT heat_stress_level FROM microclimate_data WHERE area_id = ?';
        params.push(areaId);
      }
    } else {
      if (type === 'recent') {
        query = 'SELECT heat_stress_level FROM microclimate_data ORDER BY created_at DESC LIMIT 50';
      } else {
        query = 'SELECT heat_stress_level FROM microclimate_data';
      }
    }
    
    console.log('Heat counts query:', query, 'params:', params, 'type:', type);
    const rows = db.prepare(query).all(...params);
    console.log(`Raw heat count rows (${type}):`, rows.length);
    
    const levelKeys = ['minimal', 'low', 'moderate', 'high', 'critical'];
    const counts = {};
    levelKeys.forEach(k => counts[k] = 0);
    
    rows.forEach(row => {
      const level = row.heat_stress_level?.toLowerCase();
      if (levelKeys.includes(level)) {
        counts[level]++;
      }
    });
    
    console.log(`Processed heat counts (${type}):`, counts);
    res.json({ success: true, counts, type, totalSubmissions: rows.length });
  } catch (err) {
    console.error('Error fetching community heat counts:', err);
    res.status(500).json({ 
      success: false, 
      error: 'counts_failed', 
      message: err.message 
    });
  }
});

// ----------------------------------------
// Social Feed API Endpoints
// ----------------------------------------

// Post a forecast snapshot to social feed
app.post('/api/post-forecast', requireAuth, async (req, res) => {
  try {
    const { postType, postText } = req.body; // 'pest' or 'heat'
    
    if (!postType || (postType !== 'pest' && postType !== 'heat')) {
      return res.status(400).json({ error: 'Invalid post type. Must be "pest" or "heat"' });
    }

    // Get user profile for real name
    const profile = db.getProfile.get(req.session.username);
    const realName = profile?.realName || req.session.username;
    const areaId = profile?.country || 'Unknown Location';

    let forecastLevel, forecastDescription, snapshotData;

    if (postType === 'pest') {
      // Get current pest forecast snapshot
      const forecast = analysis.computeForecastForArea(req.session.username, areaId, db);
      forecastLevel = forecast.riskLevel;
      forecastDescription = `Pest Risk: ${forecast.riskLevel.toUpperCase()}`;
      snapshotData = JSON.stringify({
        riskLevel: forecast.riskLevel,
        riskScore: forecast.riskScore,
        details: forecast.details,
        timestamp: new Date().toISOString()
      });
    } else {
      // Get current heat stress forecast snapshot
      const rows = db.getRecentMicroclimateForForecast.all(req.session.username, areaId);
      
      if (rows.length === 0) {
        return res.status(400).json({ error: 'No microclimate data available to post' });
      }

      // Calculate overall heat stress forecast (similar to heat stress forecast API)
      const stressLevels = ['minimal', 'low', 'moderate', 'high', 'critical'];
      const stressCounts = rows.map(row => stressLevels.indexOf(row.heat_stress_level));
      const avgStressIndex = stressCounts.reduce((sum, level) => sum + level, 0) / stressCounts.length;
      const roundedIndex = Math.round(avgStressIndex);
      
      const overallStressLevel = stressLevels[Math.min(roundedIndex, stressLevels.length - 1)];
      const advice = analysis.heatStressAdviceForLevel(overallStressLevel);
      
      forecastLevel = overallStressLevel;
      forecastDescription = `Heat Stress: ${overallStressLevel.toUpperCase()}`;
      snapshotData = JSON.stringify({
        heatStressLevel: overallStressLevel,
        advice: advice,
        recentSubmissions: rows.length,
        averageData: {
          air_temperature: (rows.reduce((sum, row) => sum + row.air_temperature, 0) / rows.length),
          soil_temperature: (rows.reduce((sum, row) => sum + row.soil_temperature, 0) / rows.length),
          soil_moisture: (rows.reduce((sum, row) => sum + row.soil_moisture, 0) / rows.length),
          relative_humidity: (rows.reduce((sum, row) => sum + row.relative_humidity, 0) / rows.length)
        },
        timestamp: new Date().toISOString()
      });
    }

    // Insert post
    db.insertSocialPost.run(
      req.session.username,
      realName,
      areaId,
      postType,
      forecastLevel,
      forecastDescription,
      snapshotData,
      postText || null
    );

    res.json({
      success: true,
      message: 'Forecast posted successfully',
      post: {
        type: postType,
        level: forecastLevel,
        description: forecastDescription,
        area: areaId,
        text: postText
      }
    });

  } catch (err) {
    console.error('Error posting forecast:', err);
    res.status(500).json({ error: 'post_failed', message: err.message });
  }
});

// Get social feed posts
app.get('/api/social-feed', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
    const posts = db.getSocialPosts.all(limit);
    
    // Get comments for each post
    const postsWithComments = posts.map(post => ({
      id: post.id,
      username: post.username,
      realName: post.real_name || post.username,
      area: post.area_id,
      type: post.post_type,
      forecastLevel: post.forecast_level,
      forecastDescription: post.forecast_description,
      snapshotData: JSON.parse(post.snapshot_data),
      text: post.post_text,
      createdAt: post.created_at,
      comments: db.getSocialComments.all(post.id).map(comment => ({
        id: comment.id,
        username: comment.username,
        realName: comment.real_name || comment.username,
        text: comment.comment_text,
        createdAt: comment.created_at
      }))
    }));

    res.json({
      success: true,
      posts: postsWithComments,
      total: posts.length
    });

  } catch (err) {
    console.error('Error fetching social feed:', err);
    res.status(500).json({ error: 'feed_failed', message: err.message });
  }
});

// Add comment to post
app.post('/api/post-comment', requireAuth, async (req, res) => {
  try {
    const { postId, commentText } = req.body;

    if (!postId || !commentText) {
      return res.status(400).json({ error: 'Post ID and comment text are required' });
    }

    // Get user profile for real name
    const profile = db.getProfile.get(req.session.username);
    const realName = profile?.realName || req.session.username;

    db.insertSocialComment.run(
      parseInt(postId),
      req.session.username,
      realName,
      commentText.trim()
    );

    res.json({
      success: true,
      message: 'Comment posted successfully'
    });

  } catch (err) {
    console.error('Error posting comment:', err);
    res.status(500).json({ error: 'comment_failed', message: err.message });
  }
});

// Start server for localhost
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`EcoSENS server running on http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT (Ctrl+C). Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    db.close();
    console.log('Database closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    db.close();
    console.log('Database closed.');
    process.exit(0);
  });
});

// Ensure process doesn't exit unexpectedly
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  server.close(() => {
    db.close();
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  server.close(() => {
    db.close();
    process.exit(1);
  });
});

// hi its fabio 