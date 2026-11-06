const id = n => String(n).padStart(22, '0');
const tracks = [
  ['Soft Focus', 'Daylight Club', 'Somewhere Quiet', 218000],
  ['A Window Seat', 'The Slow Hours', 'In Between', 194000],
  ['Sunday, Again', 'Moss & The Moon', 'Green Rooms', 246000],
  ['Paper Planes', 'Daylight Club', 'Somewhere Quiet', 201000],
  ['Blue Hour', 'The Slow Hours', 'In Between', 187000],
  ['Almost Home', 'Moss & The Moon', 'Green Rooms', 232000],
  ['Golden Hour', 'Moss & The Moon', 'Green Rooms', 215000],
  ['Quiet Room', 'Daylight Club', 'Somewhere Quiet', 188000],
  ['Night Walk', 'The Slow Hours', 'In Between', 225000],
  ['Morning Tide', 'Moss & The Moon', 'Green Rooms', 198000],
  ['Late Train', 'Daylight Club', 'Somewhere Quiet', 240000],
  ['First Light', 'The Slow Hours', 'In Between', 205000],
].map(([name, artist, album, duration], i) => ({
  id: id(i + 1), uri: `spotify:track:${id(i + 1)}`, type: 'track', name,
  artists: [{ name: artist }], album: { name: album, images: [{ url: 'cover.svg' }] },
  duration_ms: duration, is_playable: true,
}));
const albums = [...new Set(tracks.map(t => t.album.name))].map((name, i) => ({
  id: id(i + 10), uri: `spotify:album:${id(i + 10)}`, name, type: 'album',
  images: [{ url: 'cover.svg' }], artists: tracks[i].artists,
}));
const artists = [...new Set(tracks.map(t => t.artists[0].name))].map((name, i) => ({
  id: id(i + 20), uri: `spotify:artist:${id(i + 20)}`, name, type: 'artist', images: [{ url: 'cover.svg' }],
}));
const playlists = ['A little room to think', 'The long way home', 'Sunday sounds'].map((name, i) => ({
  id: id(i + 30), uri: `spotify:playlist:${id(i + 30)}`, name, type: 'playlist', images: [{ url: 'cover.svg' }], owner: { display_name: 'Pocket demo' },
}));

export class DemoPlayer {
  constructor() {
    this.index = 0;
    this.position = 42000;
    this.playing = true;
    this.shuffle = false;
    this.repeat = 'off';
    this.volume = 64;
    this.saved = new Set(tracks.slice(0, 3).map(t => t.uri));
    this.queue = tracks.slice(1);
    this.devices = [{ id: 'demo-computer', name: 'This computer', type: 'Computer' }, { id: 'demo-speaker', name: 'Living room', type: 'Speaker' }];
    this.deviceId = 'demo-computer';
    this.updated = Date.now();
  }
  tick() {
    if (this.playing) {
      const duration = tracks[this.index].duration_ms;
      const elapsed = Date.now() - this.updated;
      if (this.position + elapsed >= duration) {
        const next = this.queue.shift();
        this.index = next ? tracks.findIndex(t => t.uri === next.uri) : (this.index + 1) % tracks.length;
        if (!this.queue.length) this.queue = tracks.filter((_, i) => i !== this.index);
        this.position = 0;
      } else {
        this.position += elapsed;
      }
    }
    this.updated = Date.now();
  }
  async action(name, args = {}) {
    this.tick();
    const page = items => {
      const offset = Number(args.offset || 0);
      const limit = Number(args.limit || 5);
      const sliced = items.slice(offset, offset + limit);
      return {
        items: structuredClone(sliced),
        next: offset + limit < items.length ? `offset=${offset + limit}` : null,
        total: items.length,
      };
    };
    switch (name) {
      case 'playback': return structuredClone({
        item: tracks[this.index], is_playing: this.playing, progress_ms: this.position,
        shuffle_state: this.shuffle, repeat_state: this.repeat, actions: { disallows: {} },
        device: { ...this.devices.find(d => d.id === this.deviceId), is_active: true, is_restricted: false, volume_percent: this.volume, supports_volume: true },
      });
      case 'devices': return { devices: this.devices.map(d => ({ ...d, is_active: d.id === this.deviceId, is_restricted: false })) };
      case 'search': {
        const collection = { track: tracks, album: albums, artist: artists, playlist: playlists }[args.type];
        const results = collection.filter(t => `${t.name} ${t.artists?.map(a => a.name).join(' ') || ''}`.toLowerCase().includes(args.query.toLowerCase()));
        return { [`${args.type}s`]: page(results) };
      }
      case 'library': return page(tracks.filter(t => this.saved.has(t.uri)).map(track => ({ track })));
      case 'playlists': return page(playlists);
      case 'albums': return page(albums.map(album => ({ album: structuredClone(album) })));
      case 'following': return { artists: page(structuredClone(artists)) };
      case 'profile': return { id: 'demo-user', display_name: 'Pocket Listener', product: 'premium', images: [{ url: 'cover.svg' }] };
      case 'audio-features': return {
        id: tracks[this.index].id,
        tempo: 116 + (this.index * 4),
        key: (this.index * 2) % 12,
        mode: this.index % 2,
        valence: 0.55 + ((this.index * 0.08) % 0.4),
        energy: 0.60 + ((this.index * 0.06) % 0.35),
        danceability: 0.70,
      };
      case 'recently-played': return {
        items: tracks.map((track, i) => ({
          track: structuredClone(track),
          played_at: new Date(Date.now() - (i + 1) * 3600000).toISOString(),
        })),
      };
      case 'top-tracks': return { items: structuredClone(tracks) };
      case 'top-artists': return { items: structuredClone(artists) };
      case 'recommendations': return { tracks: structuredClone(tracks.slice(1, 5)) };
      case 'album-tracks': return { items: structuredClone(tracks.slice(0, 4)) };
      case 'artist-top-tracks': return { tracks: structuredClone(tracks.slice(0, 4)) };
      case 'lyrics': {
        const title = tracks[this.index].name;
        return {
          id: 1,
          trackName: title,
          artistName: tracks[this.index].artists[0].name,
          synced: true,
          lines: [
            { time: 5, text: `Listening to ${title}` },
            { time: 18, text: 'A little space for music right here' },
            { time: 35, text: 'Take your time and enjoy the flow' },
            { time: 55, text: 'The rhythm carries the afternoon away' },
            { time: 85, text: 'Light filters through the quiet room' },
            { time: 120, text: 'Every sound has its own place' },
            { time: 150, text: 'Peaceful hours in between' },
          ],
        };
      }
      case 'queue': return { queue: structuredClone(this.queue) };
      case 'play': {
        if (args.uri) {
          this.index = Math.max(0, tracks.findIndex(t => t.uri === args.uri));
          this.position = 0;
          const remaining = this.queue.filter(t => t.uri !== args.uri);
          this.queue = remaining.length ? remaining : tracks.filter((_, i) => i !== this.index);
        } else if (this.position >= tracks[this.index].duration_ms) {
          this.position = 0;
        }
        this.playing = true;
        break;
      }
      case 'pause': this.playing = false; break;
      case 'next': {
        const next = this.queue.shift();
        this.index = next ? tracks.findIndex(t => t.uri === next.uri) : (this.index + 1) % tracks.length;
        if (!this.queue.length) this.queue = tracks.filter((_, i) => i !== this.index);
        this.position = 0; break;
      }
      case 'previous': this.index = (this.index + tracks.length - 1) % tracks.length; this.position = 0; break;
      case 'seek': this.position = args.position; break;
      case 'volume': this.volume = args.volume; break;
      case 'shuffle': this.shuffle = args.enabled; break;
      case 'repeat': this.repeat = args.mode; break;
      case 'transfer': this.deviceId = args.deviceId; break;
      case 'saved': return [this.saved.has(args.uri)];
      case 'save': this.saved.add(args.uri); break;
      case 'unsave': this.saved.delete(args.uri); break;
      case 'enqueue': { const track = tracks.find(t => t.uri === args.uri); if (track) this.queue.push(track); break; }
      default: throw new Error('This action is unavailable in the demo.');
    }
    return null;
  }
}
