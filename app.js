// ============================================================
// Neighbourhood Green-Space Map - Main Application
// ============================================================

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Default city
let currentCity = 'Kozhikode';
let currentBbox = { south: 11.10, west: 75.60, north: 11.40, east: 76.00 };
let currentCenter = [11.25, 75.78];

let map = null;
let parkLayer = null;
let heatLayer = null;
let isSearching = false;
let activeRequest = null;

const cityNameEl = document.getElementById('cityName');
const treeCountEl = document.getElementById('treeCount');
const parkCountEl = document.getElementById('parkCount');
const searchInput = document.getElementById('citySearch');
const searchBtn = document.getElementById('searchBtn');

// ============================================================
// Initialize Map
// ============================================================
function initMap() {
    map = L.map('map', {
        center: currentCenter,
        zoom: 13,
        zoomControl: true
    });

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    parkLayer = L.geoJSON(null, {
        style: {
            fillColor: '#27ae60',
            fillOpacity: 0.35,
            color: '#1e8449',
            weight: 2,
            opacity: 0.8
        },
        onEachFeature: function(feature, layer) {
            const name = feature.properties.name || 'Unnamed Park';
            layer.bindPopup(`<h4>🌳 ${name}</h4>`);
        }
    });

    heatLayer = L.heatLayer([], {
        radius: 20,
        blur: 15,
        maxZoom: 17,
        gradient: { 0.0: '#27ae60', 0.5: '#f1c40f', 1.0: '#e74c3c' }
    });

    const baseMaps = { 'Street Map': osmLayer };
    const overlayMaps = {
        '🌳 Parks': parkLayer,
        '🌲 Tree Density': heatLayer
    };
    L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

    parkLayer.addTo(map);
    heatLayer.addTo(map);

    fetchCityData(currentCity);

    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleSearch();
    });
}

// ============================================================
// Search Handler with Auto-Retry on Timeout
// ============================================================
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    if (isSearching) {
        if (activeRequest) {
            activeRequest.abort();
            activeRequest = null;
        }
        isSearching = false;
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 Search';
    }

    isSearching = true;
    searchBtn.disabled = true;
    searchBtn.textContent = '⏳ Searching...';
    cityNameEl.textContent = '📍 Searching...';
    treeCountEl.textContent = '🌲 Loading...';
    parkCountEl.textContent = '🌿 Loading...';

    const controller = new AbortController();
    activeRequest = controller;

    try {
        // Geocode using Nominatim
        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=1`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'GreenSpaceMap/1.0' },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`Geocoding HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.length === 0) {
            cityNameEl.textContent = '❌ City not found';
            treeCountEl.textContent = '';
            parkCountEl.textContent = '';
            alert('City not found. Please try a different name.');
            isSearching = false;
            searchBtn.disabled = false;
            searchBtn.textContent = '🔍 Search';
            return;
        }

        const result = data[0];
        const cityName = result.display_name.split(',')[0];
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);

        // Get bounding box – CAPPED to avoid timeout
        let bbox;
        if (result.boundingbox) {
            const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
            // Cap at 0.15 degrees (~16km) to prevent timeout
            const maxSize = 0.15;
            const latRange = Math.min(maxLat - minLat, maxSize);
            const lonRange = Math.min(maxLon - minLon, maxSize);
            const centerLat = (minLat + maxLat) / 2;
            const centerLon = (minLon + maxLon) / 2;
            bbox = {
                south: centerLat - latRange / 2,
                west: centerLon - lonRange / 2,
                north: centerLat + latRange / 2,
                east: centerLon + lonRange / 2
            };
        } else {
            // Small fallback bbox (~4.5km)
            const delta = 0.04;
            bbox = {
                south: lat - delta,
                west: lng - delta,
                north: lat + delta,
                east: lng + delta
            };
        }

        currentCity = cityName;
        currentBbox = bbox;
        currentCenter = [lat, lng];

        map.flyTo([lat, lng], 14);

        // Fetch data with automatic retry on timeout
        await fetchWithRetry(cityName, bbox, controller.signal);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⏹️ Search cancelled');
            return;
        }
        console.error('Search error:', error);
        let errorMsg = error.message || 'Unknown error';
        if (error.message.includes('Failed to fetch')) {
            errorMsg = 'Network error – check your internet connection.';
        } else if (error.message.includes('504')) {
            errorMsg = 'Server timeout. Try a smaller area or search for a neighbourhood.';
        } else if (error.message.includes('429')) {
            errorMsg = 'Rate limited – please wait a moment and try again.';
        }
        cityNameEl.textContent = `❌ ${errorMsg}`;
        treeCountEl.textContent = '';
        parkCountEl.textContent = '';
        alert(`Error: ${errorMsg}`);
    } finally {
        isSearching = false;
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 Search';
        activeRequest = null;
    }
}

// ============================================================
// Fetch with Automatic Retry (shrinks bbox on timeout)
// ============================================================
async function fetchWithRetry(cityName, bbox, signal, attempt = 1) {
    const maxAttempts = 3;
    try {
        await fetchCityData(cityName, bbox, signal);
    } catch (error) {
        if (attempt < maxAttempts && (error.message.includes('504') || error.message.includes('timeout'))) {
            // Shrink bbox by 30% and retry
            const shrink = 0.7;
            const centerLat = (bbox.south + bbox.north) / 2;
            const centerLon = (bbox.west + bbox.east) / 2;
            const latHalf = ((bbox.north - bbox.south) / 2) * shrink;
            const lonHalf = ((bbox.east - bbox.west) / 2) * shrink;
            const smallerBbox = {
                south: centerLat - latHalf,
                west: centerLon - lonHalf,
                north: centerLat + latHalf,
                east: centerLon + lonHalf
            };
            console.log(`🔄 Retry ${attempt}/${maxAttempts} with smaller bbox...`);
            cityNameEl.textContent = `📍 ${cityName} (retry ${attempt}...)`;
            await fetchWithRetry(cityName, smallerBbox, signal, attempt + 1);
        } else {
            throw error;
        }
    }
}

// ============================================================
// Fetch Parks & Trees with Timeout
// ============================================================
async function fetchCityData(cityName, bbox = currentBbox, signal = null) {
    try {
        parkLayer.clearLayers();
        heatLayer.setLatLngs([]);
        cityNameEl.textContent = `📍 ${cityName}`;
        treeCountEl.textContent = '🌲 Fetching...';
        parkCountEl.textContent = '🌿 Fetching...';

        // 12 second timeout
        const timeout = (ms) => new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), ms)
        );

        let parksData, treesData;
        try {
            [parksData, treesData] = await Promise.race([
                Promise.all([
                    fetchParks(bbox, signal),
                    fetchTrees(bbox, signal)
                ]),
                timeout(12000).then(() => { throw new Error('504 Gateway Timeout'); })
            ]);
        } catch (fetchError) {
            throw new Error(fetchError.message || 'Data fetch failed');
        }

        // Process parks
        let parkFeatures = [];
        if (parksData?.elements) {
            parkFeatures = parksData.elements
                .filter(way => way.geometry && way.geometry.length > 0)
                .map(way => {
                    const coords = way.geometry.map(node => [node.lon, node.lat]);
                    if (coords.length) {
                        coords.push(coords[0]);
                    }
                    return {
                        type: 'Feature',
                        geometry: { type: 'Polygon', coordinates: [coords] },
                        properties: {
                            name: way.tags?.name || 'Unnamed Park',
                            area: way.tags?.area ? parseFloat(way.tags.area) : null
                        }
                    };
                });
        }

        if (parkFeatures.length > 0) {
            parkLayer.addData({ type: 'FeatureCollection', features: parkFeatures });
            parkCountEl.textContent = `🌿 ${parkFeatures.length} parks loaded`;
        } else {
            parkCountEl.textContent = '🌿 No parks found in this area';
        }

        // Process trees
        let points = [];
        if (treesData?.elements) {
            points = treesData.elements.map(node => [node.lat, node.lon, 1]);
        }

        if (points.length > 0) {
            heatLayer.setLatLngs(points);
            treeCountEl.textContent = `🌲 ${points.length} trees mapped`;
        } else {
            treeCountEl.textContent = '🌲 No trees found in this area';
        }

        console.log(`✅ Loaded ${parkFeatures.length} parks, ${points.length} trees for ${cityName}`);

    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Fetch city data error:', error);
        parkCountEl.textContent = `❌ ${error.message}`;
        treeCountEl.textContent = '❌ Failed';
        throw error;
    }
}

// ============================================================
// Overpass API Helpers (with timeout parameter)
// ============================================================
async function fetchParks(bbox, signal = null) {
    const { south, west, north, east } = bbox;
    const query = `[out:json][timeout:25];way["leisure"="park"](${south},${west},${north},${east});out geom;`;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
    const options = {
        headers: { 'User-Agent': 'GreenSpaceMap/1.0' }
    };
    if (signal) options.signal = signal;
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(response.status === 504 ? '504 Gateway Timeout' : `Parks API HTTP ${response.status}`);
    }
    return response.json();
}

async function fetchTrees(bbox, signal = null) {
    const { south, west, north, east } = bbox;
    const query = `[out:json][timeout:25];node["natural"="tree"](${south},${west},${north},${east});out;`;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
    const options = {
        headers: { 'User-Agent': 'GreenSpaceMap/1.0' }
    };
    if (signal) options.signal = signal;
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(response.status === 504 ? '504 Gateway Timeout' : `Trees API HTTP ${response.status}`);
    }
    return response.json();
}

// ============================================================
// Start App
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🌳 Green-Space Map initializing...');
    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded');
        return;
    }
    initMap();
});