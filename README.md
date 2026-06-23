# 🌳 Neighbourhood Green-Space Map

A pure frontend web application that visualizes parks and tree density in any city using OpenStreetMap data, Leaflet.js, and Overpass API.

https://green-space-map-eight.vercel.app/

## ✨ Features

### 🗺️ Map Features
- **Search Any City** – Type any city name and instantly load its green spaces
- **Park Polygons** – Green-filled boundaries of all parks in the area
- **Tree Density Heatmap** – Visualizes tree distribution using a color gradient (green → yellow → red)
- **Layer Toggle** – Show/hide parks and heatmap independently using Leaflet LayerControl
- **Interactive Popups** – Click any park to see its name
- **Dynamic Data Fetching** – Real-time queries to OpenStreetMap via Overpass API

### 🎯 User Experience
- **Instant Search** – Type a city name and press Enter or click Search
- **Loading States** – Visual feedback while fetching data
- **Auto-Retry** – Automatically retries with smaller area if the API times out (504 error)
- **Smart Bounding Box** – Caps area to prevent API timeouts
- **Responsive Design** – Works on desktop, tablet, and mobile

### 📊 Data Features
- **Live OSM Data** – Always up-to-date from OpenStreetMap
- **Park Names** – Shows park names from OSM data
- **Tree Density** – Heatmap gradient (green → yellow → red)
- **City Info** – Displays city name and data counts

## 🛠️ Technologies Used

| Technology | Purpose |
|------------|---------|
| **HTML5** | Page structure |
| **CSS3** | Styling, animations, responsive design |
| **Vanilla JavaScript** | All application logic |
| **Leaflet.js** | Interactive map rendering |
| **Leaflet.heat** | Heatmap plugin for tree density |
| **OpenStreetMap** | Free map tiles |
| **Overpass API** | Querying OSM data (parks & trees) |
| **OSM Nominatim** | Geocoding (city name → coordinates) |

## 📋 Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection (for API calls and map tiles)

**No backend, no database, no API keys needed!**

## 🚀 Installation

### Option 1: Clone the Repository
```bash
git clone https://github.com/yourusername/green-space-map.git
cd green-space-map
