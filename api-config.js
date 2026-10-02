// API Configuration for Recast Republic
// For GitHub Pages: set RR_API_BASE_URL in your environment or index.html
// For local development: the backend runs at http://localhost:3000

window.RR_API_BASE_URL = window.RR_API_BASE_URL || 
  (location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : location.hostname === "macsubido29-bit.github.io"
    ? "" // Update this to your production API URL: "https://api.yourdomain.com"
    : "");
