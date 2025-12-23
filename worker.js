export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const query = url.searchParams.get('q');

    // CORS Headers (Allows your app/browser to talk to this API)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };

    // Helper to return JSON responses
    const json = (data, status = 200) => 
      new Response(JSON.stringify(data), { status, headers: corsHeaders });

    try {
      // --- 🎵 ROUTE: MUSIC (Spotify) ---
      if (path === '/api/metadata/music') {
        if (!query) return json({ error: "No query provided" }, 400);

        const token = await getSpotifyToken(env);
        if (!token) return json({ error: "Service unavailable" }, 500);

        // Spotify Search
        const searchParams = new URLSearchParams({ q: query, type: 'track', limit: '1' });
        
        // FIXED: Real Spotify API Endpoint
        const spotifyRes = await fetch(`https://api.spotify.com/v1/search?${searchParams}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await spotifyRes.json();
        const track = data.tracks?.items?.[0];

        if (track) {
          return json({
            found: true,
            title: track.name,
            artist: track.artists[0].name,
            album: track.album.name,
            image: track.album.images[0]?.url,
            url: track.external_urls.spotify
          });
        }
        return json({ found: false });
      }

      // --- 🎬 ROUTE: MOVIES (TMDB) ---
      if (path === '/api/metadata/movie') {
        if (!query) return json({ found: false });
        
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`);
        const data = await tmdbRes.json();
        const result = data.results?.[0];

        if (result && result.poster_path) {
          return json({
            found: true,
            title: result.title,
            image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
            url: `https://www.themoviedb.org/movie/${result.id}`
          });
        }
        return json({ found: false });
      }

      // --- 📺 ROUTE: TV SHOWS (TMDB) ---
      if (path === '/api/metadata/tv') {
        if (!query) return json({ found: false });

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`);
        const data = await tmdbRes.json();
        const result = data.results?.[0];

        if (result && result.poster_path) {
          return json({
            found: true,
            title: result.name,
            image: `https://image.tmdb.org/t/p/w500${result.poster_path}`,
            url: `https://www.themoviedb.org/tv/${result.id}`
          });
        }
        return json({ found: false });
      }

      // --- 📚 ROUTE: BOOKS (Google Books) ---
      if (path === '/api/metadata/book') {
        if (!query) return json({ found: false });

        // Using GOOGLE_BOOKS_API_KEY to match your Cloudflare dashboard
        const booksRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${env.GOOGLE_BOOKS_API_KEY}&maxResults=1`);
        const data = await booksRes.json();
        const result = data.items?.[0]?.volumeInfo;

        if (result && result.imageLinks?.thumbnail) {
          return json({
            found: true,
            title: result.title,
            // Force HTTPS to prevent mixed content warnings
            image: result.imageLinks.thumbnail.replace('http://', 'https://'),
            url: result.infoLink
          });
        }
        return json({ found: false });
      }

      // --- ⚙️ ROUTE: CONFIG ---
      if (path === '/api/config/discord-id') {
        return json({ client_id: env.DISCORD_CLIENT_ID });
      }

      // 404 for anything else
      return json({ error: "Not Found" }, 404);

    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

// --- 🎵 SPOTIFY TOKEN LOGIC ---
// These variables persist in memory while the worker is hot
let cachedToken = null;
let tokenExpiresAt = 0;

async function getSpotifyToken(env) {
  // Check cache with 5-minute buffer
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) {
    return cachedToken;
  }

  try {
    const auth = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
    
    // FIXED: Real Spotify Token Endpoint
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!tokenRes.ok) throw new Error('Failed to fetch token');

    const data = await tokenRes.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    
    return cachedToken;
  } catch (error) {
    console.error("Spotify Auth Failed:", error);
    return null;
  }
}
