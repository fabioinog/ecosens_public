// Community-wide aggregation algorithms
// Separated from analysis.js for better organization

// Community pest trend computation
function computeCommunityPestTrend(areaId, db, filterType = 'recent') {
  try {
    const communityData = filterType === 'recent' 
      ? db.getCommunityPestDataRecent.all(areaId)
      : db.getCommunityPestData.all(areaId);
    
    if (communityData.length === 0) {
      return {
        trend: 'no_data',
        riskLevel: 'low',
        trendDescription: 'No community data available yet',
        participation: 0,
        confidence: 'low',
        recentActivity: 'No recent submissions'
      };
    }
    
    // Analyze pest amounts distribution across community
    const pestAmounts = communityData.map(row => {
      const count = Math.max(0, Number(row.estimated_pest_count || 0));
      if (count <= 2) return 0; // very low
      else if (count <= 5) return 1; // low
      else if (count <= 12) return 2; // moderate
      else if (count <= 25) return 3; // high
      else return 4; // very high
    });
    
    // Calculate trend indicators
    const avgPestAmount = pestAmounts.reduce((sum, amount) => sum + amount, 0) / pestAmounts.length;
    const highRiskCount = pestAmounts.filter(amount => amount >= 3).length;
    const participationRate = highRiskCount / pestAmounts.length;
    
    // Determine overall trend
    let trend = 'stable';
    let riskLevel = 'low';
    
    if (avgPestAmount >= 3.5) {
      trend = 'rising_significantly';
      riskLevel = 'high';
    } else if (avgPestAmount >= 2.5) {
      trend = 'rising_moderately';
      riskLevel = 'moderate';
    } else if (avgPestAmount >= 1.5) {
      trend = 'stable_moderate';
      riskLevel = 'moderate';
    } else {
      trend = 'stable_low';
      riskLevel = 'low';
    }
    
    // Get participation count
    const userCount = db.getCommunityUserCount.get(areaId).user_count;
    
    let trendDescription = '';
    let confidence = 'medium';
    
    switch (trend) {
      case 'rising_significantly':
        trendDescription = `High pest activity detected! ${highRiskCount} out of ${pestAmounts.length} recent submissions show high pest counts`;
        confidence = 'high';
        break;
      case 'rising_moderately':
        trendDescription = `Moderate pest activity increasing. ${Math.round(participationRate * 100)}% of submissions show elevated pest levels`;
        confidence = 'medium';
        break;
      case 'stable_moderate':
        trendDescription = `Moderate pest levels sustained. Community activity suggests normal pest management needed`;
        confidence = 'medium';
        break;
      case 'stable_low':
        trendDescription = `Low pest activity across community. Good pest management practices observed`;
        confidence = 'high';
        break;
      default:
        trendDescription = 'Community pest levels are stable';
    }
    
    const recentCount = communityData.filter(row => {
      const submissionTime = new Date(row.created_at);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return submissionTime > dayAgo;
    }).length;
    
    return {
      trend,
      riskLevel,
      trendDescription,
      participation: userCount,
      confidence,
      recentActivity: `${recentCount} submissions in last 24 hours`,
      averagePestLevel: avgPestAmount.toFixed(1),
      totalSubmissions: communityData.length
    };
    
  } catch (err) {
    console.error('Error computing community pest trend:', err);
    return {
      trend: 'error',
      riskLevel: 'unknown',
      trendDescription: 'Error analyzing community data',
      participation: 0,
      confidence: 'low',
      recentActivity: 'Unable to load data'
    };
  }
}

// Community heat stress trend computation
function computeCommunityHeatStressTrend(areaId, db, filterType = 'recent') {
  try {
    const communityData = filterType === 'recent'
      ? db.getCommunityMicroclimateDataRecent.all(areaId)
      : db.getCommunityMicroclimateData.all(areaId);
    
    if (communityData.length === 0) {
      return {
        trend: 'no_data',
        heatStressLevel: 'minimal',
        trendDescription: 'No community microclimate data available yet',
        participation: 0,
        confidence: 'low',
        recentActivity: 'No recent submissions'
      };
    }
    
    // Analyze heat stress levels across community
    const stressLevels = communityData.map(row => {
      const level = (row.heat_stress_level || 'minimal').toLowerCase();
      const stressValues = { minimal: 0, low: 1, moderate: 2, high: 3, critical: 4 };
      return stressValues[level] || 0;
    });
    
    const avgStressLevel = stressLevels.reduce((sum, level) => sum + level, 0) / stressLevels.length;
    const highStressCount = stressLevels.filter(level => level >= 3).length;
    const participationRate = highStressCount / stressLevels.length;
    
    // Calculate environmental averages
    const avgAirTemp = communityData.reduce((sum, row) => sum + ( row.air_temperature || 0), 0) / communityData.length;
    const avgHumidity = communityData.reduce((sum, row) => sum + (row.relative_humidity || 0), 0) / communityData.length;
    const avgSoilMoisture = communityData.reduce((sum, row) => sum + (row.soil_moisture || 0), 0) / communityData.length;
    
    // Determine overall heat stress trend
    let trend = 'stable';
    let heatStressLevel = 'minimal';
    
    if (avgStressLevel >= 3.5) {
      trend = 'critical_conditions';
      heatStressLevel = 'critical';
    } else if (avgStressLevel >= 2.5) {
      trend = 'elevated_conditions';
      heatStressLevel = 'high';
    } else if (avgStressLevel >= 1.5) {
      trend = 'moderate_conditions';
      heatStressLevel = 'moderate';
    } else if (avgStressLevel >= 0.5) {
      trend = 'mild_conditions';
      heatStressLevel = 'low';
    } else {
      trend = 'optimal_conditions';
      heatStressLevel = 'minimal';
    }
    
    // Get participation count
    const userCount = db.getCommunityUserCountMicroclimate.get(areaId).user_count;
    
    let trendDescription = '';
    let confidence = 'medium';
    
    switch (trend) {
      case 'critical_conditions':
        trendDescription = `DANGER: Extreme heat stress detected! ${Math.round(participationRate * 100)}% of community experiencing critical conditions`;
        confidence = 'high';
        break;
      case 'elevated_conditions':
        trendDescription = `High heat stress across community. Avg temp: ${avgAirTemp.toFixed(1)}°C, Humidity: ${avgHumidity.toFixed(1)}%`;
        confidence = 'high';
        break;
      case 'moderate_conditions':
        trendDescription = `Moderate heat stress conditions. Community monitoring shows elevated temperatures and humidity`;
        confidence = 'medium';
        break;
      case 'mild_conditions':
        trendDescription = `Mild heat stress detected. Environmental conditions trending toward optimal range`;
        confidence = 'medium';
        break;
      case 'optimal_conditions':
        trendDescription = `Excellent environmental conditions! Community experiencing optimal growing temperatures`;
        confidence = 'high';
        break;
      default:
        trendDescription = 'Community heat stress levels are stable';
    }
    
    const recentCount = communityData.filter(row => {
      const submissionTime = new Date(row.created_at);
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return submissionTime > dayAgo;
    }).length;
    
    return {
      trend,
      heatStressLevel,
      trendDescription,
      participation: userCount,
      confidence,
      recentActivity: `${recentCount} submissions in last 24 hours`,
      averageAirTemp: avgAirTemp.toFixed(1),
      averageHumidity: avgHumidity.toFixed(1),
      totalSubmissions: communityData.length
    };
    
  } catch (err) {
    console.error('Error computing community heat stress trend:', err);
    return {
      trend: 'error',
      heatStressLevel: 'unknown',
      trendDescription: 'Error analyzing community data',
      participation: 0,
      confidence: 'low',
      recentActivity: 'Unable to load data'
    };
  }
}

module.exports = {
  computeCommunityPestTrend,
  computeCommunityHeatStressTrend
};
