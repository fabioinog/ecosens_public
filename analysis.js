const sharp = require('sharp');
const path = require('path');

// ----------------------------------------
// Pest trap image analysis
// ----------------------------------------
// Downscale image -> convert to grayscale -> threshold binary
// count connected components in binary mask to get estimated pest count
// simple, fast, done locally, magic :D

async function analyzeStickyTrapImage(filePath) {
  const TARGET_SIZE = 640; // keep decent resolution for analysis
  const THRESHOLD = 90; // 0-255 grayscale threshold for "dark" pixels (tune as needed)
  const MIN_BLOB_SIZE = 10; // pixels in the downscaled space

  const img = sharp(filePath);
  const metadata = await img.metadata();
  const width = metadata.width || TARGET_SIZE;
  const height = metadata.height || TARGET_SIZE;

  // Resize while preserving aspect ratio
  const resized = img.resize({
    width: width >= height ? TARGET_SIZE : undefined,
    height: height > width ? TARGET_SIZE : undefined,
    fit: 'inside'
  }).grayscale();

  const { data, info } = await resized.raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Build binary mask (1 = dark/insect; 0 = background)
  const bin = new Uint8Array(w * h);
  let darkCount = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < THRESHOLD) {
      bin[i] = 1;
      darkCount++;
    }
  }
  const darkPixelRatio = darkCount / (w * h);

  // Connected components labeling (4-neighborhood)
  const visited = new Uint8Array(w * h);
  function idx(x, y) { return y * w + x; }
  const components = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (bin[i] === 1 && !visited[i]) {
        let size = 0;
        const stack = [i];
        visited[i] = 1;
        while (stack.length) {
          const cur = stack.pop();
          size++;
          const cx = cur % w;
          const cy = (cur - cx) / w;
          // neighbors: up, down, left, right
          if (cy > 0) {
            const n = cur - w; if (bin[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
          }
          if (cy < h - 1) {
            const n = cur + w; if (bin[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
          }
          if (cx > 0) {
            const n = cur - 1; if (bin[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
          }
          if (cx < w - 1) {
            const n = cur + 1; if (bin[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
          }
        }
        if (size >= MIN_BLOB_SIZE) components.push(size);
      }
    }
  }

  // Heuristic pest count = number of blobs
  const estimatedPestCount = components.length;

  const analysis = {
    width: w,
    height: h,
    threshold: THRESHOLD,
    minBlobSize: MIN_BLOB_SIZE,
    darkPixelRatio,
    blobCount: estimatedPestCount,
    blobSizes: components.slice(0, 50) // limit details size
  };

  return { width: w, height: h, darkPixelRatio, estimatedPestCount, analysis };
}

// ----------------------------------------
// Forecasting
// ----------------------------------------
// Rolling risk forecast per area: combine
// - recent darkPixelRatio
// - recent estimatedPestCount trend (slope)
// - frequency of new uploads in the last day
// Risk score in [0, 1]; levels: low, medium, high.

function computeRiskLevel(score) {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

function computeForecastForArea(username, areaId, db) {
  const rows = db.prepare('SELECT id, dark_pixel_ratio, estimated_pest_count FROM images WHERE username = ? AND area_id = ? ORDER BY id DESC LIMIT 20').all(username, areaId);

  if (rows.length === 0) {
    const riskScore = 0.1; // default low
    const riskLevel = computeRiskLevel(riskScore);
    return {
      riskScore,
      riskLevel,
      details: { reason: 'no_data', recentImages: 0 }
    };
  }

  // Analyze pest amounts distribution instead of just averages
  const pestAmounts = rows.map(row => {
    const count = Math.max(0, Number(row.estimated_pest_count || 0));
    if (count <= 2) return { level: 0, count }; // very low
    else if (count <= 5) return { level: 1, count }; // low
    else if (count <= 12) return { level: 2, count }; // moderate
    else if (count <= 25) return { level: 3, count }; // high
    else return { level: 4, count }; // very high
  });

  // Calculate distribution with recency weighting (more recent images have more weight)
  const levelCounts = [0, 0, 0, 0, 0]; // counts for each level
  const totalWeight = pestAmounts.reduce((sum, pest, index) => {
    // More recent images get higher weight (exponential decay)
    const weight = Math.exp(-index * 0.2); // Recent images have ~1.0 weight, older ones decay
    if (pest.level === 0) levelCounts[0] += weight;
    else if (pest.level === 1) levelCounts[1] += weight;
    else if (pest.level === 2) levelCounts[2] += weight;
    else if (pest.level === 3) levelCounts[3] += weight;
    else if (pest.level === 4) levelCounts[4] += weight;
    return sum + weight;
  }, 0);

  const totalImages = pestAmounts.length;
  const levelDistribution = levelCounts.map(count => (count / totalWeight) * 100);

  // Calculate weighted score with more balanced approach
  let weightedScore = 0;
  for (let i = 0; i < 5; i++) {
    const levelWeight = (i / 4); // 0.0, 0.25, 0.5, 0.75, 1.0
    weightedScore += (levelDistribution[i] / 100) * levelWeight;
  }
  
  // Score is already in 0-1 scale
  let score = weightedScore;

  // Apply stronger bias toward recent trends
  const lowRiskImages = levelDistribution[0] + levelDistribution[1]; // very low + low
  const highRiskImages = levelDistribution[3] + levelDistribution[4]; // high + very high
  
  // More aggressive bias toward majority patterns
  if (lowRiskImages > 60) {
    score *= 0.5; // Strongly reduce risk if majority are low
  } else if (highRiskImages > 40) {
    score *= 1.3; // Increase risk if majority are high
  }
  
  // Additional check: if the most recent images are consistently low, further reduce risk
  const recentPestLevels = pestAmounts.slice(0, Math.min(5, totalImages)).map(p => p.level);
  const recentLowCount = recentPestLevels.filter(level => level <= 1).length;
  if (recentPestLevels.length > 0 && recentLowCount >= recentPestLevels.length * 0.8) {
    score *= 0.4; // Strong reduction if recent 80%+ are low
  }
  
  score = Math.max(0, Math.min(1, score));

  const riskLevel = computeRiskLevel(score);
  
  return {
    riskScore: score,
    riskLevel,
    details: {
      totalImages,
      distributionPercentages: {
        veryLow: levelDistribution[0].toFixed(1),
        low: levelDistribution[1].toFixed(1),
        moderate: levelDistribution[2].toFixed(1),
        high: levelDistribution[3].toFixed(1),
        veryHigh: levelDistribution[4].toFixed(1)
      },
      weightedScore: weightedScore.toFixed(1)
    }
  };
}

function categorizePestAmount(estimatedCount, darkPixelRatio) {
  const count = Math.max(0, Number(estimatedCount || 0));
  let category = 'very low';
  if (count <= 2) category = 'very low';
  else if (count <= 5) category = 'low';
  else if (count <= 12) category = 'moderate';
  else if (count <= 25) category = 'high';
  else category = 'very high';
  if (darkPixelRatio >= 0.15) {
    const order = ['very low','low','moderate','high','very high'];
    const idx = Math.min(order.indexOf(category) + 1, order.length - 1);
    category = order[idx];
  }
  return category;
}

function simpleAdviceForLevel(level) {
  switch (level) {
    case 'high': return 'High risk: Inspect traps now and consider treatment.';
    case 'medium': return 'Medium risk: Monitor closely; check traps later today.';
    default: return 'Low risk: Routine monitoring is sufficient.';
  }
}

// Heat stress algorithm based on microclimate data
function computeHeatStressLevel(airTemperature, soilTemperature, soilMoisture, relativeHumidity) {
  let stressScore = 0;
  
  // Air temperature contribution (0-50% weight)
  if (airTemperature > 35) stressScore += 50;
  else if (airTemperature > 32) stressScore += 35;
  else if (airTemperature > 30) stressScore += 20;
  else if (airTemperature > 25) stressScore += 10;
  
  // Soil temperature contribution (0-25% weight)
  if (soilTemperature > 30) stressScore += 25;
  else if (soilTemperature > 28) stressScore += 15;
  else if (soilTemperature > 26) stressScore += 10;
  else if (soilTemperature > 24) stressScore += 5;
  
  // Low soil moisture penalty (0-15% weight)
  if (soilMoisture < 20) stressScore += 15;
  else if (soilMoisture < 30) stressScore += 10;
  else if (soilMoisture < 40) stressScore += 5;
  
  // Low humidity penalty (0-10% weight)
  if (relativeHumidity < 30) stressScore += 10;
  else if (relativeHumidity < 50) stressScore += 5;
  
  // Clamp score to 100%
  stressScore = Math.min(stressScore, 100);
  
  // Convert to stress levels
  if (stressScore >= 70) return 'critical';
  if (stressScore >= 50) return 'high';
  if (stressScore >= 30) return 'moderate';
  if (stressScore >= 15) return 'low';
  return 'minimal';
}

function heatStressAdviceForLevel(level) {
  switch (level) {
    case 'critical': return 'Critical heat stress: Immediate action required. Apply emergency cooling and irrigation.';
    case 'high': return 'High heat stress: Increase irrigation frequency and consider shade cover.';
    case 'moderate': return 'Moderate heat stress: Monitor closely and prepare irrigation if conditions worsen.';
    case 'low': return 'Low heat stress: Normal monitoring sufficient, watch for signs of stress.';
    default: return 'Minimal heat stress: Optimal conditions for plant growth.';
  }
}

// Import community analysis functions for re-export
const communityAnalysis = require('./community-analysis');

module.exports = {
  analyzeStickyTrapImage,
  computeForecastForArea,
  categorizePestAmount,
  simpleAdviceForLevel,
  computeHeatStressLevel,
  heatStressAdviceForLevel,
  // Re-export community analysis functions for backward compatibility
  computeCommunityPestTrend: communityAnalysis.computeCommunityPestTrend,
  computeCommunityHeatStressTrend: communityAnalysis.computeCommunityHeatStressTrend
};