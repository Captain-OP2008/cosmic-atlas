/* ============================================================
 * COSMOS ATLAS · 英文文案覆盖（content-en.js）
 * ------------------------------------------------------------
 * 只在英文模式（?lang=en / localStorage）下生效；中文模式首行 return，零影响。
 * 本文件不新增章节，只覆盖 js/content-*.js 已注册的 12 章文案字段：
 *   title / titleEn / part / kicker / oneLiner / lead / paragraphs[] /
 *   facts[{v,u,l}] / hint / quote{text,cite} / cta{label}
 * 不覆盖：num / index / layout / widget / cta.goto / futurePlans 以外的扩展字段。
 *   —— title 是英文主标题；titleEn 保留中文副标题原样（双语并列）。
 * 数字口径与 js/data.js、js/content-*.js 一致，只做英文写法换算：
 *   138 亿年 → 13.8 billion years；465 亿光年 → 46.5 billion light-years；
 *   2,300 万光年 → 23 million light-years。
 * 加载顺序：index.html 把它接在所有 content-*.js 之后、ui.js / boot.js 之前。
 * ============================================================ */
(function (COSMOS) {
  'use strict';

  var i18n = COSMOS.i18n;
  if (!i18n || i18n.lang !== 'en') return;

  var C = COSMOS.CONTENT;
  if (!C) return;

  /* 逐章覆盖：只写给出的字段；cta 只换 label，保留原 goto。
     缺字段（如 galaxies / extreme 没有 hint）就不写，保持原状。 */
  function set(id, data) {
    var c = C[id];
    if (!c || !data) return;
    for (var k in data) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
      if (k === 'cta') continue;
      c[k] = data[k];
    }
    if (data.cta && c.cta && data.cta.label) c.cta.label = data.cta.label;
  }

  /* ============================================================
   * 00 · 序章
   * ============================================================ */
  set('hero', {
    title: 'The Universe',
    titleEn: '宇宙',
    part: 'Prologue',
    kicker: 'Astronomy · An interactive atlas',
    lead: 'Everything you can see was once part of a star.',
    paragraphs: [
      'Compress 13.8 billion years of cosmic history into one hands-on journey: start at the Solar System, pass through stars, black holes and galaxies, then look back at Earth.'
    ],
    facts: [
      { v: '13.8', u: 'billion years', l: 'Age of the universe · Planck 2018' },
      { v: '2', u: 'trillion', l: 'Galaxies · Conselice 2016' },
      { v: '93', u: 'billion light-years', l: 'Diameter of the observable universe' }
    ],
    hint: 'Drag to rotate · Scroll to zoom · Click the core to dive in',
    cta: { label: 'Start the journey' }
  });

  /* ============================================================
   * 01 · 宇宙总览
   * ============================================================ */
  set('overview', {
    title: 'The Cosmos',
    titleEn: '宇宙总览',
    part: 'I · The Cosmos',
    kicker: 'Our cosmic address',
    lead: 'Our home sits on one filament of the Laniakea Supercluster.',
    paragraphs: [
      '13.8 billion years ago the universe was extremely hot and dense. As space expanded it cooled; nuclei and electrons combined into neutral atoms, and light could finally travel freely. That first free light is the cosmic microwave background we still map today.',
      'Gravity gathered matter into filaments, nodes and voids — the cosmic web. In 2014 Tully and colleagues used galaxy motions to define the Laniakea Supercluster: about 520 million light-years across, with roughly 100,000 galaxies.',
      'The Milky Way lies near the edge of Laniakea and moves toward the Great Attractor at its center at about 600 km/s. The gold streamlines are filaments inside the supercluster; the faint blue threads are the wider cosmic web. The red dot is us.'
    ],
    facts: [
      { v: '520', u: 'million light-years', l: 'Laniakea diameter · Tully 2014' },
      { v: '100,000', u: '', l: 'Galaxies in the supercluster · estimate' },
      { v: '600', u: 'km/s', l: 'Milky Way speed toward the Great Attractor' },
      { v: '46.5', u: 'billion light-years', l: 'Radius of the observable universe' }
    ],
    hint: 'Drag to rotate · Scroll to zoom · Gold marks supercluster filaments; the red dot is the Milky Way',
    quote: {
      text: 'The universe has no center and no edge — so far, no observation supports the opposite.',
      cite: 'Standard cosmological model ΛCDM'
    }
  });

  /* ============================================================
   * 02 · 太阳系
   * ============================================================ */
  set('solar', {
    title: 'The Solar System',
    titleEn: '太阳系',
    part: 'II · The Solar System',
    kicker: 'A Solar System you can set to any date',
    oneLiner: 'Scrub the date; the planets return to where they really were.',
    lead: 'Turn the date to any day and the planets return to their real positions — orbital theory, not animation.',
    paragraphs: [
      'The Solar System is not eight concentric circles. When this chapter opens, the eight planets are placed by public Keplerian orbital theory for the current UTC instant; set the date to 2024-04-08 and Earth, the Moon and the Sun return to the moment of the total solar eclipse. The replayable range is 1800–2100.',
      "Orbit lines use true eccentricity: Mercury's e is 0.206 and Pluto's 0.249, so they really do swing nearer and farther from the Sun. To fit Mercury and Neptune on one screen, radial distance is compressed as the square root of AU; body sizes use another scale, because the Sun is 109 Earth diameters across and would otherwise fill the frame.",
      "Twelve moons are selectable: the Moon, Phobos and Deimos, Io through Callisto, Enceladus, Rhea and Titan, Triton, and Charon. Their positions also come from orbital elements, compressed into 4.5–8× the parent planet's radius. Click a console button or a label and the camera follows.",
      'Events lists equinoxes, solstices, planetary oppositions, greatest elongations and eclipses over the next ten years. Eclipses are not canned animations: the code compares the actual geometry of Sun, Earth and Moon, tests whether the umbra reaches the surface or Earth\'s shadow covers the lunar disc, and sorts them into total, annular, partial and penumbral. Jump sets the clock to that day.',
      "Tonight's sky flattens the same ephemeris onto a horizon chart: pick a city and a time to read altitude and azimuth for the Sun, Moon and planets, plus lunar phase and illuminated fraction. The numbers can be exported as JSON for cross-checking against planetarium software.",
      'Common misconception: a Solar System model can show true sizes and true distances at the same time. Shrink the Sun to a basketball and Earth becomes a 1 mm grain 26 m away, with Neptune at 780 m — no screen holds both. Compression is the only way to keep the model both visible and honest. Scale check: step outside tonight; Jupiter may be hanging beside a bright star. Open the sky panel and find it.'
    ],
    facts: [
      { v: '8', u: 'planets', l: 'Plus 5 dwarf planets' },
      { v: '99.86', u: '%', l: "Sun's share of the Solar System's mass" },
      { v: '4.6', u: 'billion years', l: 'Age of the Solar System' },
      { v: '1800–2100', u: 'CE', l: 'Replayable date range' }
    ],
    hint: "Drag to rotate · Scroll to zoom · Change the date or speed · Click a planet or moon for its file · Events and tonight's sky"
  });

  /* ============================================================
   * 03 · 行星对比
   * ============================================================ */
  set('compare', {
    title: 'Planetary Comparison',
    titleEn: '行星对比',
    part: 'II · The Solar System',
    kicker: 'Put all eight planets on one ruler',
    lead: 'The same elements, different gravity and atmospheres — together they write the planets into four kinds of worlds.',
    paragraphs: [
      "Line the planets up on one ruler and the differences show at once. Earth's diameter is 12,742 km and Jupiter's 139,820 km; Venus is 12,104 km — almost Earth's twin in size, yet its surface gravity is 8.87 m/s², slightly weaker than Earth's.",
      'Gravity has one formula: g = GM/R². The same 60 kg body feels about 588 N on Earth and only about 223 N on Mars. The mass does not change; the planet simply pulls less.',
      "Atmosphere is another ruler. Venus's atmosphere is 96.5% carbon dioxide and its surface pressure is about 92 standard atmospheres; Mars's atmosphere is 95.32% carbon dioxide too, but its pressure is only 0.6% of Earth's. Same ingredient, different thickness, two different worlds.",
      "Mercury has almost no atmosphere — strictly an exosphere, with pressure below a trillionth of Earth's. Earth's air is 78.08% nitrogen and 20.95% oxygen; Jupiter and Saturn are mostly hydrogen and helium and have no solid surface.",
      "Common misconception: the thicker the atmosphere, the hotter the planet. Venus is hot because carbon dioxide's greenhouse effect stacks on 92 atmospheres of pressure. Mars's air is also mostly carbon dioxide, but far too thin to hold heat; its average temperature is −63 °C.",
      'Scale check: next time you complain about your weight, weigh yourself on another planet. Your mass is the same everywhere, but Jupiter would make you more than twice as heavy and Mars light enough to jump higher.'
    ],
    facts: [
      { v: '12,742', u: 'km', l: 'Earth diameter' },
      { v: '9.807', u: 'm/s²', l: 'Earth surface gravity' },
      { v: '96.5', u: '%', l: 'Carbon dioxide in the Venusian atmosphere' },
      { v: '0.6', u: '%', l: "Mars pressure relative to Earth's" }
    ],
    hint: 'Switch the three tabs · Enter a weight to read it on each planet · ←/→ switches tabs'
  });

  /* ============================================================
   * 04 · 致密天体
   * ============================================================ */
  set('compact', {
    title: 'Compact Objects',
    titleEn: '致密天体',
    part: 'III · Deep Space',
    kicker: 'Three forms of stellar remnant',
    lead: 'The same gravity crushes stellar remnants to three different sizes.',
    paragraphs: [
      "White dwarfs, neutron stars and black holes are all remnants of burned-out stars; what differs is how small the remnant has been crushed. A white dwarf is held up by electron degeneracy pressure at a density near 10⁹ kg/m³; a neutron star is held up by neutron degeneracy pressure and is only about 12 km across; a black hole's gravity is so strong that light cannot escape its event horizon.",
      "The event horizon radius scales with mass: rs = 2GM/c², about 2.95 km per solar mass. A 10-solar-mass black hole has a horizon about 59 km across; Sgr A* at the Milky Way's center is about 4.3 million solar masses, with a horizon about 25 million km across — roughly 40% of the average distance from Mercury to the Sun.",
      "A common misconception says a black hole is a vacuum cleaner that pulls in everything nearby. Outside the horizon, gravity still falls off with the square of distance: a star keeps orbiting safely unless it loses orbital energy, just as a satellite stays up around Earth as long as it is fast enough. Distance and orbit decide a body's fate, not a vague 'pull'. The center of our Galaxy holds a black hole of 4.3 million solar masses."
    ],
    facts: [
      { v: '2.95', u: 'km', l: 'Schwarzschild radius per solar mass' },
      { v: '12', u: 'km', l: 'Typical neutron star radius' },
      { v: '10⁹', u: 'kg/m³', l: 'White dwarf density scale' },
      { v: '1.44', u: 'solar masses', l: 'Chandrasekhar limit' }
    ],
    hint: 'Drag to rotate · Ctrl + scroll to zoom · Esc to reset · Switch tabs to see all three remnants',
    quote: {
      text: 'Compress the Sun inside 3 km and it becomes a black hole — the laws of physics do not change; only a density limit is crossed.',
      cite: 'Schwarzschild solution (1916)'
    }
  });

  /* ============================================================
   * 05 · 星系动物园
   * ============================================================ */
  set('galaxies', {
    title: 'Galaxy Zoo',
    titleEn: '星系动物园',
    part: 'IV · The Deep Universe',
    kicker: 'Direct manipulation · L2',
    lead: 'Galaxies are not specimens. They merge, they evolve, and they record the age of the universe for us.',
    paragraphs: [
      "In 1926 astronomer Edwin Hubble sorted galaxies by shape into spirals, ellipticals and irregulars — later drawn as a 'tuning fork'. This is a dictionary of shapes, not an evolutionary tree: it does not say which type becomes which, only what a galaxy looks like now.",
      'Take the Whirlpool Galaxy M51: two arms unwind from the bulge and grow looser outward. The arms are not fixed bands of matter but density waves: stars and gas in the disk are compressed as they orbit through the wave, like a traffic jam on a highway — the cars keep moving while the jam moves. The arms are brighter because young stars form there in batches.',
      'Elliptical galaxies hold almost no cold gas, so star formation ended long ago and their light runs red-yellow, dominated by old stars. They sit at the centers of galaxy clusters and may be products of repeated mergers; M87 is a supergiant elliptical in the Virgo Cluster.',
      'Irregular galaxies are mostly mid-change: the Antennae Galaxies are two galaxies colliding, tidal forces flinging stars and gas into two long tails; the Cartwheel Galaxy is the ring left after a small galaxy punched through a disk. The Large Magellanic Cloud is an irregular companion of the Milky Way, and supernova 1987A was born there.',
      'Zoom in and the Milky Way looks more like a barred spiral: a bar of stars crosses the center and the arms spring from its ends. Classification keeps expanding — astronomers now add ring and lenticular classes — but shape, color and motion remain the criteria.',
      "Colors in the photos are not what your eyes would see: Hubble images combine visible light and narrow-band filters, Spitzer images use infrared, and the final picture is a composite of wavelengths. Color marks temperature, age or dust distribution, not a galaxy's 'true' color. That is why the same object can look like two different things through two telescopes.",
      'The Milky Way is merging too: in about 4 billion years it will collide with Andromeda. Galaxy shape is a process, not an endpoint. Think of the Milky Way as a city: the bulge is downtown, the arms are ring roads, and the Sun sits on a suburban side street — and this city is only one of roughly 2 trillion in the observable universe.'
    ],
    facts: [
      { v: '2', u: 'trillion', l: 'Estimated galaxies in the observable universe' },
      { v: '23', u: 'million light-years', l: 'Distance to spiral galaxy M51' },
      { v: '4', u: 'billion years from now', l: 'Predicted Milky Way–Andromeda merger' }
    ]
  });

  /* ============================================================
   * 07 · 极端宇宙
   * ============================================================ */
  set('extreme', {
    title: 'Extreme Universe',
    titleEn: '极端宇宙',
    part: 'IV · The Deep Universe',
    kicker: 'Parameter exploration · L3',
    lead: 'About 95% of the universe is invisible to us, and it decides how the universe grows.',
    paragraphs: [
      'On 14 September 2015 the two LIGO detectors recorded the same signal, lasting about 0.2 seconds: ripples in spacetime from two black holes merging 1.3 billion light-years away passed through Earth. It was the first direct detection of gravitational waves, and the first direct test of a prediction Einstein made a century earlier.',
      "When a gravitational wave passes, space stretches and squeezes. LIGO measures that deformation with two 4-km arms: a strain of 10⁻²¹ means an arm-length change of about 4 × 10⁻¹⁸ m, less than a thousandth of a proton's diameter. Detecting it takes vacuum, multi-stage isolation and squeezed light — an instrument built to be as quiet as physics allows.",
      'On 17 August 2017 LIGO and Virgo detected two neutron stars merging (GW170817), and dozens of telescopes worldwide found its light in the same patch of sky — the first multi-messenger observation. Gravitational waves became not just a confirmation of theory but a new way to measure the universe.',
      'In the 1970s Vera Rubin measured galaxy rotation curves and found that stars at the outskirts moved at nearly constant speed instead of slowing as Newtonian gravity predicts. That extra unseen mass is dark matter. It does not shine and does not interact with light; "dark" means unseen, not black. Gravitational lensing, galaxy clusters and the cosmic microwave background give independent support.',
      'In 1998 two teams used type Ia supernovae to find that cosmic expansion is not slowing but accelerating. The unknown component driving it is called dark energy. One common claim needs correction: it is not a force pushing galaxies apart; it is an energy density of space itself that keeps expansion accelerating. It accounts for 68.3% of the universe, and its nature remains an open problem.',
      'The three extremes share one thread: they hide in the unseen. Gravitational waves are distortions of spacetime itself, dark matter leaves only gravitational traces, and dark energy only changes the acceleration of expansion. The methods differ too — interferometers measure length changes, rotation curves and lensing measure mass distribution, supernovae measure distance against redshift.',
      "Planck 2018 puts ordinary matter at 4.9%. The atoms in our bodies and telescopes are a rounding error of the universe; the other ~95% is physics' to-do list. The next gravitational wave, the next deep-field image, may cross one line off that list."
    ],
    facts: [
      { v: '2015-09-14', u: '', l: 'LIGO makes the first direct detection of gravitational waves (GW150914)' },
      { v: '1.3', u: 'billion light-years', l: 'Distance to the binary black hole merger' },
      { v: '26.8%', u: '', l: 'Dark matter share of the universe (Planck 2018)' },
      { v: '68.3%', u: '', l: 'Dark energy share of the universe (Planck 2018)' }
    ]
  });

  /* ============================================================
   * 08 · 航天里程碑
   * ============================================================ */
  set('history', {
    title: 'Space Age',
    titleEn: '航天里程碑',
    part: 'V · Human Exploration',
    kicker: 'Timeline · 1957 — 2024',
    lead: 'Drag the year and watch how fast humans left the ground.',
    paragraphs: [
      'On 4 October 1957 the Soviet Union put Sputnik 1, 58 cm across, into low Earth orbit. It carried no instruments, only a radio beep that lasted 21 days, and it proved one thing: humans could place an object in orbit and keep it circling Earth. From that year on, Earth had a man-made layer around it.',
      'In 1961 Gagarin rode Vostok 1 once around Earth in 108 minutes; in 1965 Leonov spent 12 minutes outside the capsule.',
      'In 1969 Apollo 11 brought back 21.5 kg of lunar rock. These three milestones answer three different questions: can a human survive the trip, can a human work outside, can a human reach another world? Each step made the next one possible.',
      "Putting a satellite in orbit is really about throwing it fast enough. Low Earth orbit needs about 7.9 km/s — the equivalent of travelling from Beijing to Shanghai in one second. At that speed the object's falling arc matches the curve of Earth's surface, so it falls forever and never reaches the ground. That is an orbit.",
      "Space stations answered a different question: can humans live in orbit long enough to turn 'a visit' into 'a home'? Salyut 1 spent 175 days in orbit in 1971.",
      "Assembly of the International Space Station began in 1998 and reached 420 tonnes after more than 40 assembly flights; the Tianhe core module reached orbit in 2021, and China's space station completed its T-shape in 2022. The answer is not in the launch but in the daily routine of resupply, life support and repair.",
      'Deep space has a method too: fly by, orbit, land, sample and return. Voyager 1 left in 1977; the Hubble Space Telescope reached orbit in 1990 and has taken more than 1.5 million images.',
      "New Horizons flew past Pluto in 2015; Chang'e 5 returned 1,731 g of lunar soil in 2020; Chang'e 6 returned 1,935.3 g from the lunar far side in 2024. Every mission lowers the risk for the next.",
      'A common misconception says spaceflight is just a handful of spectacular missions with no bearing on daily life. In fact navigation, weather forecasts, disaster monitoring and satellite communications all depend on hardware in orbit, and materials and medical experiments from the ISS flow back into industries on the ground. Scale check: every point on this timeline is a date on which someone handed a piece of equipment to vacuum; the location icon on your phone is this timeline extended into your hand.'
    ],
    facts: [
      { v: '1957', u: '', l: 'First artificial satellite · Sputnik 1' },
      { v: '108', u: 'minutes', l: "Gagarin's single orbit · 1961" },
      { v: '21.5', u: 'kg', l: 'Lunar rock returned by Apollo 11 · 1969' },
      { v: '420', u: 'tonnes', l: 'Mass of the International Space Station · assembled from 1998' },
      { v: '1,935.3', u: 'g', l: "Chang'e 6 far-side samples · 2024" }
    ],
    hint: 'Drag the year slider · Click a milestone for details · ←/→ adjust the year · Esc to reset',
    quote: {
      text: 'Earth is the cradle of humanity, but mankind cannot stay in the cradle forever.',
      cite: 'Konstantin Tsiolkovsky'
    }
  });

  /* ============================================================
   * 09 · 现役与未来载具
   * ============================================================ */
  set('vehicles', {
    title: 'Launch Vehicles',
    titleEn: '现役与未来载具',
    part: 'V · Human Exploration',
    kicker: 'Height comparison · Payload capacity',
    lead: 'Line the rockets up on a ruler at true height.',
    paragraphs: [
      'Judge a rocket by two things: payload and orbit. Low Earth orbit (LEO) and trans-lunar injection (TLI) capacities differ a lot, so any number must state its orbit and its payload definition.',
      'Starship stands 121 m tall with a designed LEO capacity of 150 tonnes; Saturn V stood 110.6 m with 140 tonnes to LEO; the Space Launch System SLS Block 1 stands 98 m with 95 tonnes to LEO and 27 tonnes to TLI. Numbers are comparable only when read together with their orbit.',
      'Think of a rocket as an express delivery that burns itself: most of its mass is propellant and structure, and only a small fraction reaches orbit as cargo. That is why reusability matters — recovering a first stage does not save propellant; it turns the most expensive structure from a consumable into an asset that can fly again.',
      'Medium rockets have their own jobs: Falcon Heavy is 70 m tall with 63.8 tonnes to LEO; Long March 5 is 57 m tall with 25 tonnes to LEO, and it launched both Chang\'e 5 and Tianwen-1.',
      'Ariane 6 is 63 m tall with 21.65 tonnes to LEO; Electron is 18 m tall with 0.3 tonnes to LEO for small satellites. More capacity is not automatically better: orbit, launch-site latitude and flight rate drive cost too.',
      'Not every "big" can be measured by height. The JWST primary mirror is 6.5 m across and its sunshield spans about 20 m once deployed; Hubble is 13.2 m long with a 2.4 m primary.',
      "Space stations are measured by structure: the ISS is 109 m long and about 420 tonnes; China's T-shaped station is about 55 m long and about 100 tonnes. Put telescopes and rockets on the same height chart and the comparison goes wrong.",
      'A common misconception: the bigger the rocket, the more advanced. Saturn V first flew in 1967 and still lifts more to LEO than most rockets in service, but its cost and flight rate do not suit today\'s needs.',
      'Vehicle choice is a compromise among capacity, reuse, reliability and budget — which is why Starship, SLS and Long March 9 take different roads. Scale check: every metric comes down to one plain question — how many people and how much equipment can leave the ground in one flight.'
    ],
    facts: [
      { v: '121', u: 'm', l: 'Starship height · 150 tonnes to LEO design' },
      { v: '110.6', u: 'm', l: 'Saturn V height · all 13 flights successful' },
      { v: '27', u: 'tonnes', l: 'SLS payload to trans-lunar injection' },
      { v: '6.5', u: 'm', l: 'JWST primary mirror diameter' },
      { v: '420', u: 'tonnes', l: 'International Space Station mass' }
    ],
    hint: 'Switch filters · Click a vehicle for details · Height chart at true scale'
  });

  /* ============================================================
   * 10 · 未来计划
   * ============================================================ */
  set('future', {
    title: "What's Next",
    titleEn: '未来计划',
    part: 'V · Human Exploration',
    kicker: 'Timeline · Computable',
    lead: 'Break "go to Mars" into a distance and a weight you can calculate.',
    paragraphs: [
      'The next decade has three main lines: return to the Moon (Artemis), send crews to Mars, and find another Earth. The Moon serves as a proving ground for Mars: water ice in permanently shadowed polar craters can become water and oxygen, while low gravity and radiation test equipment for long stays. Every year on a plan schedule rests on a chain of tests that must pass in order.',
      'A Mars mission is first an orbital problem. Earth and Mars align for launch only once every 26 months; along a Hohmann transfer the one-way trip takes about 6–9 months. Miss the window and you wait more than two years — celestial mechanics sets the schedule, not the budget.',
      "Martian surface gravity is 3.71 m/s², 38% of Earth's 9.807 m/s². An astronaut's mass does not change, but a scale on Mars reads about 0.38× the Earth value; with the same push-off, a jump goes about 2.64× higher.",
      'The real difficulty is not "weighing less". Long-term weightlessness causes bone loss and muscle wasting, deep-space radiation doses run far above low Earth orbit, and return propellant must be made on Mars — none of these are solved by gravity.',
      'A common misconception: Mars is reachable whenever it is closest. The closest approach is about 55 million km and the farthest more than 400 million km; closest does not mean cheapest. A Hohmann transfer requires Mars to be in exactly the right position at departure, so mission design sets the window first, then the capacity, and only then the crew schedule.',
      'Another direction is exoplanets: more than 5,900 confirmed. The next step is not "find one more" but image a rocky planet directly and look for oxygen, water vapor and methane together in its atmospheric spectrum.',
      'The Roman Space Telescope and 39-m-class ground telescopes are being prepared for that. Scale check: every future plan finally answers the same question — can humans live on another world, long-term and repeatedly?'
    ],
    facts: [
      { v: '26', u: 'months', l: 'Interval between Mars transfer windows' },
      { v: '6–9', u: 'months', l: 'One-way Mars flight (Hohmann transfer, approx.)' },
      { v: '3.71', u: 'm/s²', l: 'Martian surface gravity' },
      { v: '38', u: '%', l: 'Mars gravity / Earth gravity' },
      { v: '5,900+', u: '', l: 'Confirmed exoplanets · NASA Exoplanet Archive' }
    ],
    hint: 'Drag distance and speed · Enter a weight · Click a plan for details',
    /* 未来计划组件扩展字段：feat-human.js 读 content.futurePlans[p.id]。
       这里只翻定性判断，不引入新数字；时间与机构以 js/data-en.js 覆盖后的 D.future 为准。 */
    futurePlans: {
      artemis: {
        status: 'Artemis 1 completed an uncrewed lunar flyby in 2022; the schedule for later crewed missions is still being adjusted.',
        challenge: 'The lunar lander, cryogenic propellant transfer in orbit, power through the lunar night and dust protection all still need verification.'
      },
      marscrew: {
        status: 'Still at the concept and prototype stage: Starship is in test flights; nuclear thermal propulsion and orbital refueling are not yet finalized.',
        challenge: 'Long-duration radiation, bone and muscle loss from weightlessness, and producing return propellant on Mars.'
      },
      moonbase: {
        status: "Chang'e 7 and Chang'e 8 are moving ahead on public plans; the research station is in engineering study and site selection.",
        challenge: 'Extreme polar lighting and temperatures, abrasive lunar dust, and energy management for long uncrewed periods.'
      },
      exoplanet: {
        status: 'The Roman Space Telescope is in assembly and testing; the primary mirror segments of the Extremely Large Telescope (ELT) are being manufactured.',
        challenge: 'Suppress starlight to extremely low levels and rule out non-biological sources of biosignatures.'
      },
      tianwen3: {
        status: 'Tianwen-3 is planned for launch in 2028; NASA and ESA are redesigning their Mars sample return plans.',
        challenge: 'Mars ascent, orbital rendezvous, sample sealing and planetary protection.'
      }
    }
  });

  /* ============================================================
   * 06 · 星系碰撞（GALAXY COLLISION）
   * ============================================================ */
  set('collision', {
    title: 'Galaxy Collision',
    titleEn: '星系碰撞',
    part: 'IV · The Deep Universe',
    kicker: 'TOOMRE 1972 · RESTRICTED N-BODY',
    oneLiner: '12,000 stars compute their own tidal bridge and tail.',
    lead: 'Two galaxies brush past each other, and their stars are pulled into bridges and tails.',
    paragraphs: [
      'Two galaxies: the main one holds 100 billion solar masses, with a disk radius of 11 kpc; the companion can be set to half or a quarter of that mass. The 12,000 stars on screen are tracers — they feel only the gravity of the two cores and never pull on one another, the restricted N-body method Toomre used in 1972. At the default rate, one real second equals 10 million years.',
      'When the companion sweeps past, stars on the near side are slowed and stars on the far side are flung faster. The old circular orbits bend into long tidal bridges and tidal tails. These are not streams of debris: they are stars whose paths were rewritten, arranged into an arc. Stars sit light-years apart, so almost none actually collide. The Antennae Galaxies (NGC 4038/4039) are in this phase right now.',
      'Same path, different spin. When the companion orbits prograde — spinning the same way as the main disk — the tidal pull adds up in the same direction on every pass, and the tail grows longer. When the orbit is retrograde, the pulls cancel and the disk stays nearly intact. The two scenes that differ only in spin direction make the comparison directly.',
      'Send the companion almost straight through the disk — an impact parameter of just 0.5 kpc — and stars pick up radial motion; their elliptical orbits precess and, about 110 million years later, settle into a ring. Lynds and Toomre used this mechanism to explain ring galaxy formation in 1976: the ring is not new material, just the old disk rearranged. The Cartwheel Galaxy is one example.',
      'Spiral arms are not a fixed crowd of stars. They are a density wave: stars keep orbiting, briefly bunching as they pass through, like traffic slowing at a work zone — the cars move, the jam moves too. Lin and Shu proposed this picture in 1964. In the Spiral Winds Up scene the galaxy stays put while the arms tighten within a few turns, so the wave needs steady driving to persist. The Whirlpool Galaxy (M51) is being stirred this way by its companion.',
      'This simulation has no dark matter halos, and therefore no dynamical friction: the two cores can pass through each other and separate again, while real galaxies are dragged into mergers. Their gravity is softened inside 1.2 kpc to keep the close encounter stable. In 2025, Sawala and colleagues reported that the Milky Way and Andromeda are not certain to collide at all. Every second you drag here rewrites an orbit.'
    ],
    facts: [
      { v: '100 billion', u: 'M☉', l: 'Mass of the main galaxy' },
      { v: '11', u: 'kpc', l: 'Radius of the main galaxy disk' },
      { v: '10', u: 'Myr', l: 'Simulated time per real second at default speed' },
      { v: '110', u: 'Myr', l: 'Time to form a ring after a bullseye pass' }
    ],
    hint: 'Drag to rotate · Scroll to zoom · Space to pause'
  });

  /* ============================================================
   * 11 · 终章
   * ============================================================ */
  set('finale', {
    title: 'Pale Blue Dot',
    titleEn: '暗淡蓝点',
    part: 'Finale',
    kicker: '14 February 1990 · Voyager 1',
    lead: 'From 6 billion km away, Earth is a blue dot 0.12 pixels across.',
    paragraphs: [
      "At Carl Sagan's request, Voyager 1 turned back before leaving the Solar System and took this image. Earth covers less than one pixel — every war, every love, every civilization is on that single point.",
      'The photo reminds us: exploring the universe is not about leaving Earth. It is about knowing more clearly that we have only this one planet.'
    ],
    facts: [
      { v: '6.04', u: 'billion km', l: 'Distance from Earth when photographed' },
      { v: '0.12', u: 'pixels', l: "Earth's diameter in the photo" },
      { v: '1977', u: '', l: 'Voyager 1 launch' },
      { v: '1990', u: '', l: 'Year the photo was taken' }
    ],
    quote: {
      text: "Look again at that dot. That's here. That's home. That's us.",
      cite: 'Carl Sagan, Pale Blue Dot'
    }
  });

})(window.COSMOS = window.COSMOS || {});
