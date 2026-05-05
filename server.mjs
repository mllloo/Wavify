/*  ah server.mjs */
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

const mapSong = (s) => ({
  name:   s.trackName   || s.name || "Unknown",
  artist: s.artistName  || s.artist || "Unknown",
  audio:  s.previewUrl  || s.audio || null,
  image:  s.artworkUrl100 || s.image || "",
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

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
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
    const [likedRows] = await db.execute(
      "SELECT audio FROM liked_songs WHERE user_id = ?",
      [req.session.user.id]
    );
    
    const likedSet = new Set(likedRows.map(s => s.audio));
    const playlists = await getUserPlaylists(req.session.user.id);

    res.render("index", {
      trending: pop.map(mapSong),
      newReleases: hip.map(mapSong),
      chillPicks: chill.map(mapSong),
      rock: rock.map(mapSong),
      jazz: jazz.map(mapSong),
      latin: latin.map(mapSong),
      rnb: rnb.map(mapSong),
      country: country.map(mapSong),
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
      playlists: []
    });
  }
});
app.get("/liked", requireAuth, async (req, res) => {
  const [rows] = await db.execute(
    "SELECT * FROM liked_songs WHERE user_id = ?",
    [req.session.user.id]
  );

  const playlists = await getUserPlaylists(req.session.user.id);

  res.render("liked", {
    songs: rows,   
    playlists
  });
});
app.get("/recently-played", requireAuth, async (req, res) => {
  const playlists = await getUserPlaylists(req.session.user.id);

  res.render("recent", { playlists });
});

app.get("/search", requireAuth, async (req, res) => {
  const q = req.query.q || "";
  let songs = [];

  if (q) {
    const results = await iTunesSearch(q, "song", 24);
    songs = results.map(mapSong);
  }

  const playlists = await getUserPlaylists(req.session.user.id);

  res.render("search", { songs, q, playlists });
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

  res.render("playlist", { playlist, playlists });
});



app.get("/api/playlists", requireAuth, async (req, res) => {
  const playlists = await getUserPlaylists(req.session.user.id);
  res.json(playlists);
});

app.post("/api/playlists", requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "Name required" });

  try {
    await db.execute(
      "INSERT INTO playlists (user_id, name) VALUES (?, ?)",
      [req.session.user.id, name]
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Already exists" });
    }
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/artists", (req, res) => {
  res.render("artists", { playlists: getPlaylists() });
});

app.get("/api/artists/search", async (req, res) => {
  const q = req.query.q?.trim();
  if (!q || q.length < 2) return res.json({ artist: null, topTracks: [], discography: [] });
  try {
    const [artist, topTracks, discography] = await Promise.all([
      getArtistInfo(q),
      getTopTracks(q),
      getDiscography(q),
    ]);
    res.json({ artist, topTracks, discography });
  } catch {
    res.json({ artist: null, topTracks: [], discography: [] });
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

  const [rows] = await db.execute(
    "SELECT id FROM playlists WHERE name = ? AND user_id = ?",
    [name, req.session.user.id]
  );

  if (rows.length === 0)
    return res.status(404).json({ error: "Not found" });

  const playlistId = rows[0].id;
  const song = req.body;

  const [existing] = await db.execute(
    "SELECT id FROM songs WHERE playlist_id = ? AND audio = ?",
    [playlistId, song.audio]
  );

  if (existing.length === 0) {
    await db.execute(
      "INSERT INTO songs (playlist_id, name, artist, audio, image) VALUES (?, ?, ?, ?, ?)",
      [playlistId, song.name, song.artist, song.audio, song.image]
    );
  }

  res.json({ ok: true });
});

app.delete("/api/playlists/:name", requireAuth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);

  const [result] = await db.execute(
    "DELETE FROM playlists WHERE name = ? AND user_id = ?",
    [name, req.session.user.id]
  );

  if (result.affectedRows === 0)
    return res.status(404).json({ error: "Not found" });

  res.json({ ok: true });
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
      [
        req.session.user.id,
        song.name,
        song.artist,
        song.audio,
        song.image
      ]
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