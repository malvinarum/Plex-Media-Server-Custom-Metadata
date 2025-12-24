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
      // 🏥 AGENT MANIFEST (Health Check)
      // =================================================================================
      if (path === '/') {
        return json({
          name: "Pleiades Metadata",
          identifier: "com.pleiades.metadata",
          version: "1.0.0",
          types: ["movie", "show", "artist", "album"]
        });
      }

      // =================================================================================
      // 🎬 SEARCH (Unchanged - returns simple list for matching)
      // =================================================================================
      if (path === '/search' || path === '/plex/search') {
        // ... (Keep your existing search logic from the previous version here) ...
        // I am omitting the full search block for brevity, but YOU MUST KEEP IT.
        // It is identical to the previous working version.
        
        // --- COPY THE SEARCH BLOCK FROM THE PREVIOUS STEP HERE ---
        const query = params.get('query');
        const year = params.get('year');
        const type = params.get('type'); 
        if (!query) return json({ error: "Missing query" }, 400);

        let matches = [];
        
        // (Brief Logic Recap for Context)
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
        } else if (type === 'movie') {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
          const data = await tmdbRes.json();
          matches = (data.results || []).slice(0, 5).map(m => ({
            id: `tmdb-movie-${m.id}`,
            title: m.title,
            year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
            thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
            type: 'movie'
          }));
        } else if (type === 'artist' || type === 'album') {
             // ... (Keep existing Spotify/Book logic) ...
             const token = await getSpotifyToken(env);
             if (token) {
                const spotifyRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=3`, { headers: { 'Authorization': `Bearer ${token}` } });
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
             // ... (Keep Google Books logic) ...
             const booksRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${env.GOOGLE_BOOKS_API_KEY}&maxResults=3`);
             const bookData = await booksRes.json();
             matches.push(...(bookData.items || []).map(b => ({
               id: `google-book-${b.id}`,
               title: b.volumeInfo.title,
               year: b.volumeInfo.publishedDate ? parseInt(b.volumeInfo.publishedDate.split('-')[0]) : null,
               thumb: b.volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://'),
               type: 'album',
               artist: b.volumeInfo.authors ? b.volumeInfo.authors[0] : 'Unknown'
             })));
        }
        return json({ media: matches });
      }

      // =================================================================================
      // 📄 METADATA (Updated to Plex MediaContainer Schema)
      // =================================================================================
      if (path === '/metadata' || path === '/plex/metadata') {
        const id = params.get('id');
        if (!id) return json({ error: "Missing ID" }, 400);

        let meta = null;

        // --- 📺 TV SHOWS (TMDB) ---
        if (id.startsWith('tmdb-show-')) {
          const tmdbId = id.replace('tmdb-show-', '');
          // Added 'external_ids' and 'similar' to fetch
          const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,content_ratings,external_ids,similar`);
          const s = await res.json();
          
          meta = formatTmdbShow(s, id);
        }

        // --- 🎬 MOVIES (TMDB) ---
        else if (id.startsWith('tmdb-movie-')) {
          const tmdbId = id.replace('tmdb-movie-', '');
          const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,releases,external_ids,similar`);
          const m = await res.json();
          
          meta = formatTmdbMovie(m, id);
        }

        // --- 🎵 MUSIC (Spotify) ---
        else if (id.startsWith('spotify-album-')) {
          const spotifyId = id.replace('spotify-album-', '');
          const token = await getSpotifyToken(env);
          const res = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, { headers: { 'Authorization': `Bearer ${token}` } });
          const a = await res.json();

          meta = formatSpotifyAlbum(a, id);
        }

        // --- 📖 BOOKS (Google) ---
        else if (id.startsWith('google-book-')) {
          const bookId = id.replace('google-book-', '');
          const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${bookId}?key=${env.GOOGLE_BOOKS_API_KEY}`);
          const b = await res.json();

          meta = formatGoogleBook(b, id);
        }

        if (meta) {
          // Wrap in MediaContainer
          return json({
            MediaContainer: {
              offset: 0,
              totalSize: 1,
              identifier: "com.pleiades.metadata",
              size: 1,
              Metadata: [ meta ]
            }
          });
        }

        return json({ error: "Unknown ID or Not Found" }, 404);
      }
      
      return json({ error: "Not Found" }, 404);

    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

// =================================================================================
// 🛠️ FORMATTING HELPERS (The heavy lifting)
// =================================================================================

function formatTmdbMovie(m, guid) {
  const year = m.release_date ? parseInt(m.release_date.split('-')[0]) : null;
  const rating = m.releases?.countries?.find(c => c.iso_3166_1 === 'US')?.certification || 'NR';
  
  return {
    guid: guid, // Plex treats this as the unique ID
    type: "movie",
    title: m.title,
    originalTitle: m.original_title,
    summary: m.overview,
    tagline: m.tagline,
    year: year,
    originallyAvailableAt: m.release_date,
    duration: m.runtime ? m.runtime * 60 * 1000 : null, // ms
    contentRating: rating,
    studio: m.production_companies?.[0]?.name,
    thumb: m.poster_path ? `https://image.tmdb.org/t/p/original${m.poster_path}` : null,
    art: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
    
    // Arrays
    Genre: m.genres?.map(g => ({ tag: g.name })) || [],
    Studio: m.production_companies?.map(c => ({ tag: c.name })) || [],
    Country: m.production_countries?.map(c => ({ tag: c.name })) || [],
    
    Rating: [
      { type: "audience", value: m.vote_average, image: "themoviedb://image.rating" }
    ],
    
    Guid: [
      { id: `tmdb://${m.id}` },
      m.external_ids?.imdb_id ? { id: `imdb://${m.external_ids.imdb_id}` } : null
    ].filter(Boolean),

    Role: m.credits?.cast?.slice(0, 15).map((c, index) => ({
      tag: c.name,
      role: c.character,
      thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null,
      order: index + 1
    })) || [],

    Director: m.credits?.crew?.filter(c => c.job === 'Director').map(d => ({
      tag: d.name,
      role: 'Director',
      thumb: d.profile_path ? `https://image.tmdb.org/t/p/w200${d.profile_path}` : null
    })) || [],

    Writer: m.credits?.crew?.filter(c => c.department === 'Writing').slice(0, 3).map(w => ({
      tag: w.name,
      role: 'Writer'
    })) || [],

    Image: [
      { type: "coverPoster", url: m.poster_path ? `https://image.tmdb.org/t/p/original${m.poster_path}` : null },
      { type: "background", url: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null }
    ].filter(i => i.url)
  };
}

function formatTmdbShow(s, guid) {
  const year = s.first_air_date ? parseInt(s.first_air_date.split('-')[0]) : null;
  const rating = s.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || 'NR';

  return {
    guid: guid,
    type: "show",
    title: s.name,
    originalTitle: s.original_name,
    summary: s.overview,
    year: year,
    originallyAvailableAt: s.first_air_date,
    contentRating: rating,
    studio: s.production_companies?.[0]?.name,
    thumb: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
    art: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null,

    Genre: s.genres?.map(g => ({ tag: g.name })) || [],
    Studio: s.production_companies?.map(c => ({ tag: c.name })) || [],
    Country: s.production_countries?.map(c => ({ tag: c.name })) || [],
    
    Rating: [
      { type: "audience", value: s.vote_average, image: "themoviedb://image.rating" }
    ],

    Guid: [
      { id: `tmdb://${s.id}` },
      s.external_ids?.imdb_id ? { id: `imdb://${s.external_ids.imdb_id}` } : null,
      s.external_ids?.tvdb_id ? { id: `tvdb://${s.external_ids.tvdb_id}` } : null
    ].filter(Boolean),

    Role: s.credits?.cast?.slice(0, 15).map((c, index) => ({
      tag: c.name,
      role: c.character,
      thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null,
      order: index + 1
    })) || []
  };
}

function formatSpotifyAlbum(a, guid) {
  return {
    guid: guid,
    type: "album", // or "artist" depending on context, but usually album
    title: a.name,
    summary: `Album by ${a.artists.map(ar => ar.name).join(', ')}. ${a.total_tracks} tracks.`,
    year: a.release_date ? parseInt(a.release_date.split('-')[0]) : null,
    originallyAvailableAt: a.release_date,
    studio: a.label,
    thumb: a.images[0]?.url,
    
    Genre: a.genres?.map(g => ({ tag: g })) || [], // Spotify albums rarely have genres directly, artists do
    Role: a.artists.map((ar, i) => ({
      tag: ar.name,
      role: 'Artist',
      order: i + 1
    })),
    
    Image: [
      { type: "coverPoster", url: a.images[0]?.url }
    ].filter(i => i.url)
  };
}

function formatGoogleBook(b, guid) {
  const info = b.volumeInfo;
  return {
    guid: guid,
    type: "album", // Masquerading as album for Plex Audiobook support
    title: info.title,
    summary: info.description ? info.description.replace(/<[^>]*>?/gm, '') : '',
    year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
    originallyAvailableAt: info.publishedDate,
    studio: info.publisher,
    thumb: info.imageLinks?.thumbnail?.replace('http://', 'https://'),
    
    Genre: info.categories?.map(c => ({ tag: c })) || [],
    Role: info.authors?.map((author, i) => ({
      tag: author,
      role: 'Author',
      order: i + 1
    })) || [],

    Image: [
      { type: "coverPoster", url: info.imageLinks?.thumbnail?.replace('http://', 'https://') }
    ].filter(i => i.url)
  };
}

// --- HELPERS (Token logic remains unchanged) ---
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
