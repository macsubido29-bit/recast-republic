window.RR_API_BASE_URL = window.RR_API_BASE_URL || (
  (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : window.location.origin
);

// If the API lives on a different host, set it explicitly before this script runs:
// window.RR_API_BASE_URL = "https://api.example.com";
