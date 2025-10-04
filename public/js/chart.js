// Chart.js local bundle (simplified version)
// This provides basic pie chart functionality without external CDN dependency

function createSimplePie(options) {
    if (!options.container || !options.data) {
        console.error('SimplePie requires container and data');
        return null;
    }

    const container = options.container;
    const data = options.data;
    const config = {
        width: container.width || 240,
        height: container.height || 240,
        colors: options.colors || ['#65a30d', '#84cc16', '#eab308', '#f97316', '#dc2626'],
        labels: options.labels || data.labels
    };

    // Create simple pie chart visualization
    const canvas = document.createElement('canvas');
    canvas.width = config.width;
    canvas.height = config.height;
    const ctx = canvas.getContext('2d');

    // Calculate pie slice angles
    const total = data.values.reduce((sum, val) => sum + val, 0);
    let currentAngle = 0;

    // Draw pie slices
    data.values.forEach((value, index) => {
        if (value === 0) return;

        const sliceAngle = (value / total) * 2 * Math.PI;
        const centerX = config.width / 2;
        const centerY = config.height / 2;
        const radius = Math.min(centerX, centerY) - 20;

        // Pie slice
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + sliceAngle);
        ctx.closePath();
        ctx.fillStyle = config.colors[index % config.colors.length];
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        currentAngle += sliceAngle;
    });

    // Create legend
    const legend = document.createElement('div');
    legend.style.cssText = `
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px;
        margin-top: 16px;
        font-size: 12px;
    `;

    config.labels.forEach((label, index) => {
        if (data.values[index] === 0) return;

        const legendItem = document.createElement('div');
        legendItem.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
        `;

        const colorBox = document.createElement('div');
        colorBox.style.cssText = `
            width: 12px;
            height: 12px;
            border-radius: 2px;
            background-color: ${config.colors[index % config.colors.length]};
            border: 1px solid #ffffff;
        `;

        const labelText = document.createElement('span');
        labelText.textContent = label;
        labelText.style.color = '#333';

        legendItem.appendChild(colorBox);
        legendItem.appendChild(labelText);
        legend.appendChild(legendItem);
    });

    // Replace container content
    container.innerHTML = '';
    container.appendChild(canvas);
    container.appendChild(legend);

    return {
        destroy: () => {
            if (container) container.innerHTML = '';
        },
        update: () => {
            // Simple implementation - just recreate
            createSimplePie(options);
        }
    };
}

// Global Chart-like interface for compatibility
if (typeof window !== 'undefined') {
    window.Chart = {
        register: () => {}, // No-op for compatibility
        ChartComponent: function(ctx, config) {
            if (config.type === 'pie') {
                const container = ctx.canvas.parentElement;
                return createSimplePie({
                    container: container,
                    data: {
                        labels: config.data.labels,
                        values: config.data.datasets[0].data
                    },
                    colors: config.data.datasets[0].backgroundColor
                });
            }
            return null;
        }
    };
}
