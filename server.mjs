/*  ah server.mjs */
import express from "express";
import session from "express-session";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import mysql from "mysql2/promise";
import bcrypt from "bcrypt";

const db = await mysql.createPool({
  host: "sp6xl8zoyvbumaa2.cbetxkdyhwsb.us-east-1.rds.amazonaws.com",
  user: "n64n606uw3q2glzl",
  password: "xmwhaylm451i6jlo",
  database: "huc11wckpzagmk50",
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.set("views", join(__dirname, "views"));
app.use(express.static(join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: "wavify-secret-key",
  resave: false,
  saveUninitialized: false
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

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

/* login page */
app.get("/login", (req, res) => {

  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null });
});

/* login submit */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  console.log("LOGIN ATTEMPT:", username);

  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );

    console.log("ROWS:", rows);

    if (rows.length === 0) {
      console.log("NO USER FOUND");
      return res.render("login", { error: "Invalid credentials" });
    }

    const user = rows[0];

    console.log("HASH IN DB:", user.password_hash);

    const match = await bcrypt.compare(password, user.password_hash.trim());

    console.log("PASSWORD MATCH:", match);

    if (!match) {
      console.log("PASSWORD FAILED");
      return res.render("login", { error: "Invalid credentials" });
    }

    req.session.user = {
      id: user.id,
      username: user.username
    };

    res.redirect("/");
  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.render("login", { error: "Server error" });
  }
});

/* logout */
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

/* home page */
app.get("/", requireAuth, async (req, res) => {
  try {
    const [pop, hip, chill, rock, jazz, latin, rnb, country] = await Promise.all([
      iTunesSearch("top pop 2024", "song", 16),
      iTunesSearch("hip hop hits", "song", 10),
      iTunesSearch("chill vibes", "song", 10),
      iTunesSearch("rock hits", "song", 10),
      iTunesSearch("jazz classics", "song", 10),
      iTunesSearch("latin hits", "song", 10),
      iTunesSearch("rnb hits", "song", 10),
      iTunesSearch("country hits", "song", 10),
    ]);

    res.render("index", {
      trending:    pop.map(mapSong),
      newReleases: hip.map(mapSong),
      chillPicks:  chill.map(mapSong),
      rock:        rock.map(mapSong),
      jazz:        jazz.map(mapSong),
      latin:       latin.map(mapSong),
      rnb:         rnb.map(mapSong),
      country:     country.map(mapSong),
      playlists:   getPlaylists().filter(p => p.userId === req.session.user.id),
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
app.get("/search", requireAuth, async (req, res) => {
  const q = req.query.q || "";
  let songs = [];

  if (q) {
    try {
      const results = await iTunesSearch(q, "song", 24);
      songs = results.map(mapSong);
    } catch {}
  }

  res.render("search", {
    songs, q, playlists: getPlaylists().filter(p => p.userId === req.session.user.id) 
  });
});

/* playlist page */
app.get("/playlist/:name", requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name && p.userId === req.session.user.id);
  if (!playlist) return res.redirect("/");
  res.render("playlist", { playlist, playlists: playlists.filter(p => p.userId === req.session.user.id) });
});

/* api search */
app.get("/api/search", requireAuth, async (req, res) => {
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
app.get("/api/playlists", requireAuth, (req, res) => res.json(getPlaylists().filter(p => p.userId === req.session.user.id)));

app.post("/api/playlists", requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Name required" });

  const playlists = getPlaylists();
  if (playlists.find((p) => p.name === name && p.userId === req.session.user.id))
    return res.status(409).json({ error: "Already exists" });

  playlists.push({ name, userId: req.session.user.id, songs: [] });
  savePlaylists(playlists);
  res.json({ ok: true });
});

/* liked songs page */
app.get("/liked", requireAuth, (req, res) => {
  res.render("liked", { playlists: getPlaylists().filter(p => p.userId === req.session.user.id) });
});

app.post("/api/playlists/:name/add", requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name && p.userId === req.session.user.id);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  const song = req.body;
  if (!playlist.songs.some((s) => s.audio === song.audio)) {
    playlist.songs.push(song);
    savePlaylists(playlists);
  }

  res.json({ ok: true });
});

app.put("/api/playlists/:name", requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const oldName = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === oldName && p.userId === req.session.user.id);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  let { name, description, genre } = req.body;
  
  if (name !== undefined) name = name.trim();
  if (!name) return res.status(400).json({ error: "Name cannot be empty" });

  if (name !== oldName && playlists.some((p) => p.name === name && p.userId === req.session.user.id)) {
    return res.status(409).json({ error: "Playlist with this name already exists" });
  }

  playlist.name = name;
  playlist.description = description ? description.trim() : "";
  playlist.genre = genre ? genre.trim() : "";

  savePlaylists(playlists);
  res.json({ ok: true, newName: playlist.name });
});

app.delete("/api/playlists/:name/song/:idx", requireAuth, (req, res) => {
  const playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const playlist = playlists.find((p) => p.name === name && p.userId === req.session.user.id);

  if (!playlist) return res.status(404).json({ error: "Not found" });

  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= playlist.songs.length) {
    return res.status(400).json({ error: "Invalid song index" });
  }

  playlist.songs.splice(idx, 1);
  savePlaylists(playlists);
  res.json({ ok: true });
});

app.delete("/api/playlists/:name", requireAuth, (req, res) => {
  let playlists = getPlaylists();
  const name = decodeURIComponent(req.params.name);
  const initialLength = playlists.length;
  playlists = playlists.filter((p) => !(p.name === name && p.userId === req.session.user.id));
  
  if (playlists.length === initialLength) {
    return res.status(404).json({ error: "Not found" });
  }
  
  savePlaylists(playlists);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`running http://localhost:${PORT}`);
});