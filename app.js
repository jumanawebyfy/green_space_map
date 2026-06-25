// ============================================================
// Neighbourhood Green-Space Map - Main Application
// ============================================================

// ============================================================
// Configuration
// ============================================================
const API_BASE = window.location.hostname === 'localhost'
    ? 'http://localhost:3000/api'
    : 'https://flood-risk-checker.onrender.com/api';   // ✅ YOUR RENDER URL

const NOMINATIM_URL = `${API_BASE}/geocode`;
const OVERPASS_PARKS_URL = `${API_BASE}/overpass-parks`;
const OVERPASS_TREES_URL = `${API_BASE}/overpass-trees`;

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
// Geocode City (via Proxy)
// ============================================================
async function geocodeCity(query, signal) {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Geocoding error: ${response.status}`);
    return response.json();
}

// ============================================================
// Fetch Parks (via Proxy)
// ============================================================
async function fetchParks(bbox, signal) {
    const { south, west, north, east } = bbox;
    const url = `${OVERPASS_PARKS_URL}?south=${south}&west=${west}&north=${north}&east=${east}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Parks error: ${response.status}`);
    return response.json();
}

// ============================================================
// Fetch Trees (via Proxy)
// ============================================================
async function fetchTrees(bbox, signal) {
    const { south, west, north, east } = bbox;
    const url = `${OVERPASS_TREES_URL}?south=${south}&west=${west}&north=${north}&east=${east}`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Trees error: ${response.status}`);
    return response.json();
}

// ============================================================
// Search Handler
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
        // Geocode via proxy
        const geoData = await geocodeCity(query, controller.signal);

        if (geoData.length === 0) {
            cityNameEl.textContent = '❌ City not found';
            treeCountEl.textContent = '';
            parkCountEl.textContent = '';
            alert('City not found. Please try a different name.');
            isSearching = false;
            searchBtn.disabled = false;
            searchBtn.textContent = '🔍 Search';
            return;
        }

        const result = geoData[0];
        const cityName = result.display_name.split(',')[0];
        const lat = parseFloat(result.lat);
        const lng = parseFloat(result.lon);

        // Get bounding box with cap
        let bbox;
        if (result.boundingbox) {
            const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
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

        // Fetch parks and trees via proxy
        await fetchCityData(cityName, bbox, controller.signal);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⏹️ Search cancelled');
            return;
        }
        console.error('Search error:', error);
        let errorMsg = error.message || 'Unknown error';
        if (error.message.includes('timeout') || error.message.includes('504')) {
            errorMsg = 'Request timed out. Try a smaller area.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMsg = 'Network error – check your connection.';
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
// Fetch City Data (Parks + Trees)
// ============================================================
async function fetchCityData(cityName, bbox = currentBbox, signal = null) {
    try {
        parkLayer.clearLayers();
        heatLayer.setLatLngs([]);
        cityNameEl.textContent = `📍 ${cityName}`;
        treeCountEl.textContent = '🌲 Fetching...';
        parkCountEl.textContent = '🌿 Fetching...';

        const [parksData, treesData] = await Promise.all([
            fetchParks(bbox, signal),
            fetchTrees(bbox, signal)
        ]);

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