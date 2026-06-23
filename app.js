// ============================================================
// Neighbourhood Green-Space Map - Main Application
// ============================================================

// ============================================================
// Configuration
// ============================================================
const OVERPASS_URL = "/api/overpass";
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Default city (Kozhikode)
let currentCity = 'Kozhikode';
let currentBbox = { south: 11.10, west: 75.60, north: 11.40, east: 76.00 };
let currentCenter = [11.25, 75.78];

// ============================================================
// State
// ============================================================
let map = null;
let parkLayer = null;
let heatLayer = null;
let isSearching = false;
let activeRequest = null; // Track active fetch requests

// ============================================================
// DOM Elements
// ============================================================
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

    // Base tile layer (OSM)
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    // Create layers (empty initially)
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
            layer.bindPopup(`
                <div style="min-width:120px;">
                    <h4 style="margin:0 0 6px 0;">🌳 ${name}</h4>
                    ${feature.properties.area ? `<p style="margin:2px 0;"><strong>Area:</strong> ${(feature.properties.area/10000).toFixed(2)} ha</p>` : ''}
                    <p style="margin:2px 0;font-size:0.8rem;color:#888;">Click for details</p>
                </div>
            `);
        }
    });

    heatLayer = L.heatLayer([], {
        radius: 20,
        blur: 15,
        maxZoom: 17,
        gradient: {
            0.0: '#27ae60',
            0.5: '#f1c40f',
            1.0: '#e74c3c'
        }
    });

    // Layer Control
    const baseMaps = { 'Street Map': osmLayer };
    const overlayMaps = {
        '🌳 Parks': parkLayer,
        '🌲 Tree Density': heatLayer
    };
    L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

    // Add layers to map by default
    parkLayer.addTo(map);
    heatLayer.addTo(map);

    // Load initial data for default city
    fetchCityData(currentCity);

    // Handle search
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleSearch();
    });
}

// ============================================================
// Search Handler - With Request Cancellation
// ============================================================
async function handleSearch() {
    const query = searchInput.value.trim();
    if (!query) return;
    if (isSearching) {
        // If already searching, cancel the previous request
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

    // Create abort controller for this request
    const controller = new AbortController();
    activeRequest = controller;

    try {
        // Geocode city using Nominatim
        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1&polygon_geojson=1`;
        const response = await fetch(url, {
            headers: { 'User-Agent': 'GreenSpaceMap/1.0' },
            signal: controller.signal
        });

        if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`);
        const data = await response.json();

        if (data.length === 0) {
            cityNameEl.textContent = '❌ City not found';
            treeCountEl.textContent = '🌲 No data';
            parkCountEl.textContent = '🌿 No data';
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

        // Get bounding box
        let bbox;
        if (result.boundingbox) {
            const [minLat, maxLat, minLon, maxLon] = result.boundingbox.map(Number);
            bbox = { south: minLat, west: minLon, north: maxLat, east: maxLon };
        } else {
            const delta = 0.05;
            bbox = {
                south: lat - delta,
                west: lng - delta,
                north: lat + delta,
                east: lng + delta
            };
        }

        // Update current info
        currentCity = cityName;
        currentBbox = bbox;
        currentCenter = [lat, lng];

        // Fly map to city center
        map.flyTo([lat, lng], 13);

        // Fetch new data
        await fetchCityData(cityName, bbox, controller.signal);

    } catch (error) {
        // Ignore abort errors (user initiated new search)
        if (error.name === 'AbortError') {
            console.log('⏹️ Search cancelled by user');
            return;
        }
        console.error('Search error:', error);
        cityNameEl.textContent = '❌ Error';
        treeCountEl.textContent = '❌ Failed to load';
        parkCountEl.textContent = '❌ Failed to load';
        // Don't show alert for network errors, just update UI
        if (error.message.includes('Failed to fetch')) {
            // Silent fail for network issues
        } else {
            alert('Error searching for city. Please try again.');
        }
    } finally {
        isSearching = false;
        searchBtn.disabled = false;
        searchBtn.textContent = '🔍 Search';
        activeRequest = null;
    }
}

// ============================================================
// Fetch Parks and Trees for a Given City/Bbox
// ============================================================
async function fetchCityData(cityName, bbox = currentBbox, signal = null) {
    try {
        // Clear existing data
        parkLayer.clearLayers();
        heatLayer.setLatLngs([]);
        cityNameEl.textContent = `📍 ${cityName}`;
        treeCountEl.textContent = '🌲 Fetching...';
        parkCountEl.textContent = '🌿 Fetching...';

        // Fetch parks and trees concurrently with abort support
        let parksData, treesData;
        try {
            [parksData, treesData] = await Promise.all([
                fetchParks(bbox, signal),
                fetchTrees(bbox, signal)
            ]);
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('⏹️ Data fetch cancelled');
                return;
            }
            throw error;
        }

        // Process parks
        let parkFeatures = [];
        if (parksData && parksData.elements && parksData.elements.length > 0) {
            parkFeatures = parksData.elements
                .filter(way => way.geometry && way.geometry.length > 0)
                .map(way => {
                    const coords = way.geometry.map(node => [node.lon, node.lat]);
                    if (coords.length > 0) {
                        coords.push(coords[0]); // close ring
                    }
                    return {
                        type: 'Feature',
                        geometry: {
                            type: 'Polygon',
                            coordinates: [coords]
                        },
                        properties: {
                            name: way.tags?.name || 'Unnamed Park',
                            area: way.tags?.area ? parseFloat(way.tags.area) : null
                        }
                    };
                });
        }

        if (parkFeatures.length > 0) {
            parkLayer.addData({
                type: 'FeatureCollection',
                features: parkFeatures
            });
            parkCountEl.textContent = `🌿 ${parkFeatures.length} parks loaded`;
        } else {
            parkCountEl.textContent = '🌿 No parks found in this area';
        }

        // Process trees
        let points = [];
        if (treesData && treesData.elements && treesData.elements.length > 0) {
            points = treesData.elements.map(node => [
                node.lat,
                node.lon,
                1 // intensity
            ]);
        }

        if (points.length > 0) {
            heatLayer.setLatLngs(points);
            treeCountEl.textContent = `🌲 ${points.length} trees mapped`;
        } else {
            treeCountEl.textContent = '🌲 No trees found in this area';
        }

        console.log(`✅ Loaded ${parkFeatures.length} parks, ${points.length} trees for ${cityName}`);

    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⏹️ Data fetch cancelled');
            return;
        }
        console.error('Error fetching city data:', error);
        parkCountEl.textContent = '❌ Error loading parks';
        treeCountEl.textContent = '❌ Error loading trees';
        throw error;
    }
}

// ============================================================
// Fetch Parks from Overpass
// ============================================================
async function fetchParks(bbox, signal = null) {
    const { south, west, north, east } = bbox;
    const query = `
        [out:json];
        way["leisure"="park"](${south},${west},${north},${east});
        out geom;
    `;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
    
    const options = {
        headers: { 'User-Agent': 'GreenSpaceMap/1.0' }
    };
    if (signal) options.signal = signal;
    
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Parks API error: ${response.status}`);
    return response.json();
}

// ============================================================
// Fetch Trees from Overpass
// ============================================================
async function fetchTrees(bbox, signal = null) {
    const { south, west, north, east } = bbox;
    const query = `
        [out:json];
        node["natural"="tree"](${south},${west},${north},${east});
        out;
    `;
    const url = `${OVERPASS_URL}?data=${encodeURIComponent(query)}`;
    
    const options = {
        headers: { 'User-Agent': 'GreenSpaceMap/1.0' }
    };
    if (signal) options.signal = signal;
    
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`Trees API error: ${response.status}`);
    return response.json();
}

// ============================================================
// Initialize App
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🌳 Green-Space Map initializing...');
    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded');
        return;
    }
    initMap();
});