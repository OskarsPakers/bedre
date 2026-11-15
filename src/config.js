// All gameplay / rendering tunables live here.
export const CFG = {
  roundSeconds: 300,
  dataUrl: '/data/riga.json',
  shapesUrl: '/data/riga-shapes.bin.gz', // optional: measured heights + simplified roof meshes (src/shapes.js)
  seed: 1337,

  hole: {
    startRadius: 2.2,
    baseSpeed: 12,        // m/s at start radius
    speedExp: 0.38,       // speed ~ (r/r0)^exp
    accel: 7,             // velocity smoothing (1/s)
    radiusSmooth: 5,      // radius smoothing (1/s)
    maxHoles: 16,
  },

  // radius = r0 * (1 + score / k) ^ exp
  growth: { k: 16, exp: 0.44 },
  // radius thresholds used for the "size level" HUD bar
  levels: [2.2, 3.5, 5.5, 8, 12, 18, 28, 42, 62, 90, 130],

  swallow: {
    reach: 0.92,          // object centre must be within radius*reach
    fitRatio: 0.95,       // object fit radius must be < radius*fitRatio
    durMin: 0.6,
    durMax: 1.0,
    wobbleRatio: 2.6,     // too-big objects up to this multiple of radius wobble
  },

  value: {
    person: 1, bin: 1, lamp: 2, bench: 2, tree: 2, car: 4, van: 6,
    kiosk: 6, bus: 14, tram: 22, monument: 120, freedom: 450,
    trolley: 16, shelter: 4, flag: 2, parasol: 3, stall: 6, bike: 1, boat: 12, ferry: 45, swan: 3, bird: 1,
    laima: 45, pylon: 160, railarch: 90, landmarkBonus: 2.0, catHouse: 120,
    buildingDiv: 71,      // building points = area*mean height / div (70 before the measured heights/shapes; measured volumes are ~20% bigger)
    buildingMin: 4,
    landmarkMul: 2.5,
  },
  buildingFit: { boxWeight: 0.5, areaWeight: 0.5 }, // blend of half-long-side and sqrt(A/pi)

  camera: {
    fov: 42,
    elevationDeg: 57,
    distBase: 7,
    distPerRadius: 17,    // ~2x visible ground area vs. the MVP (5 + 11.5r); widens more as the hole grows
    zoomMin: 0.6, zoomMax: 2.6, // wheel / pinch multiplier limits
    smooth: 3.5,
    zoomSmooth: 2.2,
    lookAhead: 0.16,      // max look-ahead as a fraction of camera distance
    leadTime: 0.9,        // seconds of travel to lead by
    leadSmooth: 1.4,      // look-ahead smoothing (1/s)
  },

  props: {
    people: 2400, lamps: 700, benches: 260, bins: 320, cars: 1100, vans: 170,
    buses: 45, trams: 28, kiosks: 45, maxTrees: 9000, parkExtraTrees: 0,
  },

  ground: { tile: 4096, tiles: 2, margin: 140 },
  shadowMapSize: 2048,
  pixelRatioCap: 2,

  colors: {
    sky: 0xcfe0ec,
    paving: '#d8cfbd', park: '#9dbd78', parkDark: '#8aae67',
    water: '#5f86a3', waterEdge: '#86a8bf',
    road: '#a6a29a', roadMajor: '#97938c', walk: '#e7dfcd',
    footprint: '#c6bca8', rail: '#6d6862',
    wall: {
      res: [0xe9dcbc, 0xe2c78f, 0xd6a27a, 0xe8d3b0, 0xcf9c78, 0xdcc9a4, 0xc9b99a, 0xe5b99a],
      com: [0xd8d2c4, 0xc7c2b6, 0xb6bcc0, 0xdad0ba],
      pub: [0xe3d3ae, 0xd9c08c, 0xcdb79a],
      rel: [0xd9cfbf, 0xc9b89c],
      ind: [0xb28c74, 0xa88a77, 0x9a8f86],
      aux: [0xcdbfa6, 0xbba88e],
      oth: [0xdccdb0, 0xcdb89a],
    },
    roof: [0xb55a3c, 0xa8503a, 0xc0653f, 0x9c4a35, 0xb8613c, 0x6a9484, 0x78a090, 0x8b6b5c],
  },

  holeColors: [0xe8572f, 0x2f8fe8, 0xe8b82f, 0x7c4fd0, 0x2fb58c, 0xd0408a, 0x8cc63f, 0x8a5a3b],

  // ---- opponents -------------------------------------------------------
  bots: {
    count: 7,
    difficulty: 1.0,      // global skill multiplier (0.6 easy .. 1.3 hard); scales speed + decision quality
    thinkHz: 6,           // brain ticks per second per bot (staggered)
    speedMin: 0.86, speedMax: 1.0,   // per-bot speed factor (x difficulty, capped at 1.04)
    reactMin: 0.15, reactMax: 0.6,   // seconds before a bot reacts to a threat
    aimNoise: 0.22,       // radians of steering jitter at difficulty 1
    aggressionMin: 0.2, aggressionMax: 0.9, // chance/range of hunting smaller holes
    spawnMinDist: 260,    // min distance between spawn points (m)
    roamEatTime: 22,      // s: roam scoring = area value / (this + travel time); bigger = roams further
    huntRange: 2,         // hunt smaller holes only within ~this x own radius (x aggression)
    huntGreed: 2.0,       // hunt when victim score*gain / catch time > own eat rate x (this - aggression)
    preyMinFrac: 0.25,    // ignore prey whose score is below this fraction of ours
    leaderRestraint: 1.0, // a bot clearly leading the board adds this to huntGreed against other bots (less snowballing)
    underdogCare: 0.35,   // bots below 35% of the leader's score flee earlier (zone x1.3) and react faster
    roamGain: 1.4,        // roam only when another area scores this many times better than here (+ less for skilled bots)
  },
  // ---- hole vs hole ------------------------------------------------------
  duel: {
    ratio: 1.15,          // eater radius must be >= victim radius * ratio
    reach: 0.62,          // victim centre must be within eater.radius * reach
    gain: 0.5,            // fraction of victim score the eater receives
    dyingTime: 0.7,       // victim shrink/spiral animation (s)
    respawnDelay: 3,      // s until victim reappears
    keepScore: 0.5,       // fraction of score kept after respawn
    protect: 3,           // spawn protection (s)
    minRespawnDist: 140,  // preferred distance from other holes when respawning
  },
  intro: { hold: 1.2, glide: 2.5 },   // round-start fly-in: hold on the overview, then ease down to the player (s)
  roundWarn: 10,          // timer pulses in the last N seconds
  playerName: 'Tu',
};

export function radiusFromScore(score) {
  return CFG.hole.startRadius * Math.pow(1 + score / CFG.growth.k, CFG.growth.exp);
}
export function scoreFromRadius(r) {
  return CFG.growth.k * (Math.pow(r / CFG.hole.startRadius, 1 / CFG.growth.exp) - 1);
}

// ---- World life & feel (iteration 2): traffic, pedestrians, effects, audio, quality -----------------
export const LIFE = {
  movers: {
    cars: 300, buses: 16, trolleys: 10, trams: 11, walkers: 240, wanderers: 90,
    taxiFrac: 0.07, boats: 5, ferries: 2, swans: 14, pigeons: 60, gulls: 16, stopDwell: [4, 8], followGap: 1.8,
    birdScare: 5,          // pigeons take off when a hole comes within 8 + radius*this   // counts at full quality
    carSpeed: { primary: 11, secondary: 10, tertiary: 8.5, residential: 6.5, service: 4 },
    busSpeed: 8, tramSpeed: 7.5, walkSpeed: 1.35, wanderSpeed: 1.0,
    laneFrac: 0.25,         // lane offset = width * laneFrac (right-hand traffic)
    turnChance: 0.45,       // chance to turn at a junction vertex
    panicRadius: 7,         // movers flee holes within radius*this that could eat them
    panicCar: 1.5, panicWalk: 2.4,
  },
  fx: {
    maxParticles: 1800,
    shakeBuilding: 0.9, shakeMax: 2.2, // camera shake amplitude scale (metres at dist 100) / cap
    ringDust: true,
  },
  riga: {
    flags: 90, parasols: 280, stalls: 60, bikes: 130, scooters: 70, lanterns: 90,
    cafes: 200,            // café tables for two (terraces on squares + pedestrian streets)
    squares: 14,           // Old Town squares that get terraces (named ones first: Rātslaukums, Līvu, Doma laukums)
    terracesPerSquare: 4, squarePeople: 9, streetTerrace: 0.7, // terrace chance per 18 m sample on Old Town pedestrian streets
    pylonAt: 0.72,         // Vanšu pylon position along the bridge from the city end (0..1)
  },
  fall: { buildingLean: 0.16, buildingSlide: 1.0, spin: 0.5, bigBuildingSlower: 0.9 },
  audio: { master: 0.7, ambient: 0.35, hum: 0.5, maxVoices: 16 },
  labels: { minGap: 1.4, addressFitFrac: 0.5, namedFitFrac: 0.22 },
  quality: { // levels low(0) medium(1) high(2); `?quality=low|medium|high` disables auto
    pixelRatio: [1, 1.5, 2], shadowMap: [0, 1024, 2048], moverFrac: [0.35, 0.7, 1],
    downFps: 45, upFps: 57, window: 70,
  },
  palettes: {
    oldTown: [0xe4b25a, 0xcf7a4d, 0xe8d3a2, 0xd9926c, 0xc4574b, 0xe2c27a, 0xb8c9a0, 0xd8a39a],
    oldTownRoof: [0xa8452f, 0xb5523a, 0x8e3a2b, 0xc0653f],
    centre: [0xbfd8c3, 0xe3b5b0, 0xc9bcd8, 0xefdca0, 0xb5cde0, 0xe9d8c4, 0xd9e2b5, 0xf0c9a8],
  },
};
