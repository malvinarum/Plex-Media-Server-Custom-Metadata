# Plex Custom Metadata Agent (Cloudflare Worker)

A lightweight, serverless metadata provider for **Plex Media Server** (Beta).

This Cloudflare Worker replaces the need for local python agents by acting as a bridge between Plex and third-party APIs (Spotify, TMDB, Google Books). It provides zero-latency search and metadata matching for Movies, Music, and Audiobooks.

## 🚀 Features

* **🎬 Movie Metadata:** Queries **TMDB** for high-resolution posters, cast lists, directors, and MPAA ratings.
* **🎵 Music Metadata:** Authenticates with **Spotify** to fetch album art, tracklists, and artist info.
* **📖 Audiobook Metadata:** Queries **Google Books** to fetch covers, author info, and summaries (mapped as Artist/Album for Plex compatibility).
* **🔐 Security:** Keeps sensitive API keys (Spotify Secret, TMDB Key) in Cloudflare's secure vault.
* **⚡ Serverless:** Runs on Cloudflare's edge network.

## 🛠️ Prerequisites

* **Node.js** & **NPM** (Required to install Wrangler)
* **Cloudflare Account** (Free tier is sufficient)
* API Keys for:
    * [Spotify for Developers](https://developer.spotify.com/dashboard)
    * [The Movie Database (TMDB)](https://www.themoviedb.org/documentation/api)
    * [Google Books API](https://developers.google.com/books)

## 📥 Deployment

1.  **Install Wrangler (Cloudflare CLI):**
    ```bash
    npm install -g wrangler
    ```

2.  **Login to Cloudflare:**
    ```bash
    wrangler login
    ```

3.  **Configure Secrets:**
    Set the following secrets in your Cloudflare Dashboard (under **Settings -> Variables**) or via the CLI:
    * `SPOTIFY_CLIENT_ID`
    * `SPOTIFY_CLIENT_SECRET`
    * `TMDB_API_KEY`
    * `GOOGLE_BOOKS_API_KEY`

    *To set them via CLI:*
    ```bash
    wrangler secret put TMDB_API_KEY
    # (Repeat for all keys)
    ```

4.  **Deploy:**
    ```bash
    wrangler deploy
    ```

## ⚙️ Configuration in Plex

To use this worker as your metadata source:

1.  Ensure you are running a Plex Media Server version that supports **Custom Metadata Agents**.
2.  Navigate to your Library settings (e.g., "Movies" or "Music/Audiobooks" -> "Edit" -> "Advanced").
3.  Scroll to **Metadata Agent** or **Agent Settings**.
4.  Select **Custom Metadata Provider**.
5.  Enter your Worker's base URL + `/plex` for the provider URL:
    ```text
    https://<your-worker-name>.<your-subdomain>.workers.dev/plex
    ```
6.  Save changes and Refresh Metadata.

## 📡 API Endpoints

This worker exposes the standard Plex Custom Metadata interface:

* `GET /plex/search?query={name}&year={year}&type={movie|artist|album}`
    * Returns a list of matches from TMDB (Movies), Spotify (Music), or Google Books (Audiobooks).
* `GET /plex/metadata?id={guid}`
    * Accepts a GUID (e.g., `tmdb-movie-123` or `google-book-xyz`) and returns the full JSON metadata.

## 📜 License

This project is open-source. Feel free to fork, modify, and distribute.
