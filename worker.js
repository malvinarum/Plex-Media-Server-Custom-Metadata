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
      // 🎬 PLEX META AGENT ROUTES
      // =================================================================================

      // 1. SEARCH: Plex asks "What matches 'The Office'?"
      if (path === '/plex/search') {
        const query = params.get('query');
        const year = params.get('year');
        const type = params.get('type'); // 'movie', 'show', 'artist', 'album'

        if (!query) return json({ error: "Missing query" }, 400);

        let matches = [];

        // --- 📺 SEARCH TV SHOWS (TMDB) ---
        // Added this block back so TV libraries work
        if (type === 'show' || type === 'tv') {
           const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
           const data = await tmdbRes.json();
           
           matches = (data.results || []).slice(0, 5).map(m => ({
             id: `tmdb-show-${m.id}`,
             title: m.name,
             year: m.first_air_date ? parseInt(m.first_air_date.split('-')[0]) : null,
             thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
             type: 'show'
           }));
        }

        // --- 🎬 SEARCH MOVIES (TMDB) ---
        else if (type === 'movie') {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
          const data = await tmdbRes.json();
          
          matches = (data.results || []).slice(0, 5).map(m => ({
            id: `tmdb-movie-${m.id}`,
            title: m.title,
            year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
            thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
            type: 'movie'
          }));
        }

        // --- 🎵 SEARCH MUSIC & BOOKS (Spotify + Google Books) ---
        else if (type === 'artist' || type === 'album') {
          // 1. Try Spotify first
          const token = await getSpotifyToken(env);
          if (token) {
            const spotifyRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=3`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await spotifyRes.json();
            
            matches.push(...(data.albums?.items || []).map(a => ({
              id: `spotify-album-${a.id}`,
              title: a.name,
              year: a.release_date ? parseInt(a.release_date.split('-')[0]) : null,
              thumb: a.images[0]?.url,
              type: 'album',
              artist: a.artists[0]?.name
            })));
          }

          // 2. Try Google Books (For Audiobooks)
          // We search if the type is album/book, appending results
          const booksRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${env.GOOGLE_BOOKS_API_KEY}&maxResults=3`);
          const bookData = await booksRes.json();

          matches.push(...(bookData.items || []).map(b => {
             const info = b.volumeInfo;
             return {
               id: `google-book-${b.id}`,
               title: info.title,
               year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
               thumb: info.imageLinks?.thumbnail?.replace('http://', 'https://'),
               type: 'album', // Masquerade as album for Plex
               artist: info.authors ? info.authors[0] : 'Unknown Author'
             };
          }));
        }

        return json({ media: matches });
      }

      // 2. METADATA: Plex asks "Give me details for ID 'tmdb-show-99'"
      if (path === '/plex/metadata') {
        const id = params.get('id');
        if (!id) return json({ error: "Missing ID" }, 400);

        // --- 📺 FETCH TV DETAILS (TMDB) ---
        if (id.startsWith('tmdb-show-')) {
          const tmdbId = id.replace('tmdb-show-', '');
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,content_ratings`);
          const s = await tmdbRes.json();

          // Helper to get TV rating (e.g. TV-MA)
          const rating = s.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating;

          return json({
             metadata: {
               id: id,
               title: s.name,
               original_title: s.original_name,
               year: s.first_air_date ? parseInt(s.first_air_date.split('-')[0]) : null,
               originally_available_at: s.first_air_date,
               summary: s.overview,
               studio: s.production_companies?.[0]?.name,
               poster: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
               art: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null,
               rating: s.vote_average,
               content_rating: rating,
               genres: s.genres?.map(g => g.name) || [],
               roles: s.credits?.cast?.slice(0, 10).map(c => ({ 
                 name: c.name, 
                 role: c.character, 
                 thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null 
               })) || []
             }
          });
        }

        // --- 🎬 FETCH MOVIE DETAILS (TMDB) ---
        if (id.startsWith('tmdb-movie-')) {
          const tmdbId = id.replace('tmdb-movie-', '');
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,releases`);
          const m = await tmdbRes.json();

          return json({
             metadata: {
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
                content_rating: getTmdbRating(m.releases),
                genres: m.genres?.map(g => g.name) || [],
                roles: m.credits?.cast?.slice(0, 10).map(c => ({ 
                  name: c.name, 
                  role: c.character, 
                  thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null 
                })) || [],
                directors: m.credits?.crew?.filter(c => c.job === 'Director').map(d => ({ name: d.name })) || []
             }
          });
        }

        // --- 🎵 FETCH ALBUM DETAILS (Spotify) ---
        if (id.startsWith('spotify-album-')) {
          const spotifyId = id.replace('spotify-album-', '');
          const token = await getSpotifyToken(env);
          if (!token) return json({ error: "Auth failed" }, 500);

          const spotRes = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
             headers: { 'Authorization': `Bearer ${token}` }
          });
          const a = await spotRes.json();

          return json({
             metadata: {
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
             }
          });
        }

        // --- 📖 FETCH BOOK DETAILS (Google Books) ---
        if (id.startsWith('google-book-')) {
          const bookId = id.replace('google-book-', '');
          const bookRes = await fetch(`https://www.googleapis.com/books/v1/volumes/${bookId}?key=${env.GOOGLE_BOOKS_API_KEY}`);
          const b = await bookRes.json();
          const info = b.volumeInfo;

          return json({
             metadata: {
                id: id,
                title: info.title,
                artist: info.authors ? info.authors[0] : 'Unknown', 
                year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
                originally_available_at: info.publishedDate,
                summary: info.description ? info.description.replace(/<[^>]*>?/gm, '') : '',
                poster: info.imageLinks?.thumbnail?.replace('http://', 'https://'),
                studio: info.publisher,
                genres: info.categories || [],
                tracks: [] 
             }
          });
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

function getTmdbRating(releases) {
  const us = releases?.countries?.find(c => c.iso_3166_1 === 'US');
  return us ? us.certification : null;
}

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
