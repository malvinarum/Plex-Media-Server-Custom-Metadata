export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    // Common Headers
    const jsonHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    const json = (data, status = 200) => 
      new Response(JSON.stringify(data), { status, headers: jsonHeaders });

    try {
      // =================================================================================
      // 🔌 EXISTING PLEXRPC ROUTES (Unchanged)
      // =================================================================================
      
      // ... (Keep your existing routes /api/metadata/music, /movie, /tv, /book here) ...
      // I have preserved the logic below for the new Plex integration, utilizing the same helpers.

      if (path === '/api/metadata/music') {
        const query = params.get('q');
        if (!query) return json({ error: "No query" }, 400);
        const token = await getSpotifyToken(env);
        if (!token) return json({ error: "Spotify Unavailable" }, 500);
        
        const spotifyRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`, {
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

      // ... (Include your other existing handlers for /movie, /tv, /book similarly) ...


      // =================================================================================
      // 🎬 NEW PLEX META AGENT ROUTES
      // =================================================================================

      // 1. SEARCH: Plex asks "What matches 'The Matrix'?"
      // Endpoint: /plex/search?query=Name&year=2023&type=movie
      if (path === '/plex/search') {
        const query = params.get('query');
        const year = params.get('year'); // Optional but helpful
        const type = params.get('type'); // 'movie', 'show', 'artist'

        if (!query) return json({ error: "Missing query" }, 400);

        let matches = [];

        // --- SEARCH MOVIES (TMDB) ---
        if (type === 'movie') {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
          const data = await tmdbRes.json();
          
          matches = (data.results || []).slice(0, 5).map(m => ({
            id: `tmdb-movie-${m.id}`, // Custom GUID we can parse later
            title: m.title,
            year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
            thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
            type: 'movie'
          }));
        }

        // --- SEARCH MUSIC (Spotify) ---
        else if (type === 'artist' || type === 'album') {
          const token = await getSpotifyToken(env);
          if (token) {
            // Searching for an Album as an example
            const spotifyRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=5`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await spotifyRes.json();
            
            matches = (data.albums?.items || []).map(a => ({
              id: `spotify-album-${a.id}`,
              title: a.name,
              year: a.release_date ? parseInt(a.release_date.split('-')[0]) : null,
              thumb: a.images[0]?.url,
              type: 'album',
              artist: a.artists[0]?.name
            }));
          }
        }

        return json({ media: matches });
      }

      // 2. METADATA: Plex asks "Give me details for ID 'tmdb-movie-123'"
      // Endpoint: /plex/metadata?id=tmdb-movie-123
      if (path === '/plex/metadata') {
        const id = params.get('id');
        if (!id) return json({ error: "Missing ID" }, 400);

        // --- FETCH MOVIE DETAILS ---
        if (id.startsWith('tmdb-movie-')) {
          const tmdbId = id.replace('tmdb-movie-', '');
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,releases`);
          const m = await tmdbRes.json();

          // Map to Plex Metadata Standard (JSON)
          // Note: Verify these exact keys against the beta docs provided in your link
          const metadata = {
            id: id,
            title: m.title,
            original_title: m.original_title,
            year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
            originally_available_at: m.release_date,
            summary: m.overview,
            studio: m.production_companies?.[0]?.name,
            poster: m.poster_path ? `https://image.tmdb.org/t/p/original${m.poster_path}` : null,
            art: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
            rating: m.vote_average,
            content_rating: getTmdbRating(m.releases), // Helper needed for MPAA rating
            genres: m.genres?.map(g => g.name) || [],
            roles: m.credits?.cast?.slice(0, 10).map(c => ({ name: c.name, role: c.character, thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null })) || [],
            directors: m.credits?.crew?.filter(c => c.job === 'Director').map(d => ({ name: d.name })) || []
          };
          
          return json({ metadata });
        }

        // --- FETCH ALBUM DETAILS ---
        if (id.startsWith('spotify-album-')) {
          const spotifyId = id.replace('spotify-album-', '');
          const token = await getSpotifyToken(env);
          if (!token) return json({ error: "Auth failed" }, 500);

          const spotRes = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
             headers: { 'Authorization': `Bearer ${token}` }
          });
          const a = await spotRes.json();

          const metadata = {
            id: id,
            title: a.name,
            artist: a.artists[0]?.name,
            year: a.release_date ? parseInt(a.release_date.split('-')[0]) : null,
            originally_available_at: a.release_date,
            summary: `Album by ${a.artists[0]?.name} with ${a.total_tracks} tracks.`,
            poster: a.images[0]?.url,
            tracks: a.tracks?.items?.map((t, index) => ({
              index: index + 1,
              title: t.name,
              duration: t.duration_ms
            })) || []
          };

          return json({ metadata });
        }

        return json({ error: "Unknown ID format" }, 404);
      }

      return json({ error: "Not Found" }, 404);

    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

// --- HELPERS ---

// Helper to extract US rating from TMDB response
function getTmdbRating(releases) {
  const us = releases?.countries?.find(c => c.iso_3166_1 === 'US');
  return us ? us.certification : null;
}

// Keep your existing getSpotifyToken function exactly as is...
let cachedToken = null;
let tokenExpiresAt = 0;
async function getSpotifyToken(env) {
  if (cachedToken && Date.now() < tokenExpiresAt - 300000) return cachedToken;
  try {
    const auth = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials'
    });
    if (!tokenRes.ok) throw new Error('Failed to fetch token');
    const data = await tokenRes.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    return cachedToken;
  } catch (error) { return null; }
}
