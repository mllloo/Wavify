import express from "express";
import session from "express-session";
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

import { getArtistInfo, getTopTracks, getDiscography } from "./services/audiodb.mjs";

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

async function getUserPlaylists(userId) {
  const [playlists] = await db.execute(
    "SELECT * FROM playlists WHERE user_id = ?",
    [userId]
  );

  for (let p of playlists) {
    const [songs] = await db.execute(
      "SELECT * FROM songs WHERE playlist_id = ?",
      [p.id]
    );
    p.songs = songs;
  }

  return playlists;
}

async function getLikedSet(userId) {
  const [rows] = await db.execute(
    "SELECT audio FROM liked_songs WHERE user_id = ?",
    [userId]
  );
  return new Set(rows.map(r => r.audio));
}

const mapSong = (s) => ({
  name: s.trackName || s.name || "Unknown",
  artist: s.artistName || s.artist || "Unknown",
  audio: s.previewUrl || s.audio || null,
  image: s.artworkUrl100 || s.image || "",
});

async function iTunesSearch(term, entity = "song", limit = 20) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=${entity}&limit=${limit}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results || [];
}

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await db.execute(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );

    if (rows.length === 0)
      return res.render("login", { error: "Invalid credentials" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash.trim());

    if (!match)
      return res.render("login", { error: "Invalid credentials" });

    req.session.user = {
      id: user.id,
      username: user.username
    };

    res.redirect("/");
  } catch (err) {
    console.log(err);
    res.render("login", { error: "Server error" });
  }
});

app.get("/", requireAuth, async (req, res) => {
  try {
    const [
      pop, hip, chill,
      rock, jazz, latin, rnb, country
    ] = await Promise.all([
      iTunesSearch("top pop 2024", "song", 16),
      iTunesSearch("hip hop hits", "song", 10),
      iTunesSearch("chill vibes", "song", 10),
      iTunesSearch("rock hits", "song", 10),
      iTunesSearch("jazz classics", "song", 10),
      iTunesSearch("latin hits", "song", 10),
      iTunesSearch("rnb hits", "song", 10),
      iTunesSearch("country hits", "song", 10),
    ]);

    const likedSet = await getLikedSet(req.session.user.id);
    const playlists = await getUserPlaylists(req.session.user.id);

    res.render("index", {
      trending: pop.map(mapSong),
      newReleases: hip.map(mapSong),
      chillPicks: chill.map(mapSong),
      rock,
      jazz,
      latin,
      rnb,
      country,
      playlists,
      likedSet
    });

  } catch (err) {
    console.log(err);
    res.render("index", {
      trending: [],
      newReleases: [],
      chillPicks: [],
      rock: [],
      jazz: [],
      latin: [],
      rnb: [],
      country: [],
      playlists: [],
      likedSet: new Set()
    });
  }
});

app.get("/liked", requireAuth, async (req, res) => {
  const [rows] = await db.execute(
    "SELECT * FROM liked_songs WHERE user_id = ?",
    [req.session.user.id]
  );

  const playlists = await getUserPlaylists(req.session.user.id);
  const likedSet = await getLikedSet(req.session.user.id);

  res.render("liked", {
    songs: rows,
    playlists,
    likedSet
  });
});

app.get("/recently-played", requireAuth, async (req, res) => {
  const playlists = await getUserPlaylists(req.session.user.id);
  const likedSet = await getLikedSet(req.session.user.id);

  res.render("recent", { playlists, likedSet });
});

app.get("/search", requireAuth, async (req, res) => {
  const q = req.query.q || "";
  let songs = [];

  if (q) {
    const results = await iTunesSearch(q, "song", 24);
    songs = results.map(mapSong);
  }

  const playlists = await getUserPlaylists(req.session.user.id);
  const likedSet = await getLikedSet(req.session.user.id);

  res.render("search", { songs, q, playlists, likedSet });
});

app.get("/playlist/:name", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  const [rows] = await db.execute(
    "SELECT * FROM playlists WHERE name = ? AND user_id = ?",
    [name, req.session.user.id]
  );

  if (rows.length === 0) return res.redirect("/");

  const playlist = rows[0];

  const [songs] = await db.execute(
    "SELECT * FROM songs WHERE playlist_id = ?",
    [playlist.id]
  );

  playlist.songs = songs;

  const playlists = await getUserPlaylists(req.session.user.id);
  const likedSet = await getLikedSet(req.session.user.id);

  res.render("playlist", { playlist, playlists, likedSet });
});

app.post("/api/liked", requireAuth, async (req, res) => {
  const song = req.body;

  try {
    const [existing] = await db.execute(
      "SELECT id FROM liked_songs WHERE user_id = ? AND audio = ?",
      [req.session.user.id, song.audio]
    );

    if (existing.length > 0) {
      await db.execute(
        "DELETE FROM liked_songs WHERE user_id = ? AND audio = ?",
        [req.session.user.id, song.audio]
      );

      return res.json({ ok: true, liked: false });
    }

    await db.execute(
      "INSERT INTO liked_songs (user_id, name, artist, audio, image) VALUES (?, ?, ?, ?, ?)",
      [req.session.user.id, song.name, song.artist, song.audio, song.image]
    );

    res.json({ ok: true, liked: true });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`running http://localhost:${PORT}`);
});