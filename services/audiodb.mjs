const BASE = "https://www.theaudiodb.com/api/v1/json/123";

export async function searchArtists(query) {
  try {
    const r = await fetch(`${BASE}/search.php?s=${encodeURIComponent(query)}`);
    const d = await r.json();
    return (d.artists || []).map(mapArtist);
  } catch { return []; }
}

export async function getArtistInfo(artistName) {
  try {
    const r = await fetch(`${BASE}/search.php?s=${encodeURIComponent(artistName)}`);
    const d = await r.json();
    const a = d.artists?.[0];
    if (!a) return null;
    return mapArtist(a);
  } catch { return null; }
}

export async function getTopTracks(artistName) {
  try {
    const r = await fetch(`${BASE}/track-top10.php?s=${encodeURIComponent(artistName)}`);
    const d = await r.json();
    return (d.track || []).map(t => ({
      name:     t.strTrack,
      album:    t.strAlbum,
      thumb:    t.strTrackThumb,
      musicVid: t.strMusicVid,
      score:    t.intScore,
    }));
  } catch { return []; }
}

export async function getDiscography(artistName) {
  try {
    const r = await fetch(`${BASE}/discography.php?s=${encodeURIComponent(artistName)}`);
    const d = await r.json();
    return (d.album || []).map(a => ({
      name: a.strAlbum,
      year: a.intYearReleased,
    }));
  } catch { return []; }
}

function mapArtist(a) {
  return {
    name:       a.strArtist,
    genre:      a.strGenre,
    mood:       a.strMood,
    country:    a.strCountry,
    biography:  a.strBiographyEN,
    thumb:      a.strArtistThumb,
    fanart:     a.strArtistFanart,
    banner:     a.strArtistBanner,
    logo:       a.strArtistLogo,
    website:    a.strWebsite,
    twitter:    a.strTwitter,
    formedYear: a.intFormedYear,
    members:    a.intMembers,
  };
}
