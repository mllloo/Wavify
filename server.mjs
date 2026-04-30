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

// json file where playlists are stored

/* reads playlist data from the json file */
function getPlaylists() {
  try {
    if (!existsSync(PLAYLISTS_FILE)) return [];
    return JSON.parse(readFileSync(PLAYLISTS_FILE, "utf-8"));
  } catch { return []; }
}

/* saves playlist data back to the file */
function savePlaylists(playlists) {
  writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}

/* turns the api song object into the format my app uses */
const mapSong = (s) => ({
  name:   s.trackName   || "Unknown",
  artist: s.artistName  || "Unknown",
  audio:  s.previewUrl  || null,
  image:  s.artworkUrl100 || "",
  album:  s.collectionName || "",
  id:     String(s.trackId || Math.random()),
});

/* helper function to search songs   */
async function iTunesSearch(term, entity = "song", limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=${limit}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results || [];
}

// home page
app.get("/", async (req, res) => {
  try {
    const [pop, hip, chill] = await Promise.all([
      iTunesSearch("top pop 2024", "song", 16),
      iTunesSearch("hip hop hits", "song", 10),
      iTunesSearch("chill vibes", "song", 10),
    ]);
    res.render("index", {
      trending:    pop.map(mapSong),
      newReleases: hip.map(mapSong),
      chillPicks:  chill.map(mapSong),
      playlists:   getPlaylists(),
    });
  } catch (e) {
    console.error(e);
    res.render("index", { trending: [], newReleases: [], chillPicks: [], playlists: [] });
  }
});

// search page
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

// playlist page
app.get("/playlist/:name", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);
  if (!playlist) return res.redirect("/");
  res.render("playlist", { playlist, playlists });
});

// api for live search
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

// playlist api routes
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

app.post("/api/playlists/:name/add", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);
  if (!playlist) return res.status(404).json({ error: "Not found" });
  const song = req.body;
  if (!playlist.songs.some((s) => s.audio === song.audio)) {
    playlist.songs.push(song);
    savePlaylists(playlists);
  }
  res.json({ ok: true });
});

app.delete("/api/playlists/:name/song/:idx", (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name);
  if (!playlist) return res.status(404).json({ error: "Not found" });
  playlist.songs.splice(parseInt(req.params.idx), 1);
  savePlaylists(playlists);
  res.json({ ok: true });
});

/* starts the server */
app.listen(PORT, () => {
  console.log(`\n✓  Wavify is running → http://localhost:${PORT}\n`);
});