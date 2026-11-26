/* ============================================================
 * COSMOS ATLAS — English data layer (data-en.js)
 *
 * Loaded immediately after js/data.js. When the active language is
 * English it overwrites the Chinese display strings of COSMOS.DATA in
 * place; in Chinese mode it returns at the first guard, so the site
 * behaves exactly as before.
 *
 * Scope: display text only.
 *  - Numbers keep the values and precision of js/data.js
 *    (465 亿光年 → 46.5 billion light-years,
 *     137.87 ± 0.20 亿年 → 13.787 ± 0.020 billion years).
 *  - Machine keys are never touched: planets[].id, missions[].id,
 *    vehicles[].id, photo/texture/color keys, galaxies[].type and
 *    deepObjects[].kind keep the values data.js defines, because
 *    filtering logic compares against them.
 *  - Fields that are already English (en, agency codes, symbol,
 *    dates in ISO form) are left alone.
 *
 * Order contracts (id-less arrays matched by position against
 * js/data.js; keep both lists in sync):
 *  - D.milestones: 22 entries, 1957 → 2024.
 *  - D.sources: 7 entries, same order as data.js.
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var i18n = COSMOS.i18n;
  if (!i18n || i18n.lang !== 'en') return;

  var D = COSMOS.DATA;
  if (!D) return;

  /* ---------------- helpers ---------------- */

  function mix(target, patch) {
    if (!target || !patch) return;
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) target[k] = patch[k];
    }
  }

  function mixBy(list, key, patches) {
    if (!list || !patches) return;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (item && patches[item[key]]) mix(item, patches[item[key]]);
    }
  }

  function mixNames(list, names) {
    if (!list || !names) return;
    for (var i = 0; i < list.length && i < names.length; i++) list[i].name = names[i];
  }

  function mixPlanet(p, s) {
    if (!p || !s) return;
    if (s.name) p.name = s.name;
    if (s.type) p.type = s.type;
    if (s.tagline) p.tagline = s.tagline;
    if (s.desc) p.desc = s.desc;
    if (s.special) p.special = s.special;
    if (s.tempC) p.tempC = s.tempC;
    if (s.atmosphereNote) p.atmosphereNote = s.atmosphereNote;
    if (s.atmosphere) mixNames(p.atmosphere, s.atmosphere);
  }

  function mixStats(item, stats) {
    if (!item || !item.stats || !stats) return;
    for (var i = 0; i < item.stats.length && i < stats.length; i++) {
      if (stats[i].label) item.stats[i].label = stats[i].label;
      if (stats[i].value) item.stats[i].value = stats[i].value;
    }
  }

  /* ---------------- Overview ---------------- */

  mix(D.meta, {
    ageUniverse: '13.787 ± 0.020 billion years',
    observableRadius: '46.5 billion light-years',
    galaxyCount: 'About 2 trillion',
    starCount: '10²² or more',
    cmbTemp: '2.725 K',
    hubbleConst: '67.4 / 73.0 km/s/Mpc (two measurements, about 8% apart)',
    sunMassShare: '99.86%',
    solarSystemAge: '4.6 billion years'
  });

  mixBy(D.components, 'key', {
    darkEnergy: {
      name: 'Dark Energy',
      note: 'Accelerates the expansion of the universe'
    },
    darkMatter: {
      name: 'Dark Matter',
      note: 'Supplies extra gravity, emits no light'
    },
    matter: {
      name: 'Ordinary Matter',
      note: 'Stars, gas, and us'
    }
  });

  /* ---------------- Sun ---------------- */

  D.sun.name = 'Sun';
  mixNames(D.sun.composition, ['Hydrogen', 'Helium', 'Oxygen', 'Carbon', 'Other']);

  /* ---------------- Planets and dwarf planets ----------------
   * Keyed by planet id, so array order does not matter. `type` is
   * display text here (unlike galaxies[].type, which is a logic key).
   */

  var PLANETS = {
    mercury: {
      name: 'Mercury', type: 'Terrestrial planet',
      tagline: 'Closest to the Sun, and the most Moon-like',
      desc: 'It has no real atmosphere. By day the surface can melt lead; by night it drops to −173 °C. The surface is saturated with impact craters, and the only "weather" is the solar wind stripping atoms from the ground.',
      special: 'One solar day, from sunrise to sunrise, lasts 176 Earth days, longer than its own year.',
      tempC: '-173 to 427',
      atmosphere: ['Oxygen', 'Sodium', 'Hydrogen', 'Helium', 'Potassium'],
      atmosphereNote: 'Strictly speaking, an exosphere: surface pressure is less than one trillionth that of Earth.'
    },
    venus: {
      name: 'Venus', type: 'Terrestrial planet',
      tagline: 'A runaway greenhouse twin of Earth',
      desc: 'Carbon dioxide makes up 96.5% of the air, and surface pressure is 92 times that of Earth. The greenhouse effect bakes the ground to 464 °C, hotter than Mercury. The clouds are droplets of sulfuric acid.',
      special: 'Venus rotates opposite to its orbit, so the Sun rises in the west. Its day is also longer than its year.',
      tempC: '464',
      atmosphere: ['Carbon dioxide', 'Nitrogen', 'Sulfur dioxide'],
      atmosphereNote: 'Surface pressure is about 92 standard atmospheres, equivalent to 900 m below sea level on Earth.'
    },
    earth: {
      name: 'Earth', type: 'Terrestrial planet',
      tagline: 'The only place known to harbor life',
      desc: 'Liquid water, plate tectonics, a magnetic field, and an oxygen-rich atmosphere exist here at the same time. About 21% of the air is oxygen, produced by photosynthesis: evidence that life has reshaped the planet.',
      special: 'The Great Oxidation Event 2.26 billion years ago put oxygen into the atmosphere, and complex life followed.',
      tempC: '15 (mean)',
      atmosphere: ['Nitrogen', 'Oxygen', 'Argon', 'Carbon dioxide'],
      atmosphereNote: 'Water vapor varies by location, from 0.1% to 4%.'
    },
    mars: {
      name: 'Mars', type: 'Terrestrial planet',
      tagline: 'Once had water, now has dust storms',
      desc: 'Mean temperature is −63 °C, and the atmosphere is only 0.6% as thick as that of Earth. Valles Marineris is 4,000 km long, and Olympus Mons rises 21.9 km, the largest volcano in the Solar System.',
      special: 'A Martian day is only 37 minutes longer than an Earth day, which makes Mars the easiest planet to put on a schedule.',
      tempC: '-63 (mean)',
      atmosphere: ['Carbon dioxide', 'Nitrogen', 'Argon', 'Oxygen'],
      atmosphereNote: 'Surface pressure is about 0.6% of that on Earth, too low for liquid water to stay stable.'
    },
    jupiter: {
      name: 'Jupiter', type: 'Gas giant',
      tagline: 'Gas giant and vacuum cleaner of the Solar System',
      desc: 'Its mass is 2.5 times that of the other seven planets combined. The Great Red Spot is an anticyclone at least 190 years old; it is now only 16,000 km wide and still shrinking.',
      special: 'It rotates once in under 10 hours, the fastest spin of any planet, and its gravity deflects many comets away from the inner Solar System.',
      tempC: '-108 (cloud tops)',
      atmosphere: ['Hydrogen', 'Helium', 'Methane'],
      atmosphereNote: 'There is no solid surface. With depth the atmosphere grades into liquid metallic hydrogen.'
    },
    saturn: {
      name: 'Saturn', type: 'Gas giant',
      tagline: 'The ringed giant less dense than water',
      desc: 'Its mean density is 0.687 g/cm³, lower than water. The rings span 280,000 km but average only tens of meters in thickness, made mostly of water-ice particles.',
      special: 'In March 2025 the IAU confirmed 274 moons at Saturn, the most of any planet in the Solar System.',
      tempC: '-139 (cloud tops)',
      atmosphere: ['Hydrogen', 'Helium', 'Methane'],
      atmosphereNote: 'A hexagonal jet stream about 14,000 km across circles the north pole.'
    },
    uranus: {
      name: 'Uranus', type: 'Ice giant',
      tagline: 'The ice giant that spins on its side',
      desc: 'Its axis is tilted 98°, so the planet lies almost in its orbital plane. Each pole faces the Sun for 42 years, then stays in darkness for 42 years. Methane absorbs red light, which gives the planet its blue-green color.',
      special: 'Only one spacecraft has ever seen it up close: Voyager 2 flew past in 1986.',
      tempC: '-195 (cloud tops)',
      atmosphere: ['Hydrogen', 'Helium', 'Methane'],
      atmosphereNote: 'Inside lies a hot, high-pressure "ice" layer of water, ammonia, and methane.'
    },
    neptune: {
      name: 'Neptune', type: 'Ice giant',
      tagline: 'Calculated first, seen later',
      desc: 'Winds reach 2,100 km/h. In 1846 astronomers deduced its position from irregularities in the orbit of Uranus and found the planet the same night.',
      special: 'It is the only planet discovered by mathematical prediction rather than by observation.',
      tempC: '-201 (cloud tops)',
      atmosphere: ['Hydrogen', 'Helium', 'Methane'],
      atmosphereNote: 'It receives only one thousandth of the sunlight that reaches Earth.'
    },
    pluto: {
      name: 'Pluto', type: 'Dwarf planet',
      tagline: 'An icy world reclassified',
      desc: 'The IAU reclassified Pluto as a dwarf planet in 2006. When New Horizons flew past in 2015 it found nitrogen-ice plains called Sputnik Planitia and a heart-shaped region 3,500 km across.',
      special: 'One Pluto day equals 6.4 Earth days, and one Pluto year takes 248 Earth years.',
      tempC: '-229',
      atmosphere: ['Nitrogen', 'Methane', 'Carbon monoxide'],
      atmosphereNote: 'Extremely thin: nitrogen sublimates near perihelion and freezes out near aphelion.'
    }
  };

  for (var p = 0; p < D.planets.length; p++) mixPlanet(D.planets[p], PLANETS[D.planets[p].id]);
  for (var dp = 0; dp < D.dwarfPlanets.length; dp++) mixPlanet(D.dwarfPlanets[dp], PLANETS[D.dwarfPlanets[dp].id]);

  /* ---------------- Moons (12, Solar System chapter) ----------------
   * Keyed by moon id; parent/texture/numbers stay in data.js.
   */
  var MOONS = {
    moon: {
      name: 'Moon',
      tagline: 'Earth\'s only natural satellite, and the only other world we have walked on',
      desc: 'Tidally locked, it always shows Earth the same face. Between 1969 and 1972, twelve astronauts walked on it and brought back 382 kg of samples.',
      special: 'It has slowed Earth\'s spin to 24 hours: in the Devonian period, 400 million years ago, a day lasted about 22 hours.'
    },
    phobos: {
      name: 'Phobos',
      tagline: 'A rubble pile that circles Mars three times a day',
      desc: 'Irregular in shape and covered with craters and grooves, it may be a captured asteroid or debris from a giant impact.',
      special: 'Its orbit drops about 1.8 cm per month. In roughly 50 million years it will crash into Mars or break up into a ring.'
    },
    deimos: {
      name: 'Deimos',
      tagline: 'Mars\' quiet little companion',
      desc: 'Much smaller than Phobos and blanketed in dust, its crater rims have been worn smooth.',
      special: 'From the Martian surface it looks like a slow-moving bright star rather than an obvious moon.'
    },
    io: {
      name: 'Io',
      tagline: 'The most volcanically active body in the Solar System',
      desc: 'More than 400 active volcanoes stain its surface yellow, orange, and red with sulfur compounds, while Jupiter\'s tides knead its interior.',
      special: 'Its plumes rise 300 km high; the material is ionized by Jupiter\'s magnetic field and forms a plasma torus.'
    },
    europa: {
      name: 'Europa',
      tagline: 'An ice shell that may hide more liquid water than Earth',
      desc: 'Its surface is smooth ice crisscrossed by reddish-brown cracks. About 100 km below may lie a global ocean.',
      special: 'Europa Clipper launched in 2024 and is due to enter Jupiter orbit around 2030 to assess whether that ocean is habitable.'
    },
    ganymede: {
      name: 'Ganymede',
      tagline: 'The largest moon in the Solar System, bigger than Mercury',
      desc: 'The only moon with its own magnetic field, its surface mixes ancient dark terrain with younger bright grooved regions.',
      special: 'Hubble found a thin oxygen atmosphere in the 1990s, produced when radiation splits water ice at the surface.'
    },
    callisto: {
      name: 'Callisto',
      tagline: 'One of the most heavily cratered surfaces known',
      desc: 'Almost no geological activity for 4 billion years has left its surface as a complete record of impacts.',
      special: 'It orbits outside Jupiter\'s harshest radiation belts, making it a candidate site for a future crewed outpost.'
    },
    enceladus: {
      name: 'Enceladus',
      tagline: 'An ocean world spraying ice from its south pole',
      desc: 'Fissures at the south pole vent salty ice grains that form one of Saturn\'s faint rings; the plumes contain organic molecules.',
      special: 'Cassini flew through the plumes and detected salts and silica grains, hinting at hydrothermal activity below.'
    },
    rhea: {
      name: 'Rhea',
      tagline: 'A cratered world made of ice',
      desc: 'With a density of only 1.24 g/cm³ it is mostly water ice: bright, but covered in ancient craters.',
      special: 'During a 2008 flyby Cassini detected a thin oxygen atmosphere, created as magnetospheric particles erode the ice.'
    },
    titan: {
      name: 'Titan',
      tagline: 'The only moon with a thick atmosphere and surface lakes',
      desc: 'Its atmosphere is about 45% denser than Earth\'s and mostly nitrogen. Methane drives rain, rivers, and lakes: a second weather system.',
      special: 'Huygens landed in 2005 and photographed the surface, the first landing on a world in the outer Solar System.'
    },
    triton: {
      name: 'Triton',
      tagline: 'A cryovolcanic moon on a backward orbit',
      desc: 'The only large moon orbiting opposite to its planet\'s spin, it is almost certainly a captured Kuiper Belt object.',
      special: 'Voyager 2 photographed dark nitrogen-ice plumes in 1989, showing that it is still volcanically active.'
    },
    charon: {
      name: 'Charon',
      tagline: 'Pluto\'s tidally locked partner',
      desc: 'With 12% of Pluto\'s mass, it orbits a common center of gravity with Pluto, so the pair is often treated as a double dwarf planet.',
      special: 'New Horizons found reddish material at its north pole in 2015, delivered by methane escaping from Pluto.'
    }
  };

  for (var m = 0; m < D.moons.length; m++) mixPlanet(D.moons[m], MOONS[D.moons[m].id]);

  /* ---------------- Solar System missions ---------------- */

  mixBy(D.missions, 'id', {
    voyager1: {
      name: 'Voyager 1',
      targets: ['Jupiter', 'Saturn'],
      status: 'In flight · Interstellar space',
      distance: 'About 165 AU (2025)',
      desc: 'After flybys of Jupiter and Saturn, a gravity assist flung it out of the ecliptic. It entered interstellar space in 2012 and is now the most distant human-made object from Earth.',
      fact: 'Its radio signals take more than 22 hours to reach Earth one way.'
    },
    voyager2: {
      name: 'Voyager 2',
      targets: ['Jupiter', 'Saturn', 'Uranus', 'Neptune'],
      status: 'In flight · Interstellar space',
      distance: 'About 137 AU (2025)',
      desc: 'The only spacecraft to visit Uranus and Neptune. It used a planetary alignment that repeats every 176 years to complete the Grand Tour.',
      fact: 'Its cameras were switched off in 1990, but the plasma and magnetic-field instruments still operate.'
    },
    parker: {
      name: 'Parker Solar Probe',
      targets: ['Sun'],
      status: 'In flight · Solar orbit',
      distance: 'Closest approach 6.1 million km (2024-12-24)',
      desc: 'The fastest object ever built by humans. In December 2024 it crossed the corona at 690,000 km/h, the first probe to enter the magnetized outer atmosphere of the Sun.',
      fact: 'Its carbon-composite heat shield is 11.4 cm thick. The Sun-facing side reaches about 1,400 °C while the instrument bay behind it stays at 30 °C.'
    },
    cassini: {
      name: 'Cassini-Huygens',
      targets: ['Saturn', 'Titan'],
      status: 'Completed (2017)',
      distance: '13 years in the Saturn system',
      desc: 'It orbited Saturn 294 times, and in 2005 Huygens landed on Titan. In 2017 it ended with a deliberate plunge into the atmosphere of Saturn, the Grand Finale.',
      fact: 'It found ice geysers at the south pole of Enceladus, fed by a subsurface ocean.'
    },
    newhorizons: {
      name: 'New Horizons',
      targets: ['Pluto', 'Kuiper Belt'],
      status: 'In flight · Kuiper Belt',
      distance: 'About 60 AU (2025)',
      desc: 'On 14 July 2015 it flew past Pluto, and humans saw this icy world clearly for the first time. In 2019 it flew past the Kuiper Belt object Arrokoth.',
      fact: 'At launch it was the fastest spacecraft ever built: it passed the orbit of the Moon in five hours.'
    },
    juno: {
      name: 'Juno',
      targets: ['Jupiter'],
      status: 'In flight · Jupiter orbit',
      distance: 'Jupiter orbit',
      desc: 'A polar orbit repeatedly threads the radiation belts of Jupiter and measures the gravity field, the magnetic field, and ammonia and water deep in the atmosphere.',
      fact: 'Its solar panels see only 1/25 of the sunlight available at Earth, yet still generate power.'
    },
    galileo: {
      name: 'Galileo',
      targets: ['Jupiter', 'Europa'],
      status: 'Completed (2003)',
      distance: '8 years in the Jupiter system',
      desc: 'The first spacecraft to orbit Jupiter. Its released probe made the first direct measurements of the atmosphere of Jupiter and found evidence of a subsurface ocean on Europa.',
      fact: 'Its main antenna never deployed, so data came back at 1/1000 of the planned rate.'
    },
    messenger: {
      name: 'MESSENGER',
      targets: ['Mercury'],
      status: 'Completed (2015)',
      distance: '4 years in Mercury orbit',
      desc: 'The first spacecraft to orbit Mercury. It mapped the entire surface and found water ice in permanently shadowed polar craters.',
      fact: 'It needed one Earth flyby, two at Venus, and three at Mercury to slow down enough to enter orbit.'
    },
    magellan: {
      name: 'Magellan',
      targets: ['Venus'],
      status: 'Completed (1994)',
      distance: '4 years in Venus orbit',
      desc: 'Radar punched through the sulfuric acid clouds and mapped 98% of the surface, revealing vast volcanic plains and shield volcanoes.',
      fact: 'Venus surface pressure could crush a car. Magellan "saw" the ground with radar, not with a camera.'
    },
    curiosity: {
      name: 'Curiosity',
      targets: ['Mars'],
      status: 'Operating · Gale Crater',
      distance: 'Mars surface',
      desc: 'It landed on a sky crane, drilled rocks, and analyzed organic molecules, confirming that ancient Mars once had environments suitable for microbes.',
      fact: 'Its nuclear battery has run for more than 10 years, and the rover has driven more than 30 km.'
    },
    perseverance: {
      name: 'Perseverance',
      targets: ['Mars'],
      status: 'Operating · Jezero Crater',
      distance: 'Mars surface',
      desc: 'It is collecting rock cores in an ancient river delta for a future mission to bring home. Its companion helicopter Ingenuity completed 72 flights.',
      fact: 'Its oxygen generator produces about 10 g of oxygen per day.'
    },
    tianwen1: {
      name: 'Tianwen-1 / Zhurong',
      targets: ['Mars'],
      status: 'Orbiter still operating; surface mission complete',
      distance: 'Mars',
      desc: 'One launch accomplished orbit, landing, and roving. Zhurong drove 1,921 m across Utopia Planitia and found signs of past water activity.',
      fact: 'The first Mars mission to orbit, land, and rove in a single attempt.'
    },
    change5: {
      name: "Chang'e 5",
      targets: ['Moon'],
      status: 'Mission complete (2020)',
      distance: 'Moon',
      desc: 'It returned 1,731 g of lunar soil, the first sample return since 1976, collected from Oceanus Procellarum on the near side.',
      fact: 'The return capsule re-entered at close to escape velocity and used a semi-ballistic skip re-entry to slow down.'
    },
    mariner10: {
      name: 'Mariner 10',
      targets: ['Mercury', 'Venus'],
      status: 'Completed (1975)',
      distance: '3 Mercury flybys',
      desc: 'The first mission to use a gravity assist. It flew past Venus and then Mercury, photographing about 45% of the surface.',
      fact: 'Its orbital period was exactly twice that of Mercury, so every flyby faced the same hemisphere.'
    },
    venusexpress: {
      name: 'Venus Express',
      targets: ['Venus'],
      status: 'Completed (2014)',
      distance: '9 years in Venus orbit',
      desc: 'The first long polar-orbit survey of Venus. It tracked cloud-top winds and atmospheric escape, and found early hints of phosphine in the atmosphere.',
      fact: 'Most of its instruments were rebuilt from spare parts for Mars Express.'
    },
    akatsuki: {
      name: 'Akatsuki',
      targets: ['Venus'],
      status: 'Operating (orbit insertion 2015)',
      distance: 'Venus orbit',
      desc: 'After a failed first insertion, it spent five years circling the Sun to catch Venus again, then entered orbit. It discovered a bow-shaped structure at the cloud tops.',
      fact: 'It is the first planetary probe rescued by taking the long way round.'
    },
    marsExpress: {
      name: 'Mars Express',
      targets: ['Mars'],
      status: 'Operating',
      distance: 'Mars orbit',
      desc: 'It found hints of liquid water beneath the south polar ice cap and released the Beagle 2 lander, which was lost on arrival.',
      fact: 'It was designed for two years of work. More than 20 years later, it is still operating.'
    },
    viking1: {
      name: 'Viking 1',
      targets: ['Mars'],
      status: 'Completed (1982)',
      distance: '6 years on the Mars surface',
      desc: 'The first lander to work on the Martian surface for the long term. Its three life-detection experiments all came back negative, but the results are still debated.',
      fact: 'Its orbiter shot the base maps for most of the landing sites used by later Mars missions.'
    },
    bepicolombo: {
      name: 'BepiColombo',
      targets: ['Mercury'],
      status: 'In flight · orbit insertion 2026',
      distance: 'Mercury transfer orbit',
      desc: 'A joint ESA / JAXA mission: ESA built the Mercury Planetary Orbiter and JAXA the Mercury Magnetospheric Orbiter. It is due to enter Mercury orbit in 2026.',
      fact: 'It needs nine planetary flybys (one at Earth, two at Venus, six at Mercury) to slow into orbit.'
    },
    lucy: {
      name: 'Lucy',
      targets: ['Trojan asteroids'],
      status: 'In flight',
      distance: 'Near Jupiter orbit',
      desc: 'It is bound for the Jupiter Trojans to study 11 different asteroids, fossils of the early Solar System.',
      fact: 'Each of its two solar arrays is 7.3 m across; deployed, they look like two large wings.'
    },
    rosetta: {
      name: 'Rosetta',
      targets: ['Comet 67P'],
      status: 'Mission complete (2016)',
      distance: 'Comet 67P',
      desc: 'The first mission to orbit a comet and release a lander. It tracked comet 67P/Churyumov-Gerasimenko for 10 years over about 7.9 billion km of flight.',
      fact: 'In 2014 the Philae lander made the first soft landing on a comet. It bounced twice but still returned images of the surface.'
    },
    apollo11: {
      name: 'Apollo 11',
      targets: ['Moon'],
      status: 'Mission complete (1969)',
      distance: 'Moon',
      desc: 'The first crewed Moon landing. Armstrong and Aldrin walked in the Sea of Tranquility for 2 hours 31 minutes.',
      fact: 'Its guidance computer had only 4 KB of memory, and it raised a 1202 program alarm 30 seconds before landing.'
    },
    iss: {
      name: 'International Space Station',
      agency: 'International',
      targets: ['Low Earth orbit'],
      status: 'Operating',
      distance: '400 km orbit',
      desc: 'The largest human-made structure in orbit. It has been continuously crewed since 2000, and more than 4,000 experiments have been completed aboard.',
      fact: 'It circles Earth about 16 times a day, so the crew sees 16 sunrises.'
    },
    landsat: {
      name: 'Landsat',
      targets: ['Earth'],
      status: 'Operating (Landsat 9)',
      distance: '705 km Sun-synchronous orbit',
      desc: 'For more than 50 years it has recorded changes on the surface: deforestation, glacier retreat, and urban growth can be compared directly.',
      fact: 'All of its data is free and open. It is the longest continuous observation record in Earth science.'
    }
  });

  /* ---------------- Galaxies ----------------
   * `type` is a logic key (spiral / irregular / deep / elliptical)
   * used for filtering, so it is intentionally left untouched.
   */

  mixBy(D.galaxies, 'id', {
    whirlpool: {
      name: 'Whirlpool Galaxy (M51)',
      distanceLy: '23 million light-years',
      diameterLy: '76,000 light-years',
      stars: 'Hundreds of billions (estimated)',
      desc: 'A classic spiral seen face-on, with two sharply defined arms. Observations in 2020 showed massive stars forming as gas was compressed in the arms.'
    },
    andromeda: {
      name: 'Andromeda Galaxy (M31)',
      distanceLy: '2.54 million light-years',
      diameterLy: '220,000 light-years',
      stars: 'Trillions (estimated)',
      desc: 'The nearest large spiral to the Milky Way and the most massive member of the Local Group. It will merge with the Milky Way in about 4 billion years.'
    },
    sombrero: {
      name: 'Sombrero Galaxy (M104)',
      distanceLy: '31 million light-years',
      diameterLy: '50,000 light-years',
      stars: 'Hundreds of billions (estimated)',
      desc: 'A spiral seen edge-on. Its bright central bulge and dark dust lane give it the outline of a sombrero.'
    },
    barred: {
      name: 'Barred Spiral Galaxy (NGC 1300)',
      distanceLy: '61 million light-years',
      diameterLy: '110,000 light-years',
      stars: 'Hundreds of billions (estimated)',
      desc: 'A spiral with a straight bar across its center. The bar funnels gas toward the core and drives the growth of the central black hole.'
    },
    antennae: {
      name: 'Antennae Galaxies (NGC 4038/39)',
      distanceLy: '45 million light-years',
      diameterLy: '500,000 light-years (including tidal tails)',
      stars: 'Hundreds of billions (both galaxies combined, estimated)',
      desc: 'Two galaxies in collision. Tidal forces have flung stars and gas into two long antennae, the textbook irregular pair in the galaxy zoo.'
    },
    lmc: {
      name: 'Large Magellanic Cloud',
      distanceLy: '163,000 light-years',
      diameterLy: '32,000 light-years',
      stars: 'Tens of billions (estimated)',
      desc: 'An irregular satellite galaxy of the Milky Way. Supernova 1987A, seen here in 1987, was the closest supernova in nearly 400 years.'
    },
    cartwheel: {
      name: 'Cartwheel Galaxy',
      distanceLy: '500 million light-years',
      diameterLy: '150,000 light-years',
      stars: 'Hundreds of billions (estimated)',
      desc: 'A ring-shaped galaxy formed when a smaller galaxy plunged through the center of another. Shock waves ignited star formation in the outer ring.'
    },
    deepfield: {
      name: 'Hubble Ultra Deep Field',
      distanceLy: 'Up to about 13.2 billion light-years',
      diameterLy: 'About 2.4 arcminutes',
      stars: 'About 10,000 galaxies in the field',
      desc: 'An 11.3-day exposure of a tiny patch of apparently empty sky revealed about 10,000 galaxies, each one a world.'
    },
    m87: {
      name: 'Elliptical Galaxy M87',
      distanceLy: '53.5 million light-years',
      diameterLy: 'About 130,000 light-years',
      stars: 'Trillions (estimated)',
      desc: 'The giant elliptical at the center of the Virgo Cluster. It has almost no cold gas or spiral arms, and its stars follow random orbits. The Event Horizon Telescope imaged its central black hole, M87*, in 2019.'
    }
  });

  /* ---------------- Compact objects and deep-space concepts ----------------
   * `kind` (compact / extreme) is a logic key, so it stays untouched.
   * Stats are matched by position: same labels and order as data.js.
   */

  var DEEP_OBJECTS = {
    blackhole: {
      name: 'Black Hole',
      stats: [
        { label: 'Event horizon', value: 'rs = 2GM/c²' },
        { label: 'Central black hole of the Milky Way', value: '4.3 million solar masses' },
        { label: 'M87* mass', value: '6.5 billion solar masses' }
      ],
      desc: 'An object whose gravity is so strong that not even light escapes. In 2019 the Event Horizon Telescope imaged the shadow of M87*, and in 2022 it imaged Sgr A* at the center of the Milky Way.'
    },
    neutronstar: {
      name: 'Neutron Star',
      stats: [
        { label: 'Typical mass', value: '1.4 solar masses' },
        { label: 'Radius', value: 'About 12 km' },
        { label: 'Density', value: 'About 10¹⁷ kg/m³' }
      ],
      desc: 'The dense core left behind when a massive star collapses. A teaspoon of its matter would weigh about a billion tons. Rotating neutron stars emit regular pulses and are called pulsars.'
    },
    whitedwarf: {
      name: 'White Dwarf',
      stats: [
        { label: 'Typical mass', value: '0.6 solar masses' },
        { label: 'Radius', value: 'About the size of Earth' },
        { label: 'Density', value: 'About 10⁹ kg/m³' }
      ],
      desc: 'The ember left by a Sun-like star, held up by electron degeneracy pressure. Above 1.44 solar masses, the Chandrasekhar limit, it collapses further.'
    },
    quasar: {
      name: 'Quasar',
      stats: [
        { label: 'Luminosity', value: 'Up to 1,000 times the Milky Way' },
        { label: 'Typical distance', value: 'Billions of light-years' },
        { label: 'Energy source', value: 'Accretion onto a supermassive black hole' }
      ],
      desc: 'The brightest class of active galactic nucleus. Gravitational energy released as a central black hole swallows matter makes it visible across the observable universe.'
    },
    gravwave: {
      name: 'Gravitational Waves',
      stats: [
        { label: 'First detection', value: 'GW150914 (2015-09-14)' },
        { label: 'Merger product', value: 'A 62-solar-mass black hole' },
        { label: 'Radiated energy', value: 'About 3 solar masses' }
      ],
      desc: 'Ripples in space-time itself. When two black holes merge, about three solar masses of energy become gravitational waves in 0.2 seconds and cross 1.3 billion light-years to reach Earth.'
    },
    darkmatter: {
      name: 'Dark Matter',
      stats: [
        { label: 'Share of cosmic energy', value: '26.8%' },
        { label: 'Evidence', value: 'Galaxy rotation, gravitational lensing' },
        { label: 'Nature', value: 'Emits no light and does not interact with light' }
      ],
      desc: 'Galaxies rotate too fast. The gravity of visible matter alone cannot hold their outer stars, so additional mass must exist. What that mass is remains unsolved.'
    },
    darkenergy: {
      name: 'Dark Energy',
      stats: [
        { label: 'Share of cosmic energy', value: '68.3%' },
        { label: 'Discovery', value: '1998 supernova observations' },
        { label: 'Effect', value: 'Accelerates the expansion of the universe' }
      ],
      desc: 'In 1998 two teams used Type Ia supernovae to show that the expansion of the universe is accelerating, a result that won the 2011 Nobel Prize in Physics.'
    }
  };

  for (var d = 0; d < D.deepObjects.length; d++) {
    var obj = D.deepObjects[d];
    var deep = DEEP_OBJECTS[obj.id];
    if (!deep) continue;
    obj.name = deep.name;
    obj.desc = deep.desc;
    mixStats(obj, deep.stats);
  }

  /* ---------------- Space milestones ----------------
   * D.milestones has no id: entries are matched by array position, in
   * the same order as js/data.js (1957, 1961, 1965, 1968, 1969, 1971,
   * 1977, 1981, 1990, 1998, 2003, 2012, 2015-07-14, 2015-09-14, 2020,
   * 2021-02-18, 2021-04-29, 2021-12-25, 2022, 2023, 2024-06-25,
   * 2024-10-13). If data.js ever gains an id, switch to mixBy().
   */

  var MILESTONES = [
    {
      title: 'Sputnik 1', agency: 'Soviet Union',
      desc: 'The first artificial satellite. It was 58 cm across and beeped for 21 days, opening the Space Age.'
    },
    {
      title: 'Gagarin reaches space', agency: 'Soviet Union',
      desc: 'Yuri Gagarin orbited Earth once aboard Vostok 1 and became the first human in space. The flight lasted 108 minutes.'
    },
    {
      title: 'First spacewalk', agency: 'Soviet Union',
      desc: 'Leonov spent 12 minutes outside the capsule. His suit ballooned in vacuum on the way back, so he had to vent it to fit through the hatch.'
    },
    {
      title: 'Apollo 8 · Earthrise', agency: 'NASA',
      desc: 'The first crewed flight around the Moon returned the "Earthrise" photograph, the first time humans saw Earth as a planet.'
    },
    {
      title: 'Apollo 11 Moon landing', agency: 'NASA',
      desc: 'Armstrong and Aldrin landed in the Sea of Tranquility. Humans walked on another world for the first time and brought back 21.5 kg of lunar rock.'
    },
    {
      title: 'Salyut 1', agency: 'Soviet Union',
      desc: 'The first space station. It spent 175 days in orbit and showed that long-duration spaceflight and science were possible.'
    },
    {
      title: 'Voyager 1 launch', agency: 'NASA',
      desc: 'It left with the Golden Record, flew past Jupiter and Saturn, and left the Solar System. It still sends data from interstellar space.'
    },
    {
      title: 'First Space Shuttle flight', agency: 'NASA',
      desc: 'Columbia completed a 54-hour test flight. The Shuttle went on to fly 135 missions over the next 30 years.'
    },
    {
      title: 'Hubble Space Telescope', agency: 'NASA / ESA',
      desc: 'The first large space telescope. In more than 30 years it has taken over 1.5 million images and reshaped ideas about galaxy evolution and the age of the universe.'
    },
    {
      title: 'ISS construction begins', agency: 'International',
      desc: 'The Zarya module reached orbit; more than 40 assembly missions built a 420-ton orbital laboratory.'
    },
    {
      title: 'Shenzhou 5', agency: 'CNSA',
      desc: 'Yang Liwei orbited Earth 14 times aboard Shenzhou 5, making China the third country with independent human spaceflight capability.'
    },
    {
      title: 'Curiosity lands on Mars', agency: 'NASA',
      desc: 'After "seven minutes of terror", a sky crane set the one-ton rover down in Gale Crater. Curiosity later found evidence that Mars was once habitable.'
    },
    {
      title: 'New Horizons flies past Pluto', agency: 'NASA',
      desc: 'Humans saw Pluto clearly for the first time: nitrogen-ice plains, water-ice mountains, and a heart-shaped region 3,500 km across.'
    },
    {
      title: 'First detection of gravitational waves', agency: 'LIGO',
      desc: 'Ripples in space-time from a black hole merger crossed 1.3 billion light-years to reach Earth, confirming a prediction Einstein made 100 years earlier.'
    },
    {
      title: "Chang'e 5 sample return", agency: 'CNSA',
      desc: 'It brought back 1,731 g of lunar soil, the first lunar samples returned in 44 years.'
    },
    {
      title: 'Perseverance lands on Mars', agency: 'NASA',
      desc: 'It is collecting rock cores in an ancient delta at Jezero Crater, while the Ingenuity helicopter completed 72 flights on another planet.'
    },
    {
      title: 'Tianhe core module', agency: 'CNSA',
      desc: 'The first module of the Chinese space station reached orbit. Wentian and Mengtian later docked, completing the T-shaped station.'
    },
    {
      title: 'James Webb Space Telescope launch', agency: 'NASA / ESA / CSA',
      desc: 'The 6.5 m infrared telescope reached the Sun-Earth L2 point and captured galaxies from about 300 million years after the Big Bang.'
    },
    {
      title: 'Artemis I', agency: 'NASA',
      desc: 'An uncrewed flight around the Moon and back that validated the SLS rocket and the Orion spacecraft for a crewed return.'
    },
    {
      title: 'Starship first flight', agency: 'SpaceX',
      desc: 'The largest rocket ever flown lifted off. It broke up after about 4 minutes, but it proved that 33 engines could fire together.'
    },
    {
      title: "Chang'e 6 far-side sample return", agency: 'CNSA',
      desc: 'The first mission to bring back samples from the far side of the Moon, 1,935.3 g of them, key material for comparing the near and far sides.'
    },
    {
      title: 'Starship booster catch', agency: 'SpaceX',
      desc: 'The launch tower "chopsticks" caught the returning Super Heavy booster in mid-air for the first time, opening a new stage in reusability.'
    }
  ];

  for (var ms = 0; ms < D.milestones.length && ms < MILESTONES.length; ms++) {
    mix(D.milestones[ms], MILESTONES[ms]);
  }

  /* ---------------- Vehicles and instruments ----------------
   * kind uses the English enum feat-human.js groups by:
   * Launch vehicle / Space telescope / Space station /
   * In development / Retired.
   * firstFlight: ISO dates are language-neutral and are parsed by
   * feat-human.js yearOfDate(), so only the non-ISO value (Long March 9)
   * is overridden here.
   */

  mixBy(D.vehicles, 'id', {
    starship: {
      name: 'Starship', kind: 'Launch vehicle', country: 'United States · SpaceX',
      photoCap: 'Starship nose section · Kennedy Space Center assembly building · 2026-10-13',
      photoCredit: 'NASA',
      desc: 'Both stages are designed to be fully reusable, with a goal of delivering more than 100 tons to low Earth orbit. In 2024 the Super Heavy booster was recovered for the first time.'
    },
    sls: {
      name: 'Space Launch System', kind: 'Launch vehicle', country: 'United States · NASA',
      photoCap: 'Artemis I night launch · Kennedy Space Center Pad 39B · 2022-11-16',
      photoCredit: 'NASA',
      desc: 'The heavy-lift rocket NASA built for Artemis. It can send 27 tons to a trans-lunar orbit and flew for the first time in 2022.'
    },
    saturn5: {
      name: 'Saturn V', kind: 'Retired', country: 'United States · NASA',
      photoCap: 'Apollo 11 lift-off, from a pad camera · Kennedy Space Center Pad 39A · 1969-07-16',
      photoCredit: 'NASA',
      desc: 'The super-heavy rocket of the Apollo program. All 13 launches succeeded and sent 24 astronauts toward the Moon.'
    },
    falconheavy: {
      name: 'Falcon Heavy', kind: 'Launch vehicle', country: 'United States · SpaceX',
      photoCap: 'Falcon Heavy first flight climbing out · Kennedy Space Center Pad 39A · 2018-02-06',
      photoCredit: 'NASA',
      desc: 'Three Falcon 9 cores strapped together. Its first flight sent a sports car into a heliocentric orbit, and it remains one of the most capable reusable rockets in service.'
    },
    longmarch5: {
      name: 'Long March 5', kind: 'Launch vehicle', country: 'China · CNSA',
      photoCap: 'Tianwen-1 lift-off · Wenchang Space Launch Site · 2020-07-23',
      photoCredit: 'China News Service (CC BY 4.0)',
      desc: 'The largest Chinese rocket in service. With 25 tons of low Earth orbit capacity, it launched Chang\'e 5 and Tianwen-1.'
    },
    longmarch9: {
      name: 'Long March 9', kind: 'In development', country: 'China · CNSA',
      firstFlight: 'Planned for the 2030s',
      photoCap: 'Long March 9 1:50 display model · Airshow China 2022, Zhuhai · has not yet flown',
      photoCredit: 'Exhibit of China Aerospace Science and Technology Corporation; photo by Shujianyang (CC0)',
      desc: 'A super-heavy rocket aimed at crewed lunar landing and deep-space missions. It is designed for 150 tons to low Earth orbit, and the reusable variant is still being iterated.'
    },
    ariane6: {
      name: 'Ariane 6', kind: 'Launch vehicle', country: 'Europe · ESA',
      photoCap: 'Ariane 6 first flight leaving the pad · Kourou, French Guiana · 2024-07-09',
      photoCredit: 'ESA - S. Corvaja',
      desc: 'The new European medium-lift rocket. It flew in 2024 and replaces Ariane 5.'
    },
    electron: {
      name: 'Electron', kind: 'Launch vehicle', country: 'New Zealand / United States · Rocket Lab',
      photoCap: 'Electron launching the TROPICS mission · Mahia Peninsula, New Zealand · 2023-05-07',
      photoCredit: 'NASA',
      desc: 'A small launch vehicle built around small satellites and CubeSats. A recovered, reusable version has been tested with at-sea retrieval.'
    },
    jwst: {
      name: 'James Webb Space Telescope', kind: 'Space telescope', country: 'NASA / ESA / CSA',
      photoCap: 'The 18 primary mirror segments of JWST · Goddard cleanroom viewing window · 2017',
      photoCredit: 'NASA',
      desc: 'A 6.5 m primary mirror operating at the Sun-Earth L2 point. It observes the earliest galaxies and exoplanet atmospheres in infrared.'
    },
    hubble: {
      name: 'Hubble Space Telescope', kind: 'Space telescope', country: 'NASA / ESA',
      photoCap: 'Hubble after capture by the Canadarm on Atlantis · 2009',
      photoCredit: 'NASA',
      desc: 'An optical telescope in low Earth orbit. It has made more than 1.5 million observations over 30 years and is one of the most productive scientific instruments ever built.'
    },
    iss: {
      name: 'International Space Station', kind: 'Space station', country: 'International',
      photoCap: 'The ISS in its full configuration · photographed during the Crew-3 Dragon flyaround · 2021-11-08',
      photoCredit: 'NASA',
      desc: 'The largest structure in orbit: 109 m across, about 420 tons, built by 15 countries working together.'
    },
    tiangong: {
      name: 'Tiangong Space Station', kind: 'Space station', country: 'China · CNSA',
      photoCap: 'The complete Tiangong station · photographed by the Shenzhou 16 crew during their flyaround before return · 2023-11',
      photoCredit: 'China Manned Space Agency (image by Xinhua)',
      desc: 'A T-shaped station made of the Tianhe core module and the Wentian and Mengtian experiment modules. In-orbit construction was completed in 2022.'
    }
  });

  /* ---------------- Future plans ----------------
   * horizon and items keep 4-digit years: feat-human.js extracts them
   * with /(20\d{2})/ to place the milestones timeline.
   */

  mixBy(D.future, 'id', {
    artemis: {
      name: 'Return to the Moon', horizon: '2020s — 2030s', agency: 'NASA / international partners',
      photoCap: 'James Webb Space Telescope · Goddard assembly · NASA',
      desc: 'Build a sustainable presence at the south pole of the Moon, using water ice in permanently shadowed regions, and use it as a proving ground for Mars.',
      items: [
        'Artemis II: crewed lunar flyby',
        'Artemis III: first crewed landing (planned)',
        'Lunar Gateway: a station in lunar orbit'
      ]
    },
    marscrew: {
      name: 'Crewed mission to Mars', horizon: '2030s — 2040s', agency: 'NASA / SpaceX / international partners',
      photoCap: 'Concept image of a Mars base · NASA',
      desc: 'A one-way trip takes about 6–9 months, and the crew must survive radiation and weightlessness. Surface gravity on Mars is only 38% of that on Earth, so the return trip needs propellant made on site.',
      items: [
        'Mars transfer windows open every 26 months',
        'Nuclear thermal propulsion and orbital refueling are key',
        'Surface habitats and radiation shielding'
      ]
    },
    moonbase: {
      name: 'International Lunar Research Station', horizon: '2035 (planned)', agency: 'China / Russia / international partners',
      photoCap: 'Concept image of the Starship human landing system on the Moon · NASA',
      desc: 'Build a long-term research station at the lunar south pole, using solar power and 3D-printed building materials from regolith, and run lunar astronomy and resource experiments.',
      items: [
        "Chang'e 7: survey the south pole in 2026",
        "Chang'e 8: resource experiments in 2028",
        'Oxygen production and building materials from regolith'
      ]
    },
    exoplanet: {
      name: 'Finding another Earth', horizon: '2027 — 2040s', agency: 'NASA / ESA / worldwide',
      photoCap: 'Concept image of planet formation · NASA',
      desc: 'More than 5,900 exoplanets have been confirmed. The next step is to image an Earth-like planet directly and look in its atmosphere for oxygen, water vapor, and biosignatures.',
      items: [
        'Roman Space Telescope: launch in 2027 (planned)',
        'Extremely Large Telescope (ELT): 39 m primary mirror',
        'LIFE / HabEx: the search for life beyond the Solar System'
      ]
    },
    tianwen3: {
      name: 'Mars sample return', horizon: 'Launch in 2028 (planned)', agency: 'CNSA',
      photoCap: 'Perseverance selfie · Jezero Crater · NASA',
      desc: 'Bringing Martian surface samples back to Earth is the most direct way to look for evidence of ancient life. The sample tubes from Perseverance are waiting to be collected.',
      items: [
        'Tianwen-3: launch in 2028',
        'The NASA-ESA plan is being redesigned',
        'Samples can be analyzed repeatedly in Earth laboratories'
      ]
    }
  });

  /* ---------------- Sources ----------------
   * Matched by array position: 7 entries in the same order as data.js.
   * `org` stays as data.js defines it.
   */

  var SOURCES = [
    { label: 'NASA Planetary Fact Sheet', license: 'Public Domain' },
    { label: 'Planck 2018 cosmological parameters', license: 'CC BY-SA' },
    { label: 'NASA / ESA image archives', license: 'Public Domain' },
    { label: 'Solar System Scope planet textures (2048px)', license: 'CC BY 4.0' },
    { label: 'IAU planet definition and moon naming (2025)', license: 'CC BY 4.0' },
    { label: 'LIGO / Virgo gravitational-wave observations', license: 'CC BY 4.0' },
    { label: 'Laniakea Supercluster (Tully et al. 2014, Nature)', license: 'Data citation' },
    { label: 'Moon and Pluto global maps (10 bodies, 1024×512)', license: 'Public Domain / CC0 1.0 / attribution' }
  ];

  for (var s = 0; s < D.sources.length && s < SOURCES.length; s++) {
    if (SOURCES[s].label) D.sources[s].label = SOURCES[s].label;
    if (SOURCES[s].license) D.sources[s].license = SOURCES[s].license;
  }
})(window.COSMOS = window.COSMOS || {});
