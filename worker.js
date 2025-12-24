export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const params = url.searchParams;

    const jsonHeaders = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    const json = (data, status = 200) => 
      new Response(JSON.stringify(data), { status, headers: jsonHeaders });

    // -------------------------------------------------------------------------
    // 1. ROOT MANIFEST (The Handshake)
    // -------------------------------------------------------------------------
    if (path === '/') {
      const AGENT_ID = "tv.plex.agents.custom.pleiades";

      return json({
        MediaProvider: {
          identifier: AGENT_ID,
          title: "Pleiades Metadata",
          version: "1.0.0",
          // 🚨 CRITICAL FIX: Only advertise types 1, 2, 3, 4. 
          // Including 8 (Artist) or 9 (Album) causes "Unsupported metadata types" error.
          Types: [
            { type: 1, Scheme: [{ scheme: AGENT_ID }] }, // Movie
            { type: 2, Scheme: [{ scheme: AGENT_ID }] }, // Show
            { type: 3, Scheme: [{ scheme: AGENT_ID }] }, // Season
            { type: 4, Scheme: [{ scheme: AGENT_ID }] }  // Episode
          ],
          Feature: [
            { type: "search", key: "/search" },
            { type: "metadata", key: "/metadata" },
            { type: "match", key: "/search" } 
          ]
        }
      });
    }

    try {
      const AGENT_ID = "tv.plex.agents.custom.pleiades";

      // -------------------------------------------------------------------------
      // 2. SEARCH & MATCH
      // -------------------------------------------------------------------------
      if (path === '/search' || path === '/plex/search') {
        const query = params.get('query') || params.get('title'); 
        const year = params.get('year');
        const typeStr = params.get('type'); 
        
        // Normalize type
        let type = 'unknown';
        if (typeStr == '1' || typeStr == 'movie') type = 'movie';
        else if (typeStr == '2' || typeStr == 'show') type = 'show';
        // (Music types are hidden from manifest but logic preserved here)
        else if (typeStr == '8' || typeStr == 'artist') type = 'artist';
        else if (typeStr == '9' || typeStr == 'album') type = 'album';

        if (!query) {
          return json({ MediaContainer: { size: 0, identifier: AGENT_ID, Metadata: [] } });
        }

        let matches = [];

        // --- TV SHOWS ---
        if (type === 'show') {
           const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
           const data = await tmdbRes.json();
           
           matches = (data.results || []).slice(0, 5).map(m => ({
             guid: `${AGENT_ID}://show/tmdb-show-${m.id}`,
             type: "show",
             title: m.name,
             year: m.first_air_date ? parseInt(m.first_air_date.split('-')[0]) : null,
             thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
           }));
        }

        // --- MOVIES ---
        else if (type === 'movie') {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${env.TMDB_API_KEY}&query=${encodeURIComponent(query)}&include_adult=false&year=${year || ''}`);
          const data = await tmdbRes.json();
          
          matches = (data.results || []).slice(0, 5).map(m => ({
            guid: `${AGENT_ID}://movie/tmdb-movie-${m.id}`,
            type: "movie",
            title: m.title,
            year: m.release_date ? parseInt(m.release_date.split('-')[0]) : null,
            thumb: m.poster_path ? `https://image.tmdb.org/t/p/w200${m.poster_path}` : null,
           }));
        }

        return json({
          MediaContainer: {
            size: matches.length,
            identifier: AGENT_ID,
            Metadata: matches
          }
        });
      }

      // -------------------------------------------------------------------------
      // 3. METADATA
      // -------------------------------------------------------------------------
      if (path === '/metadata' || path === '/plex/metadata') {
        let id = params.get('ratingKey') || params.get('id') || params.get('guid');
        
        if (id && id.includes('://')) {
            id = id.split('/').pop();
        }

        if (!id) return json({ error: "Missing ID" }, 400);

        let meta = null;

        // --- TV ---
        if (id.startsWith('tmdb-show-')) {
          const tmdbId = id.replace('tmdb-show-', '');
          const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,content_ratings,external_ids,similar`);
          const s = await res.json();
          meta = formatTmdbShow(s, id, AGENT_ID);
        }

        // --- MOVIE ---
        else if (id.startsWith('tmdb-movie-')) {
          const tmdbId = id.replace('tmdb-movie-', '');
          const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${env.TMDB_API_KEY}&append_to_response=credits,releases,external_ids,similar`);
          const m = await res.json();
          meta = formatTmdbMovie(m, id, AGENT_ID);
        }

        if (meta) {
          return json({
            MediaContainer: {
              size: 1,
              identifier: AGENT_ID,
              Metadata: [ meta ]
            }
          });
        }
        
        return json({ MediaContainer: { size: 0, identifier: AGENT_ID, Metadata: [] } });
      }

      return json({ error: "Not Found" }, 404);

    } catch (error) {
      return json({ error: error.message }, 500);
    }
  }
};

// =================================================================================
// 🛠️ HELPERS
// =================================================================================

function formatTmdbMovie(m, key, agentId) {
  const year = m.release_date ? parseInt(m.release_date.split('-')[0]) : null;
  const rating = m.releases?.countries?.find(c => c.iso_3166_1 === 'US')?.certification || 'NR';
  
  return {
    ratingKey: key,
    key: `/metadata?id=${key}`,
    guid: `${agentId}://movie/${key}`,
    type: "movie",
    title: m.title,
    originalTitle: m.original_title,
    summary: m.overview,
    tagline: m.tagline,
    year: year,
    originallyAvailableAt: m.release_date,
    duration: m.runtime ? m.runtime * 60 * 1000 : null,
    contentRating: rating,
    studio: m.production_companies?.[0]?.name,
    thumb: m.poster_path ? `https://image.tmdb.org/t/p/original${m.poster_path}` : null,
    art: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null,
    
    Genre: m.genres?.map(g => ({ tag: g.name })) || [],
    Studio: m.production_companies?.map(c => ({ tag: c.name })) || [],
    Country: m.production_countries?.map(c => ({ tag: c.name })) || [],
    Rating: [{ image: "themoviedb://image.rating", type: "audience", value: m.vote_average }],
    Role: m.credits?.cast?.slice(0, 15).map((c, i) => ({ tag: c.name, role: c.character, thumb: c.profile_path ? `https://image.tmdb.org/t/p/w200${c.profile_path}` : null, order: i+1 })) || [],
    Director: m.credits?.crew?.filter(c => c.job === 'Director').map(d => ({ tag: d.name, role: 'Director' })) || [],
    Image: [
      { type: "coverPoster", url: m.poster_path ? `https://image.tmdb.org/t/p/original${m.poster_path}` : null },
      { type: "background", url: m.backdrop_path ? `https://image.tmdb.org/t/p/original${m.backdrop_path}` : null }
    ].filter(i => i.url)
  };
}

function formatTmdbShow(s, key, agentId) {
  const year = s.first_air_date ? parseInt(s.first_air_date.split('-')[0]) : null;
  const rating = s.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || 'NR';

  return {
    ratingKey: key,
    key: `/metadata?id=${key}`,
    guid: `${agentId}://show/${key}`,
    type: "show",
    title: s.name,
    summary: s.overview,
    year: year,
    originallyAvailableAt: s.first_air_date,
    contentRating: rating,
    studio: s.production_companies?.[0]?.name,
    thumb: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null,
    art: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null,
    Genre: s.genres?.map(g => ({ tag: g.name })) || [],
    Role: s.credits?.cast?.slice(0, 15).map((c, i) => ({ tag: c.name, role: c.character, order: i+1 })) || [],
    Image: [
      { type: "coverPoster", url: s.poster_path ? `https://image.tmdb.org/t/p/original${s.poster_path}` : null },
      { type: "background", url: s.backdrop_path ? `https://image.tmdb.org/t/p/original${s.backdrop_path}` : null }
    ].filter(i => i.url)
  };
}

async function getSpotifyToken(env) {
  // Kept in case you enable Music later or use it for other logic
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
let cachedToken = null;
let tokenExpiresAt = 0;
