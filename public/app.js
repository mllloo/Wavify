/* Main client-side JavaScript for Wavify */

/* keeps track of the player state */
const S = {
  queue:         [],
  currentIndex:  -1,
  isPlaying:     false,
  isShuffle:     false,
  repeatMode:    0, // 0=off 1=all 2=one
  isMuted:       false,
  volume:        parseFloat(localStorage.getItem('wv_vol') ?? '0.7'),
  favorites:     JSON.parse(localStorage.getItem('wv_favs')   ?? '[]'),
  recent:        JSON.parse(localStorage.getItem('wv_recent') ?? '[]'),
};

/* audio object */
const audio = new Audio();
audio.volume = S.volume;

const PLAYBACK_STATE_KEY = 'wv_playback_state';

/* helper functions */
function songFromEl(el) {
  return {
    name:   el.dataset.name   || '',
    artist: el.dataset.artist || '',
    audio:  el.dataset.audio  || '',
    image:  el.dataset.image  || '',
  };
}

function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function qs(sel, ctx = document)  { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

/* functions for playing songs */
function playSongWithQueue(song, queue, index) {
  S.queue        = queue;
  S.currentIndex = index;
  _loadAndPlay(song);
  _savePlaybackState();
}

function playSong(song) {
  S.queue        = [song];
  S.currentIndex = 0;
  _loadAndPlay(song);
  _savePlaybackState();
}

function _loadAndPlay(song) {
  if (!song.audio) {
    showToast('No preview available for this track');
    return;
  }

  audio.src     = song.audio;
  S.isPlaying   = true;

  audio.play().catch(() => {
    S.isPlaying = false;
    _updatePlayBtn();
  });

  _updatePlayerUI(song);
  _updatePlayBtn();
  _setDynamicBg(song.image);
  _addToRecent(song);
  _markActiveCard(song);
  renderQueue();
  _savePlaybackState();
}

function togglePlay() {
  if (!S.queue.length) return;

  if (S.isPlaying) {
    audio.pause();
    S.isPlaying = false;
  } else {
    audio.play();
    S.isPlaying = true;
  }

  _updatePlayBtn();
  _savePlaybackState();
}

function nextSong() {
  if (!S.queue.length) return;

  if (S.repeatMode === 2) {
    audio.currentTime = 0;
    audio.play();
    return;
  }

  let next = S.currentIndex + 1;

  if (S.isShuffle) next = Math.floor(Math.random() * S.queue.length);

  if (next >= S.queue.length) {
    if (S.repeatMode === 1) next = 0;
    else {
      audio.pause();
      S.isPlaying = false;
      _updatePlayBtn();
      return;
    }
  }

  S.currentIndex = next;
  _loadAndPlay(S.queue[next]);
  _savePlaybackState();
}

function prevSong() {
  if (!S.queue.length) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  let prev = S.currentIndex - 1;
  if (prev < 0) prev = S.repeatMode === 1 ? S.queue.length - 1 : 0;

  S.currentIndex = prev;
  _loadAndPlay(S.queue[prev]);
  _savePlaybackState();
}

/* audio event listeners */
audio.addEventListener('ended', nextSong);

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;

  const pct = (audio.currentTime / audio.duration) * 100;
  _setProgressUI(pct);

  const cur = qs('#time-current');
  if (cur) cur.textContent = fmtTime(audio.currentTime);

  _savePlaybackState();
});

audio.addEventListener('loadedmetadata', () => {
  const tot = qs('#time-total');
  if (tot) tot.textContent = fmtTime(audio.duration);
});

audio.addEventListener('play', () => {
  S.isPlaying = true;
  _updatePlayBtn();
  _savePlaybackState();
});

audio.addEventListener('pause', () => {
  S.isPlaying = false;
  _updatePlayBtn();
  _savePlaybackState();
});

/* updates player ui */
function _updatePlayerUI(song) {
  const title  = qs('#player-title');
  const artist = qs('#player-artist');
  const img    = qs('#player-img');
  const wrap   = qs('#player-thumb-wrap');

  if (title)  title.textContent  = song.name   || '—';
  if (artist) artist.textContent = song.artist || '—';
  if (img)    img.src            = song.image  || '';

  if (wrap) wrap.classList.toggle('is-playing', S.isPlaying);

  const npTitle  = qs('#np-title');
  const npArtist = qs('#np-artist');
  const npImg    = qs('#np-img');

  if (npTitle)  npTitle.textContent  = song.name || '';
  if (npArtist) npArtist.textContent = song.artist || '';
  if (npImg)    npImg.src            = song.image?.replace('100x100', '400x400') || '';

  _syncHeartBtn(song);
}

function _updatePlayBtn() {
  const btn  = qs('#play-pause-btn');
  const wrap = qs('#player-thumb-wrap');

  if (!btn) return;

  if (S.isPlaying) {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
  } else {
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  }

  if (wrap) wrap.classList.toggle('is-playing', S.isPlaying);
}

function _setProgressUI(pct) {
  const fill  = qs('#progress-fill');
  const thumb = qs('#progress-thumb');

  if (fill)  fill.style.width = pct + '%';
  if (thumb) thumb.style.left  = pct + '%';
}

function _markActiveCard(song) {
  qsa('.song-card.is-playing').forEach(c => c.classList.remove('is-playing'));
  qsa('.playlist-track.is-playing').forEach(c => c.classList.remove('is-playing'));

  qsa('.song-card[data-audio]').forEach(c => {
    if (c.dataset.audio === song.audio) c.classList.add('is-playing');
  });

  qsa('.playlist-track[data-audio]').forEach(c => {
    if (c.dataset.audio === song.audio) c.classList.add('is-playing');
  });
}

/* progress bar dragging */
let _seekDragging = false;
let _volDragging  = false;

function _initProgressBar() {
  const bar = qs('#progress-bar');
  if (!bar) return;

  bar.addEventListener('mousedown', e => {
    _seekDragging = true;
    bar.classList.add('is-dragging');
    _doSeek(e);
  });
}

function _doSeek(e) {
  const bar = qs('#progress-bar');
  if (!bar || !audio.duration) return;

  const rect = bar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  audio.currentTime = pct * audio.duration;
  _setProgressUI(pct * 100);
}

/* volume bar stuff */
function _initVolumeBar() {
  const bar = qs('#volume-bar');
  if (!bar) return;

  bar.addEventListener('mousedown', e => {
    _volDragging = true;
    _doVolume(e);
  });

  _setVolumeUI(S.volume);
}

function _doVolume(e) {
  const bar = qs('#volume-bar');
  if (!bar) return;

  const rect = bar.getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  S.volume     = pct;
  audio.volume = pct;
  S.isMuted    = pct === 0;

  localStorage.setItem('wv_vol', pct);
  _setVolumeUI(pct);
}

function _setVolumeUI(pct) {
  const fill  = qs('#volume-fill');
  const thumb = qs('#volume-thumb');

  if (fill)  fill.style.width = (pct * 100) + '%';
  if (thumb) thumb.style.left = (pct * 100) + '%';

  _updateVolumeIcon(pct);
}

function _updateVolumeIcon(pct) {
  const icon = qs('#volume-icon-svg');
  if (!icon) return;

  if (pct === 0) {
    icon.innerHTML = '<path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06A8.99 8.99 0 0 0 15.73 19l2 2L19 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
  } else if (pct < 0.5) {
    icon.innerHTML = '<path d="M18.5 12A4.5 4.5 0 0 0 16 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/>';
  } else {
    icon.innerHTML = '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
  }
}

document.addEventListener('mousemove', e => {
  if (_seekDragging) _doSeek(e);
  if (_volDragging)  _doVolume(e);
});

document.addEventListener('mouseup', () => {
  if (_seekDragging) {
    _seekDragging = false;
    qs('#progress-bar')?.classList.remove('is-dragging');
  }

  _volDragging = false;
});

/* mute button */
function toggleMute() {
  S.isMuted   = !S.isMuted;
  audio.muted = S.isMuted;

  const vol = S.isMuted ? 0 : S.volume;
  _setVolumeUI(vol);
}

/* shuffle and repeat */
function toggleShuffle() {
  S.isShuffle = !S.isShuffle;
  qs('#btn-shuffle')?.classList.toggle('active', S.isShuffle);
  showToast(S.isShuffle ? 'Shuffle on' : 'Shuffle off');
}

function toggleRepeat() {
  S.repeatMode = (S.repeatMode + 1) % 3;

  const btn = qs('#btn-repeat');
  if (!btn) return;

  btn.classList.toggle('active', S.repeatMode > 0);

  const modes = ['Repeat off', 'Repeat all', 'Repeat one'];
  showToast(modes[S.repeatMode]);

  if (S.repeatMode === 2) {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>`;
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>`;
  }
}

/* changes the background image */
function _setDynamicBg(imageUrl) {
  const bg = qs('#dynamic-bg');
  if (!bg || !imageUrl) return;

  bg.style.backgroundImage = `url(${imageUrl.replace('100x100', '400x400')})`;
}

/* liked songs */
function isFavorite(song) {
  return S.favorites.some(f => f.audio === song.audio);
}

function toggleFavorite(song) {
  if (!song.audio) return;

  if (isFavorite(song)) {
    S.favorites = S.favorites.filter(f => f.audio !== song.audio);
    showToast('Removed from Liked Songs');
  } else {
    S.favorites.unshift(song);
    showToast('Added to Liked Songs ♥');
  }

  localStorage.setItem('wv_favs', JSON.stringify(S.favorites));

  _syncHeartBtn(song);
  _syncLikeButtons();
  _syncLikedCount();
}

function toggleCurrentFavorite() {
  if (S.currentIndex < 0) return;
  toggleFavorite(S.queue[S.currentIndex]);
}

function _syncHeartBtn(song) {
  const btn = qs('#player-heart-btn');
  if (!btn || !song) return;

  btn.classList.toggle('liked', isFavorite(song));
}

function _syncLikeButtons() {
  qsa('.song-card-like').forEach(btn => {
    const audio = btn.dataset.audio;
    const liked = audio && S.favorites.some(f => f.audio === audio);

    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    btn.title = liked ? 'Remove from Liked Songs' : 'Add to Liked Songs';
  });
}

function _syncPlaylistPickerMarks() {
  const song = _pickerSong;

  qsa('.playlist-picker-option[data-song-audios]').forEach(btn => {
    let audios = [];

    try {
      audios = JSON.parse(decodeURIComponent(btn.dataset.songAudios || ''));
    } catch {
      audios = [];
    }

    const hasSong = !!song?.audio && audios.includes(song.audio);
    btn.classList.toggle('has-song', hasSong);
  });
}

function _syncLikedCount() {
  const countEl = qs('#liked-count');
  if (countEl) {
    countEl.textContent = S.favorites.length;
  }
}

function _savePlaybackState() {
  if (!S.queue.length || S.currentIndex < 0 || !S.queue[S.currentIndex]) return;

  localStorage.setItem(PLAYBACK_STATE_KEY, JSON.stringify({
    queue: S.queue,
    currentIndex: S.currentIndex,
    currentTime: audio.currentTime || 0,
    isPlaying: S.isPlaying,
  }));
}

function _restorePlaybackState() {
  let saved = null;

  try {
    saved = JSON.parse(localStorage.getItem(PLAYBACK_STATE_KEY) || 'null');
  } catch {
    saved = null;
  }

  if (!saved || !Array.isArray(saved.queue) || !saved.queue.length) return;

  S.queue = saved.queue;
  S.currentIndex = Math.min(Math.max(parseInt(saved.currentIndex || 0, 10), 0), S.queue.length - 1);
  S.isPlaying = !!saved.isPlaying;

  const song = S.queue[S.currentIndex];
  if (!song || !song.audio) return;

  audio.volume = S.volume;
  audio.muted = S.isMuted;
  audio.src = song.audio;

  const restore = () => {
    if (saved.currentTime > 0 && !isNaN(audio.duration)) {
      audio.currentTime = Math.min(saved.currentTime, Math.max(audio.duration - 0.25, 0));
    }

    _updatePlayerUI(song);
    _updatePlayBtn();
    _setDynamicBg(song.image);
    _markActiveCard(song);
    renderQueue();

    if (S.isPlaying) {
      audio.play().catch(() => {});
    }
  };

  if (audio.readyState >= 1) {
    restore();
  } else {
    audio.addEventListener('loadedmetadata', restore, { once: true });
  }
}

/* recently played */
function _addToRecent(song) {
  if (!song.audio) return;

  S.recent = S.recent.filter(r => r.audio !== song.audio);
  S.recent.unshift(song);

  if (S.recent.length > 30) S.recent.pop();

  localStorage.setItem('wv_recent', JSON.stringify(S.recent));
}

/* queue panel */
function toggleQueue() {
  const panel    = qs('#queue-panel');
  const backdrop = qs('#queue-backdrop');

  if (!panel) return;

  const open = panel.classList.toggle('open');

  backdrop?.classList.toggle('open', open);
  qs('#btn-queue')?.classList.toggle('active', open);
}

function renderQueue() {
  const list = qs('#queue-list');
  if (!list) return;

  list.innerHTML = '';

  if (!S.queue.length) {
    list.innerHTML = '<p style="padding:16px;color:var(--text-dim);font-size:0.85rem">Queue is empty</p>';
    return;
  }

  S.queue.forEach((song, i) => {
    const item = document.createElement('div');
    item.className = 'queue-item' + (i === S.currentIndex ? ' active' : '');

    item.innerHTML = `
      <img src="${song.image}" alt="" />
      <div class="queue-item-info">
        <p class="queue-item-name">${escHtml(song.name)}</p>
        <p class="queue-item-artist">${escHtml(song.artist)}</p>
      </div>
      ${i === S.currentIndex ? '<div class="queue-item-active-dot"></div>' : ''}
    `;

    item.addEventListener('click', () => {
      S.currentIndex = i;
      _loadAndPlay(song);
    });

    list.appendChild(item);
  });
}

function escHtml(str) {
  return (str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* now playing popup */
function openNpModal() {
  qs('#np-modal')?.classList.add('open');
}

function closeNpModal() {
  qs('#np-modal')?.classList.remove('open');
}

/* recent and liked popup */
function showRecentOverlay() {
  _openOverlay('Recently Played', S.recent);
}

function showLikedOverlay() {
  _openOverlay('Liked Songs', S.favorites);
}

function _openOverlay(title, songs) {
  const panel   = qs('#overlay-panel');
  const titleEl = qs('#overlay-title');
  const list    = qs('#overlay-list');

  if (!panel || !list) return;

  if (titleEl) titleEl.textContent = title;

  list.innerHTML = '';

  if (!songs.length) {
    list.innerHTML = `<p style="padding:24px;color:var(--text-dim);text-align:center;font-size:0.88rem">Nothing here yet</p>`;
  } else {
    songs.forEach((song, i) => {
      const item = document.createElement('div');
      item.className = 'queue-item';

      item.innerHTML = `
        <img src="${song.image}" alt="" />
        <div class="queue-item-info">
          <p class="queue-item-name">${escHtml(song.name)}</p>
          <p class="queue-item-artist">${escHtml(song.artist)}</p>
        </div>
      `;

      item.addEventListener('click', () => {
        playSongWithQueue(song, songs, i);
        closeOverlay();
      });

      list.appendChild(item);
    });
  }

  panel.classList.add('open');
}

function closeOverlay() {
  qs('#overlay-panel')?.classList.remove('open');
}

/* carousel code */
function initCarousel(wrapper) {
  //if (!wrapper) return;
  if (!wrapper || wrapper.dataset.carouselReady === 'true') return;
  wrapper.dataset.carouselReady = 'true';

  const track   = qs('.carousel-track', wrapper);
  const dotsEl  = qs('.carousel-dots', wrapper);
  const prevBtn = qs('.carousel-btn-prev', wrapper);
  const nextBtn = qs('.carousel-btn-next', wrapper);
  const cards   = qsa('.carousel-card', wrapper);

  if (!track || !cards.length) return;

  let currentIdx       = 0;
  let isDragging       = false;
  let dragStartX       = 0;
  let dragScrollStart  = 0;
  let autoTimer        = null;

  // prevent duplicate dots
  if (dotsEl) dotsEl.innerHTML = '';

  // make dots
  if (dotsEl) {
    cards.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');

      dot.addEventListener('click', e => {
        e.stopPropagation();
        clearAuto();
        goTo(i);
        startAuto();
      });

      dotsEl.appendChild(dot);
    });
  }

  function getCardW() {
    const gap = parseFloat(getComputedStyle(track).gap) || 14;
    return cards[0].offsetWidth + gap;
  }

  function goTo(idx, smooth = true) {
    currentIdx = ((idx % cards.length) + cards.length) % cards.length;

    track.scrollTo({
      left: currentIdx * getCardW(),
      behavior: smooth ? 'smooth' : 'auto'
    });

    syncDots();
  }

  function syncDots() {
    if (!dotsEl) return;

    qsa('.carousel-dot', dotsEl).forEach((d, i) => {
      d.classList.toggle('active', i === currentIdx);
    });
  }

  prevBtn?.addEventListener('click', e => {
    e.stopPropagation();
    clearAuto();
    goTo(currentIdx - 1);
    startAuto();
  });

  nextBtn?.addEventListener('click', e => {
    e.stopPropagation();
    clearAuto();
    goTo(currentIdx + 1);
    startAuto();
  });

  // click card to play
  cards.forEach((card, idx) => {
    card.addEventListener('click', () => {
      if (isDragging) return;

      const song = songFromEl(card);
      const allSongs = cards.map(c => songFromEl(c));

      playSongWithQueue(song, allSongs, idx);
    });
  });

  // mouse dragging
  track.addEventListener('mousedown', e => {
    isDragging       = false;
    dragStartX       = e.pageX;
    dragScrollStart  = track.scrollLeft;

    track.style.scrollBehavior = 'auto';
    track.style.scrollSnapType = 'none';
    track.classList.add('is-dragging');

    clearAuto();
  });

  track.addEventListener('mousemove', e => {
    if (!track.classList.contains('is-dragging')) return;

    const dx = e.pageX - dragStartX;

    if (Math.abs(dx) > 4) {
      isDragging = true;
      track.scrollLeft = dragScrollStart - dx;
    }
  });

  function endDrag() {
    if (!track.classList.contains('is-dragging')) return;

    track.classList.remove('is-dragging');
    track.style.scrollBehavior = '';
    track.style.scrollSnapType = '';

    const nearest = Math.round(track.scrollLeft / getCardW());
    goTo(Math.max(0, Math.min(nearest, cards.length - 1)));

    setTimeout(() => {
      isDragging = false;
    }, 0);

    startAuto();
  }

  track.addEventListener('mouseup', endDrag);
  track.addEventListener('mouseleave', endDrag);

  // phone support
  track.addEventListener('touchstart', e => {
    dragStartX      = e.touches[0].pageX;
    dragScrollStart = track.scrollLeft;

    track.style.scrollBehavior = 'auto';
    clearAuto();
  }, { passive: true });

  track.addEventListener('touchend', () => {
    const nearest = Math.round(track.scrollLeft / getCardW());
    goTo(Math.max(0, Math.min(nearest, cards.length - 1)));
    startAuto();
  }, { passive: true });

  // keep dots updated
  track.addEventListener('scroll', () => {
    const idx = Math.round(track.scrollLeft / getCardW());

    if (idx !== currentIdx && idx >= 0 && idx < cards.length) {
      currentIdx = idx;
      syncDots();
    }
  }, { passive: true });

  function startAuto() {
    clearAuto();
    autoTimer = setInterval(() => goTo(currentIdx + 1), 5000);
  }

  function clearAuto() {
    clearInterval(autoTimer);
  }

  wrapper.addEventListener('mouseenter', clearAuto);
  wrapper.addEventListener('mouseleave', startAuto);

  startAuto();
}

/* live search */
function initSearch() {
  const input    = qs('#searchInput');
  const dropdown = qs('#searchDropdown');

  if (!input || !dropdown) return;

  let debounceTimer = null;
  let searchResults = [];
  let selectedIdx   = -1;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);

    // Reveal the top search bar on first keystroke (home page)
    const wrap = document.getElementById('topbar-search-wrap');
    if (wrap && input.value.trim()) wrap.classList.remove('is-hidden');

    const q = input.value.trim();

    if (!q) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.innerHTML = '<div class="search-loading">Searching…</div>';
    dropdown.style.display = 'block';

    debounceTimer = setTimeout(() => fetchSearch(q), 280);
  });

  async function fetchSearch(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      searchResults = await res.json();
      renderDropdown();
    } catch {
      dropdown.style.display = 'none';
    }
  }

  function renderDropdown() {
    if (!searchResults.length) {
      dropdown.innerHTML = '<div class="search-loading">No results</div>';
      return;
    }

    dropdown.innerHTML = searchResults.map((s, i) => `
      <div class="search-item" data-idx="${i}">
        <img src="${s.image || ''}" alt="" />
        <div class="search-item-info">
          <p class="search-item-name">${escHtml(s.name)}</p>
          <p class="search-item-artist">${escHtml(s.artist)}${!s.audio ? '<span class="search-item-no-preview"> · No preview</span>' : ''}</p>
        </div>
      </div>
    `).join('');

    dropdown.style.display = 'block';
    selectedIdx = -1;

    qsa('.search-item', dropdown).forEach((el, i) => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        playFromSearch(i);
      });
    });
  }

  function playFromSearch(i) {
    const song = searchResults[i];
    if (!song) return;

    playSongWithQueue(song, searchResults, i);

    dropdown.style.display = 'none';
    input.value = '';
  }

  input.addEventListener('keydown', e => {
    const items = qsa('.search-item', dropdown);

    if (e.key === 'ArrowDown') {
      e.preventDefault();

      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));

    } else if (e.key === 'ArrowUp') {
      e.preventDefault();

      selectedIdx = Math.max(selectedIdx - 1, -1);
      items.forEach((el, i) => el.classList.toggle('selected', i === selectedIdx));

    } else if (e.key === 'Enter') {
      if (selectedIdx >= 0) {
        e.preventDefault();
        playFromSearch(selectedIdx);
      } else if (input.value.trim()) {
        e.preventDefault();
        // Navigate to search page if the input is not inside a form
        const form = input.closest('form');
        if (form) {
          form.submit();
        } else {
          window.location.href = '/search?q=' + encodeURIComponent(input.value.trim());
        }
      }
      // if no item selected, let the form submit naturally (for search page)

    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

/* click events for cards */
function initSongCards() {
  const groups = {};

  qsa('.song-card[data-queue-group]').forEach(card => {
    const g = card.dataset.queueGroup;

    if (!groups[g]) groups[g] = [];
    groups[g].push(card);
  });

  qsa('.song-card').forEach(card => {
    card.addEventListener('click', e => {
      // dont play when buttons clicked
      if (e.target.closest('.song-card-like')) return;
      if (e.target.closest('.song-card-add')) return;
      
      // prevent click if we were dragging
      const track = card.closest('.song-row-scroll');
      if (track && track.classList.contains('was-dragging')) return;

      const song = songFromEl(card);
      const g    = card.dataset.queueGroup;

      if (g && groups[g]) {
        const groupSongs = groups[g].map(c => songFromEl(c));
        const idxInGroup = groups[g].indexOf(card);

        playSongWithQueue(song, groupSongs, idxInGroup);
      } else {
        playSong(song);
      }

      addRipple(card, e);
    });

    const likeBtn = qs('.song-card-like', card);

    if (likeBtn) {
      likeBtn.addEventListener('click', e => {
        e.stopPropagation();

        const song = songFromEl(card);
        toggleFavorite(song);
      });
    }

    const addBtn = qs('.song-card-add', card);

    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.stopPropagation();

        const song = songFromEl(card);
        openPlaylistPicker(song, e);
      });
    }
  });

  const pGroups = {};

  qsa('.playlist-track[data-queue-group]').forEach(track => {
    const g = track.dataset.queueGroup;

    if (!pGroups[g]) pGroups[g] = [];
    pGroups[g].push(track);
  });

  qsa('.playlist-track').forEach(track => {
    track.addEventListener('click', e => {
      if (e.target.closest('.track-actions')) return;

      const song = songFromEl(track);
      const g    = track.dataset.queueGroup;

      if (g && pGroups[g]) {
        const groupSongs = pGroups[g].map(c => songFromEl(c));
        const idx        = pGroups[g].indexOf(track);

        playSongWithQueue(song, groupSongs, idx);
      } else {
        playSong(song);
      }
    });

    const likeBtn = qs('.song-card-like', track);

    if (likeBtn) {
      likeBtn.addEventListener('click', e => {
        e.stopPropagation();

        const song = songFromEl(track);
        toggleFavorite(song);
      });
    }

    const addBtn = qs('.song-card-add', track);

    if (addBtn) {
      addBtn.addEventListener('click', e => {
        e.stopPropagation();

        const song = songFromEl(track);
        openPlaylistPicker(song, e);
      });
    }
  });
}

/* small ripple */
function addRipple(el, e) {
  el.classList.add('ripple-host');

  const rect   = el.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');

  ripple.className = 'ripple';
  ripple.style.cssText = `
    width:${size}px; height:${size}px;
    left:${e.clientX - rect.left - size / 2}px;
    top:${e.clientY - rect.top - size / 2}px;
  `;

  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

/* toast */
let _toastTimer = null;

function showToast(msg) {
  const t = qs('#toast');
  if (!t) return;

  t.textContent = msg;
  t.classList.add('visible');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('visible'), 2200);
}

/* mobile sidebar */
function toggleSidebar() {
  qs('#sidebar')?.classList.toggle('open');
}

/* makes a playlist */
function promptNewPlaylist() {
  const name = prompt('Playlist name:');

  if (!name?.trim()) return;

  fetch('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() }),
  }).then(r => {
    if (r.ok) {
      showToast(`Created "${name}"`);
      location.reload();
    } else {
      showToast('Could not create playlist');
    }
  });
}

/* add song to playlist */
function addToPlaylist(song, playlistName) {
  fetch(`/api/playlists/${encodeURIComponent(playlistName)}/add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(song),
  }).then(async r => {
    if (r.ok) {
      const data = await r.json();
      if (data.added === false) {
        showToast('This song is already in that playlist.');
      } else {
        showToast(`Added to ${playlistName}`);
        _updatePlaylistCount(playlistName, 1);
      }
    } else {
      showToast('Could not add to playlist');
    }
  }).catch(() => {
    showToast('Could not add to playlist');
  });
}

function _updatePlaylistCount(playlistName, diff) {
  qsa('.nav-link-playlist').forEach(link => {
    const nameSpan = qs('span:not(.playlist-count)', link);
    if (nameSpan && nameSpan.textContent === playlistName) {
      const countEl = qs('.playlist-count', link);
      if (countEl) {
        let current = parseInt(countEl.textContent || '0', 10);
        countEl.textContent = Math.max(0, current + diff);
      }
    }
  });
}

/* playlist picker */
let _pickerSong = null;

function openPlaylistPicker(song, e) {
  _pickerSong = song;

  const picker   = qs('#playlist-picker');
  const backdrop = qs('#playlist-picker-backdrop');

  if (!picker) return;

  const x = e?.clientX ?? window.innerWidth / 2;
  const y = e?.clientY ?? window.innerHeight / 2;

  picker.style.left = Math.min(x, window.innerWidth - 230) + 'px';
  picker.style.top  = Math.min(y + 8, window.innerHeight - 300) + 'px';

  picker.classList.add('open');
  backdrop?.classList.add('open');

  _syncPlaylistPickerMarks();
}

function openCurrentSongPlaylistPicker(e) {
  const song = S.queue[S.currentIndex];
  if (!song) return;

  openPlaylistPicker(song, e);
}

function closePlaylistPicker() {
  qs('#playlist-picker')?.classList.remove('open');
  qs('#playlist-picker-backdrop')?.classList.remove('open');

  _pickerSong = null;
  _syncPlaylistPickerMarks();
}

function pickPlaylist(encodedName) {
  if (!_pickerSong) return;

  const name = decodeURIComponent(encodedName);

  addToPlaylist(_pickerSong, name);
  closePlaylistPicker();
}

/* keyboard shortcuts */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;

    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();

    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      nextSong();

    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      prevSong();

    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });
}

/* horizontal scroll for grid sections */
function initGridScrolls() {
  qsa('.grid-section').forEach(section => {
    const track = qs('.song-row-scroll', section);
    const prevBtn = qs('.section-scroll-prev', section);
    const nextBtn = qs('.section-scroll-next', section);
    
    if (!track) return;

    if (prevBtn && nextBtn) {
      function getScrollAmount() {
        const firstCard = qs('.song-card', track);
        if (!firstCard) return track.clientWidth * 0.8;
        const gap = 14; 
        const itemWidth = firstCard.offsetWidth + gap;
        const visibleItems = Math.max(1, Math.floor(track.clientWidth / itemWidth));
        return itemWidth * visibleItems;
      }

      prevBtn.addEventListener('click', () => {
        track.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
      });

      nextBtn.addEventListener('click', () => {
        track.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
      });
    }

    // Add dragging support
    let isDragging = false;
    let hasDragged = false;
    let startX;
    let scrollLeft;

    track.addEventListener('mousedown', (e) => {
      isDragging = true;
      hasDragged = false;
      startX = e.pageX - track.offsetLeft;
      scrollLeft = track.scrollLeft;
    });

    function endDrag() {
      if (!isDragging) return;
      isDragging = false;
      track.classList.remove('is-dragging');
      track.style.scrollBehavior = '';
      track.style.scrollSnapType = '';

      if (hasDragged) {
        // Prevent click after a real drag gesture
        track.classList.add('was-dragging');
        setTimeout(() => track.classList.remove('was-dragging'), 50);
      }
    }

    track.addEventListener('mouseleave', endDrag);
    track.addEventListener('mouseup', endDrag);

    track.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const x = e.pageX - track.offsetLeft;
      const walk = (x - startX) * 1.5; 
      
      // Delay dragging logic until user actually moves the mouse
      if (Math.abs(walk) > 5 && !track.classList.contains('is-dragging')) {
        track.classList.add('is-dragging');
        track.style.scrollBehavior = 'auto';
        track.style.scrollSnapType = 'none';
        hasDragged = true;
      }
      
      if (track.classList.contains('is-dragging')) {
        track.scrollLeft = scrollLeft - walk;
      }
    });
  });
}

/* one-time setup */
let _hasRunOnce = false;

function initOnce() {
  if (_hasRunOnce) return;
  _hasRunOnce = true;

  initKeyboard();
  _initProgressBar();
  _initVolumeBar();
  _setVolumeUI(S.volume);

  // album art opens popup
  qs('#player-thumb-wrap')?.addEventListener('click', () => {
    if (S.queue.length) openNpModal();
  });

  window.addEventListener('pagehide', _savePlaybackState);
  window.addEventListener('beforeunload', _savePlaybackState);

  _restorePlaybackState();
}

/* run setup when page content updates */
function initPage() {
  initOnce();
  
  initSearch();
  initSongCards();
  _syncLikeButtons();
  _syncLikedCount();
  initGridScrolls();

  // keep active card highlighted
  if (S.queue[S.currentIndex]) {
    _markActiveCard(S.queue[S.currentIndex]);
  }

  // init all carousels
  qsa('.carousel-wrapper').forEach(w => initCarousel(w));

  // close sidebar on phones
  qs('.main-area')?.addEventListener('click', () => {
    if (window.innerWidth <= 900) {
      qs('#sidebar')?.classList.remove('open');
    }
  });
}

/* make functions available in html */
window.playSong              = playSong;
window.playSongWithQueue     = playSongWithQueue;
window.togglePlay            = togglePlay;
window.nextSong              = nextSong;
window.prevSong              = prevSong;
window.toggleShuffle         = toggleShuffle;
window.toggleRepeat          = toggleRepeat;
window.toggleMute            = toggleMute;
window.toggleQueue           = toggleQueue;
window.toggleSidebar         = toggleSidebar;
window.openNpModal           = openNpModal;
window.closeNpModal          = closeNpModal;
window.showRecentOverlay     = showRecentOverlay;
window.showLikedOverlay      = showLikedOverlay;
window.closeOverlay          = closeOverlay;
window.toggleCurrentFavorite = toggleCurrentFavorite;
window.promptNewPlaylist     = promptNewPlaylist;
window.addToPlaylist         = addToPlaylist;
window.openCurrentSongPlaylistPicker = openCurrentSongPlaylistPicker;
window.initCarousel          = initCarousel;
window.initPage              = initPage;
window.showToast             = showToast;
window.songFromEl            = songFromEl;
window.openPlaylistPicker    = openPlaylistPicker;
window.closePlaylistPicker   = closePlaylistPicker;
window.pickPlaylist          = pickPlaylist;