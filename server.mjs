/*  ah server.mjs */
import express from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));
app.use(express.static(join(__dirname, "public")));
app.use(express.json());

const PLAYLISTS_FILE = join(__dirname, "data", "playlists.json");

/* reads playlists */
function getPlaylists() {
  try {
    if (!existsSync(PLAYLISTS_FILE)) return [];
    return JSON.parse(readFileSync(PLAYLISTS_FILE, "utf-8"));
  } catch { return []; }
}

/* saves playlists */
function savePlaylists(playlists) {
  writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}

/* maps api song -> app format */
const mapSong = (s) => ({
  name:   s.trackName   || "Unknown",
  artist: s.artistName  || "Unknown",
  audio:  s.previewUrl  || null,
  image:  s.artworkUrl100 || "",
});

/* itunes search helper */
async function iTunesSearch(term, entity = "song", limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=${limit}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results || [];
}

/* home page */
app.get("/", async (req, res) => {
  try {
    const [pop, hip, chill, rock, jazz, latin, rnb, country] = await Promise.all([
      iTunesSearch("top pop 2024", "song", 16),
      iTunesSearch("hip hop hits", "song", 10),
      iTunesSearch("chill vibes", "song", 10),
      iTunesSearch("rock hits", "song", 10),        // added
      iTunesSearch("jazz classics", "song", 10),    // added
      iTunesSearch("latin hits", "song", 10),       // added
      iTunesSearch("rnb hits", "song", 10),         // added
      iTunesSearch("country hits", "song", 10),     // added
    ]);

    res.render("index", {
      trending:    pop.map(mapSong),
      newReleases: hip.map(mapSong),
      chillPicks:  chill.map(mapSong),
      rock:        rock.map(mapSong),      // added
      jazz:        jazz.map(mapSong),      // added
      latin:       latin.map(mapSong),     // added
      rnb:         rnb.map(mapSong),       // added
      country:     country.map(mapSong),   // added
      playlists:   getPlaylists(),
    });

  } catch {
    res.render("index", {
      trending: [], newReleases: [], chillPicks: [],
      rock: [], jazz: [], latin: [], rnb: [], country: [],
      playlists: []
    });
  }
});

/* search */
app.get("/search", async (req, res) => {
  const q = req.query.q || "";
  let songs = [];

  if (q) {
    try {
      const results = await iTunesSearch(q, "song", 24);
      songs = results.map(mapSong);
    } catch {}
  }

  res.render("search", { songs, q, playlists: getPlaylists() });
});

/* playlist page */
app.get("/playlist/:name", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);
  if (!playlist) return res.redirect("/");
  res.render("playlist", { playlist, playlists });
});

/* api search */
app.get("/api/search", async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json([]);
  try {
    const results = await iTunesSearch(q, "song", 8);
    res.json(results.map(mapSong));
  } catch {
    res.json([]);
  }
});

/* playlists api */
app.get("/api/playlists", (req, res) => res.json(getPlaylists()));

app.post("/api/playlists", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const playlists = getPlaylists();
  if (playlists.find((p) => p.name === name))
    return res.status(409).json({ error: "Already exists" });

  playlists.push({ name, songs: [] });
  savePlaylists(playlists);
  res.json({ ok: true });
});

/* liked songs page */
app.get("/liked", (req, res) => {
  res.render("liked", { playlists: getPlaylists() });
});

app.get("/recently-played", (req, res) => {
  res.render("recent", { playlists: getPlaylists() });
});

app.post("/api/playlists/:name/add", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  const song = req.body;
  if (!playlist.songs.some((s) => s.audio === song.audio)) {
    playlist.songs.push(song);
    savePlaylists(playlists);
    res.json({ ok: true, added: true });
  } else {
    res.json({ ok: true, added: false });
  }
});

app.put("/api/playlists/:name", (req, res) => {
  const playlists = getPlaylists();
  const oldName = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === oldName);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  let { name, description, genre } = req.body;
  
  if (name !== undefined) name = name.trim();
  if (!name) return res.status(400).json({ error: "Name cannot be empty" });

  if (name !== oldName && playlists.some((p) => p.name === name)) {
    return res.status(409).json({ error: "Playlist with this name already exists" });
  }

  playlist.name = name;
  playlist.description = description ? description.trim() : "";
  playlist.genre = genre ? genre.trim() : "";

  savePlaylists(playlists);
  res.json({ ok: true, newName: playlist.name });
});

app.delete("/api/playlists/:name/song/:idx", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= playlist.songs.length) {
    return res.status(400).json({ error: "Invalid song index" });
  }

  playlist.songs.splice(idx, 1);
  savePlaylists(playlists);
  res.json({ ok: true });
});

app.delete("/api/playlists/:name", (req, res) => {
  let playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const initialLength = playlists.length;
  playlists = playlists.filter((p) => p.name !== name);
  
  if (playlists.length === initialLength) {
    return res.status(404).json({ error: "Not found" });
  }
  
  savePlaylists(playlists);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`running http://localhost:${PORT}`);
});