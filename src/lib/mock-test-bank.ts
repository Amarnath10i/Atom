// Static MCQ bank for the LAMA mock-test taker.
// Each question is JEE/NEET-style with 4 options (A-D), a single correct answer,
// topic + subtopic metadata (used to drive memory_atoms + weak_topics), and a
// difficulty 1-5. Expected time is the per-question budget in seconds.
//
// The bank is intentionally compact (~60 Q) and is *sampled* with subject
// quotas to assemble 100 / 120 / 160-mark tests on demand.

export type MCQ = {
  id: string;
  subject: "Physics" | "Chemistry" | "Maths" | "Biology";
  topic: string;
  subtopic: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  expectedTimeSec: number;
  question: string;
  options: { key: "A" | "B" | "C" | "D"; text: string }[];
  correct: "A" | "B" | "C" | "D";
  explanation: string;
};

export const QUESTION_BANK: MCQ[] = [
  // ── PHYSICS ───────────────────────────────────────────────────────────────
  {
    id: "p1", subject: "Physics", topic: "Kinematics", subtopic: "1D motion", difficulty: 2, expectedTimeSec: 90,
    question: "A body starts from rest and moves with uniform acceleration 4 m/s². Distance covered in the 5th second is:",
    options: [{key:"A",text:"16 m"},{key:"B",text:"18 m"},{key:"C",text:"20 m"},{key:"D",text:"22 m"}],
    correct: "B",
    explanation: "s_n = u + a/2 (2n-1) = 0 + 4/2 × 9 = 18 m.",
  },
  {
    id: "p2", subject: "Physics", topic: "Laws of Motion", subtopic: "Friction", difficulty: 3, expectedTimeSec: 120,
    question: "A block of mass 5 kg rests on a horizontal floor (μ = 0.4). Minimum horizontal force to just move it (g=10) is:",
    options: [{key:"A",text:"10 N"},{key:"B",text:"15 N"},{key:"C",text:"20 N"},{key:"D",text:"25 N"}],
    correct: "C",
    explanation: "F = μ mg = 0.4 × 5 × 10 = 20 N.",
  },
  {
    id: "p3", subject: "Physics", topic: "Work Energy Power", subtopic: "Work-energy theorem", difficulty: 3, expectedTimeSec: 120,
    question: "A 2 kg body moving at 4 m/s is brought to rest by a constant force in 0.5 s. Work done by the force is:",
    options: [{key:"A",text:"−8 J"},{key:"B",text:"−16 J"},{key:"C",text:"−4 J"},{key:"D",text:"−32 J"}],
    correct: "B",
    explanation: "W = ΔKE = 0 − ½(2)(16) = −16 J.",
  },
  {
    id: "p4", subject: "Physics", topic: "Rotational Motion", subtopic: "Moment of inertia", difficulty: 4, expectedTimeSec: 150,
    question: "Moment of inertia of a uniform rod (mass M, length L) about an axis through one end ⟂ to length:",
    options: [{key:"A",text:"ML²/12"},{key:"B",text:"ML²/6"},{key:"C",text:"ML²/3"},{key:"D",text:"ML²/2"}],
    correct: "C",
    explanation: "Parallel axis: I = I_cm + Md² = ML²/12 + M(L/2)² = ML²/3.",
  },
  {
    id: "p5", subject: "Physics", topic: "Gravitation", subtopic: "Orbital velocity", difficulty: 3, expectedTimeSec: 120,
    question: "Escape velocity from Earth's surface (R = 6.4×10⁶ m, g = 9.8) is approximately:",
    options: [{key:"A",text:"7.9 km/s"},{key:"B",text:"11.2 km/s"},{key:"C",text:"15.0 km/s"},{key:"D",text:"22.4 km/s"}],
    correct: "B",
    explanation: "v_e = √(2gR) ≈ 11.2 km/s.",
  },
  {
    id: "p6", subject: "Physics", topic: "Thermodynamics", subtopic: "First law", difficulty: 3, expectedTimeSec: 120,
    question: "In an isothermal expansion of an ideal gas:",
    options: [{key:"A",text:"ΔU > 0"},{key:"B",text:"ΔU = 0"},{key:"C",text:"Q = 0"},{key:"D",text:"W = 0"}],
    correct: "B",
    explanation: "Internal energy of an ideal gas depends only on T; isothermal ⇒ ΔU = 0.",
  },
  {
    id: "p7", subject: "Physics", topic: "Oscillations", subtopic: "SHM", difficulty: 3, expectedTimeSec: 120,
    question: "A particle in SHM has amplitude A. KE equals PE at displacement:",
    options: [{key:"A",text:"A/2"},{key:"B",text:"A/√2"},{key:"C",text:"A/√3"},{key:"D",text:"A"}],
    correct: "B",
    explanation: "½k(A²−x²) = ½kx² ⇒ x = A/√2.",
  },
  {
    id: "p8", subject: "Physics", topic: "Waves", subtopic: "Doppler effect", difficulty: 3, expectedTimeSec: 120,
    question: "A source of frequency 500 Hz moves toward a stationary observer at 30 m/s (v_sound = 330 m/s). Observed frequency:",
    options: [{key:"A",text:"≈ 455 Hz"},{key:"B",text:"≈ 500 Hz"},{key:"C",text:"≈ 550 Hz"},{key:"D",text:"≈ 600 Hz"}],
    correct: "C",
    explanation: "f' = f × v/(v−v_s) = 500 × 330/300 = 550 Hz.",
  },
  {
    id: "p9", subject: "Physics", topic: "Electrostatics", subtopic: "Coulomb's law", difficulty: 2, expectedTimeSec: 90,
    question: "Force between two point charges is F. If the distance is doubled and each charge is halved, the new force is:",
    options: [{key:"A",text:"F/4"},{key:"B",text:"F/8"},{key:"C",text:"F/16"},{key:"D",text:"F/32"}],
    correct: "C",
    explanation: "F ∝ q₁q₂/r²; (½×½)/(2)² = 1/16.",
  },
  {
    id: "p10", subject: "Physics", topic: "Current Electricity", subtopic: "Ohm's law", difficulty: 2, expectedTimeSec: 90,
    question: "Three 6 Ω resistors in parallel give equivalent resistance:",
    options: [{key:"A",text:"18 Ω"},{key:"B",text:"6 Ω"},{key:"C",text:"3 Ω"},{key:"D",text:"2 Ω"}],
    correct: "D",
    explanation: "1/R = 3/6 = 1/2 ⇒ R = 2 Ω.",
  },
  {
    id: "p11", subject: "Physics", topic: "Magnetism", subtopic: "Force on charge", difficulty: 3, expectedTimeSec: 120,
    question: "A charge q moves with velocity v parallel to a uniform magnetic field B. Magnetic force is:",
    options: [{key:"A",text:"qvB"},{key:"B",text:"qvB/2"},{key:"C",text:"0"},{key:"D",text:"2qvB"}],
    correct: "C",
    explanation: "F = qv × B; v ∥ B ⇒ sinθ = 0.",
  },
  {
    id: "p12", subject: "Physics", topic: "EM Induction", subtopic: "Faraday's law", difficulty: 3, expectedTimeSec: 120,
    question: "Magnetic flux through a coil changes from 6 mWb to 1 mWb in 0.1 s. Induced EMF:",
    options: [{key:"A",text:"5 mV"},{key:"B",text:"50 mV"},{key:"C",text:"500 mV"},{key:"D",text:"5 V"}],
    correct: "B",
    explanation: "ε = −dΦ/dt = 5 mWb / 0.1 s = 50 mV.",
  },
  {
    id: "p13", subject: "Physics", topic: "Optics", subtopic: "Lenses", difficulty: 3, expectedTimeSec: 120,
    question: "Object 30 cm in front of a convex lens of focal length 20 cm. Image distance:",
    options: [{key:"A",text:"+60 cm"},{key:"B",text:"+12 cm"},{key:"C",text:"−60 cm"},{key:"D",text:"+30 cm"}],
    correct: "A",
    explanation: "1/v − 1/(−30) = 1/20 ⇒ v = +60 cm.",
  },
  {
    id: "p14", subject: "Physics", topic: "Modern Physics", subtopic: "Photoelectric effect", difficulty: 3, expectedTimeSec: 120,
    question: "Threshold frequency of a metal is ν₀. Light of frequency 2ν₀ ejects photoelectrons with max KE:",
    options: [{key:"A",text:"hν₀"},{key:"B",text:"2hν₀"},{key:"C",text:"hν₀/2"},{key:"D",text:"0"}],
    correct: "A",
    explanation: "KE_max = h(ν − ν₀) = h(2ν₀ − ν₀) = hν₀.",
  },
  {
    id: "p15", subject: "Physics", topic: "Modern Physics", subtopic: "Nuclear physics", difficulty: 2, expectedTimeSec: 90,
    question: "Half-life of a radioactive sample is 20 min. Fraction remaining after 1 hour:",
    options: [{key:"A",text:"1/2"},{key:"B",text:"1/4"},{key:"C",text:"1/8"},{key:"D",text:"1/16"}],
    correct: "C",
    explanation: "3 half-lives ⇒ (1/2)³ = 1/8.",
  },
  {
    id: "p16", subject: "Physics", topic: "Fluid Mechanics", subtopic: "Bernoulli", difficulty: 3, expectedTimeSec: 120,
    question: "Velocity of efflux from a hole at depth h below water surface (open tank):",
    options: [{key:"A",text:"√(gh)"},{key:"B",text:"√(2gh)"},{key:"C",text:"2√(gh)"},{key:"D",text:"gh"}],
    correct: "B",
    explanation: "Torricelli: v = √(2gh).",
  },

  // ── CHEMISTRY ─────────────────────────────────────────────────────────────
  {
    id: "c1", subject: "Chemistry", topic: "Mole Concept", subtopic: "Stoichiometry", difficulty: 2, expectedTimeSec: 90,
    question: "Number of moles in 11 g of CO₂ (M = 44 g/mol):",
    options: [{key:"A",text:"0.25"},{key:"B",text:"0.5"},{key:"C",text:"1"},{key:"D",text:"2"}],
    correct: "A",
    explanation: "n = 11/44 = 0.25 mol.",
  },
  {
    id: "c2", subject: "Chemistry", topic: "Atomic Structure", subtopic: "Quantum numbers", difficulty: 3, expectedTimeSec: 120,
    question: "Which set of quantum numbers is NOT allowed?",
    options: [{key:"A",text:"n=2, l=1, m=0"},{key:"B",text:"n=3, l=2, m=−2"},{key:"C",text:"n=2, l=2, m=0"},{key:"D",text:"n=4, l=3, m=+3"}],
    correct: "C",
    explanation: "l ≤ n−1; for n=2, l_max = 1.",
  },
  {
    id: "c3", subject: "Chemistry", topic: "Chemical Bonding", subtopic: "Hybridisation", difficulty: 3, expectedTimeSec: 120,
    question: "Hybridisation of central atom in SF₆:",
    options: [{key:"A",text:"sp³"},{key:"B",text:"sp³d"},{key:"C",text:"sp³d²"},{key:"D",text:"sp³d³"}],
    correct: "C",
    explanation: "6 bond pairs ⇒ sp³d² (octahedral).",
  },
  {
    id: "c4", subject: "Chemistry", topic: "Thermodynamics", subtopic: "Enthalpy", difficulty: 3, expectedTimeSec: 120,
    question: "For an exothermic reaction at constant P, which is true?",
    options: [{key:"A",text:"ΔH > 0"},{key:"B",text:"ΔH < 0"},{key:"C",text:"ΔH = 0"},{key:"D",text:"ΔU > 0 always"}],
    correct: "B",
    explanation: "Exothermic ⇒ heat released ⇒ ΔH < 0.",
  },
  {
    id: "c5", subject: "Chemistry", topic: "Equilibrium", subtopic: "Kc and Kp", difficulty: 3, expectedTimeSec: 120,
    question: "For N₂(g) + 3H₂(g) ⇌ 2NH₃(g), Kp and Kc relation:",
    options: [{key:"A",text:"Kp = Kc"},{key:"B",text:"Kp = Kc(RT)"},{key:"C",text:"Kp = Kc(RT)⁻²"},{key:"D",text:"Kp = Kc(RT)²"}],
    correct: "C",
    explanation: "Δn = 2 − 4 = −2 ⇒ Kp = Kc(RT)⁻².",
  },
  {
    id: "c6", subject: "Chemistry", topic: "Ionic Equilibrium", subtopic: "pH", difficulty: 2, expectedTimeSec: 90,
    question: "pH of 0.01 M HCl solution:",
    options: [{key:"A",text:"1"},{key:"B",text:"2"},{key:"C",text:"3"},{key:"D",text:"7"}],
    correct: "B",
    explanation: "[H⁺] = 0.01 ⇒ pH = 2.",
  },
  {
    id: "c7", subject: "Chemistry", topic: "Redox", subtopic: "Oxidation state", difficulty: 2, expectedTimeSec: 90,
    question: "Oxidation state of Mn in KMnO₄:",
    options: [{key:"A",text:"+2"},{key:"B",text:"+4"},{key:"C",text:"+6"},{key:"D",text:"+7"}],
    correct: "D",
    explanation: "+1 + x + 4(−2) = 0 ⇒ x = +7.",
  },
  {
    id: "c8", subject: "Chemistry", topic: "Electrochemistry", subtopic: "Nernst equation", difficulty: 4, expectedTimeSec: 150,
    question: "Standard EMF of a cell is 1.10 V. If concentrations are at standard state, cell EMF is:",
    options: [{key:"A",text:"0 V"},{key:"B",text:"1.10 V"},{key:"C",text:"depends on T"},{key:"D",text:"−1.10 V"}],
    correct: "B",
    explanation: "At standard state, Q = 1, log Q = 0 ⇒ E = E°.",
  },
  {
    id: "c9", subject: "Chemistry", topic: "Chemical Kinetics", subtopic: "Order of reaction", difficulty: 3, expectedTimeSec: 120,
    question: "For a first-order reaction, half-life is:",
    options: [{key:"A",text:"depends on [A]₀"},{key:"B",text:"= 0.693/k"},{key:"C",text:"= 1/(k[A]₀)"},{key:"D",text:"= k/0.693"}],
    correct: "B",
    explanation: "t½ = ln 2 / k = 0.693/k (independent of [A]₀).",
  },
  {
    id: "c10", subject: "Chemistry", topic: "p-block", subtopic: "Group 15", difficulty: 3, expectedTimeSec: 120,
    question: "Which is the strongest reducing agent among NH₃, PH₃, AsH₃, BiH₃?",
    options: [{key:"A",text:"NH₃"},{key:"B",text:"PH₃"},{key:"C",text:"AsH₃"},{key:"D",text:"BiH₃"}],
    correct: "D",
    explanation: "Bond strength decreases down the group; BiH₃ most unstable ⇒ strongest reducer.",
  },
  {
    id: "c11", subject: "Chemistry", topic: "Coordination Compounds", subtopic: "Nomenclature", difficulty: 3, expectedTimeSec: 120,
    question: "Coordination number of cobalt in [Co(en)₂Cl₂]⁺ (en = ethylenediamine):",
    options: [{key:"A",text:"4"},{key:"B",text:"5"},{key:"C",text:"6"},{key:"D",text:"7"}],
    correct: "C",
    explanation: "2 bidentate en (×2) + 2 Cl = 6.",
  },
  {
    id: "c12", subject: "Chemistry", topic: "Organic - GOC", subtopic: "Inductive effect", difficulty: 3, expectedTimeSec: 120,
    question: "Strongest acid among the following:",
    options: [{key:"A",text:"CH₃COOH"},{key:"B",text:"ClCH₂COOH"},{key:"C",text:"Cl₂CHCOOH"},{key:"D",text:"Cl₃CCOOH"}],
    correct: "D",
    explanation: "More −I groups stabilise carboxylate ⇒ trichloroacetic acid strongest.",
  },
  {
    id: "c13", subject: "Chemistry", topic: "Hydrocarbons", subtopic: "Alkenes", difficulty: 2, expectedTimeSec: 90,
    question: "Markovnikov addition of HBr to propene gives:",
    options: [{key:"A",text:"1-bromopropane"},{key:"B",text:"2-bromopropane"},{key:"C",text:"1,2-dibromopropane"},{key:"D",text:"propane"}],
    correct: "B",
    explanation: "H adds to C with more H; Br to more-substituted C ⇒ 2-bromopropane.",
  },
  {
    id: "c14", subject: "Chemistry", topic: "Haloalkanes", subtopic: "SN1/SN2", difficulty: 4, expectedTimeSec: 150,
    question: "Which substrate reacts fastest by SN1?",
    options: [{key:"A",text:"CH₃Cl"},{key:"B",text:"CH₃CH₂Cl"},{key:"C",text:"(CH₃)₂CHCl"},{key:"D",text:"(CH₃)₃CCl"}],
    correct: "D",
    explanation: "Tertiary carbocation is most stable ⇒ fastest SN1.",
  },
  {
    id: "c15", subject: "Chemistry", topic: "Aldehydes & Ketones", subtopic: "Reactions", difficulty: 3, expectedTimeSec: 120,
    question: "Tollen's reagent gives a positive test with:",
    options: [{key:"A",text:"Acetone"},{key:"B",text:"Benzaldehyde"},{key:"C",text:"Diethyl ether"},{key:"D",text:"Ethanol"}],
    correct: "B",
    explanation: "Aldehydes reduce Ag⁺ to Ag (silver mirror); ketones do not.",
  },
  {
    id: "c16", subject: "Chemistry", topic: "Biomolecules", subtopic: "Carbohydrates", difficulty: 2, expectedTimeSec: 90,
    question: "Glucose and fructose are:",
    options: [{key:"A",text:"Enantiomers"},{key:"B",text:"Anomers"},{key:"C",text:"Functional isomers"},{key:"D",text:"Identical"}],
    correct: "C",
    explanation: "Glucose is an aldose, fructose is a ketose — functional isomers (C₆H₁₂O₆).",
  },

  // ── MATHS ─────────────────────────────────────────────────────────────────
  {
    id: "m1", subject: "Maths", topic: "Quadratic Equations", subtopic: "Roots", difficulty: 2, expectedTimeSec: 90,
    question: "Sum of roots of 2x² − 5x + 3 = 0:",
    options: [{key:"A",text:"3/2"},{key:"B",text:"5/2"},{key:"C",text:"−5/2"},{key:"D",text:"−3/2"}],
    correct: "B",
    explanation: "Sum = −b/a = 5/2.",
  },
  {
    id: "m2", subject: "Maths", topic: "Sequences & Series", subtopic: "AP", difficulty: 2, expectedTimeSec: 90,
    question: "10th term of AP 3, 7, 11, … :",
    options: [{key:"A",text:"35"},{key:"B",text:"39"},{key:"C",text:"43"},{key:"D",text:"47"}],
    correct: "B",
    explanation: "a + 9d = 3 + 36 = 39.",
  },
  {
    id: "m3", subject: "Maths", topic: "Trigonometry", subtopic: "Identities", difficulty: 2, expectedTimeSec: 90,
    question: "sin 75° + sin 15° equals:",
    options: [{key:"A",text:"√3/2"},{key:"B",text:"√6/2"},{key:"C",text:"1"},{key:"D",text:"√2"}],
    correct: "B",
    explanation: "= 2 sin 45° cos 30° = 2·(√2/2)·(√3/2) = √6/2.",
  },
  {
    id: "m4", subject: "Maths", topic: "Complex Numbers", subtopic: "Argand plane", difficulty: 3, expectedTimeSec: 120,
    question: "|1 + i|⁴ equals:",
    options: [{key:"A",text:"2"},{key:"B",text:"4"},{key:"C",text:"8"},{key:"D",text:"16"}],
    correct: "B",
    explanation: "|1+i| = √2; (√2)⁴ = 4.",
  },
  {
    id: "m5", subject: "Maths", topic: "Permutations & Combinations", subtopic: "Combinations", difficulty: 3, expectedTimeSec: 120,
    question: "Number of ways to choose 3 students from 8:",
    options: [{key:"A",text:"24"},{key:"B",text:"56"},{key:"C",text:"112"},{key:"D",text:"336"}],
    correct: "B",
    explanation: "C(8,3) = 56.",
  },
  {
    id: "m6", subject: "Maths", topic: "Binomial Theorem", subtopic: "General term", difficulty: 3, expectedTimeSec: 120,
    question: "Coefficient of x³ in (1 + x)⁶:",
    options: [{key:"A",text:"15"},{key:"B",text:"20"},{key:"C",text:"30"},{key:"D",text:"60"}],
    correct: "B",
    explanation: "C(6,3) = 20.",
  },
  {
    id: "m7", subject: "Maths", topic: "Matrices", subtopic: "Determinants", difficulty: 3, expectedTimeSec: 120,
    question: "If A is a 3×3 matrix with |A| = 4, then |2A| =",
    options: [{key:"A",text:"8"},{key:"B",text:"16"},{key:"C",text:"32"},{key:"D",text:"64"}],
    correct: "C",
    explanation: "|kA| = kⁿ|A| = 2³·4 = 32.",
  },
  {
    id: "m8", subject: "Maths", topic: "Limits", subtopic: "Standard limits", difficulty: 2, expectedTimeSec: 90,
    question: "lim x→0 (sin 3x)/x equals:",
    options: [{key:"A",text:"1"},{key:"B",text:"3"},{key:"C",text:"1/3"},{key:"D",text:"0"}],
    correct: "B",
    explanation: "(sin 3x)/x = 3·(sin 3x)/(3x) → 3.",
  },
  {
    id: "m9", subject: "Maths", topic: "Differentiation", subtopic: "Chain rule", difficulty: 3, expectedTimeSec: 120,
    question: "d/dx [sin(x²)] equals:",
    options: [{key:"A",text:"cos(x²)"},{key:"B",text:"2x cos(x²)"},{key:"C",text:"−2x cos(x²)"},{key:"D",text:"2x sin(x²)"}],
    correct: "B",
    explanation: "Chain rule: cos(x²)·2x.",
  },
  {
    id: "m10", subject: "Maths", topic: "Application of Derivatives", subtopic: "Maxima/minima", difficulty: 3, expectedTimeSec: 120,
    question: "Max value of f(x) = 4x − x² is:",
    options: [{key:"A",text:"2"},{key:"B",text:"4"},{key:"C",text:"6"},{key:"D",text:"8"}],
    correct: "B",
    explanation: "f'(x) = 4 − 2x = 0 ⇒ x = 2; f(2) = 4.",
  },
  {
    id: "m11", subject: "Maths", topic: "Integration", subtopic: "Indefinite", difficulty: 2, expectedTimeSec: 90,
    question: "∫ (1/x) dx (x > 0) equals:",
    options: [{key:"A",text:"x² / 2 + C"},{key:"B",text:"ln|x| + C"},{key:"C",text:"−1/x² + C"},{key:"D",text:"eˣ + C"}],
    correct: "B",
    explanation: "Standard integral: ln|x| + C.",
  },
  {
    id: "m12", subject: "Maths", topic: "Definite Integration", subtopic: "Area", difficulty: 3, expectedTimeSec: 120,
    question: "∫₀^π sin x dx =",
    options: [{key:"A",text:"0"},{key:"B",text:"1"},{key:"C",text:"2"},{key:"D",text:"π"}],
    correct: "C",
    explanation: "[−cos x]₀^π = −(−1) − (−1) = 2.",
  },
  {
    id: "m13", subject: "Maths", topic: "Differential Equations", subtopic: "Order/degree", difficulty: 3, expectedTimeSec: 120,
    question: "Order and degree of (d²y/dx²)³ + (dy/dx)² + y = 0 :",
    options: [{key:"A",text:"2, 3"},{key:"B",text:"3, 2"},{key:"C",text:"2, 2"},{key:"D",text:"3, 3"}],
    correct: "A",
    explanation: "Highest derivative is 2nd order; power of highest derivative = 3 ⇒ degree 3.",
  },
  {
    id: "m14", subject: "Maths", topic: "Vectors", subtopic: "Dot product", difficulty: 2, expectedTimeSec: 90,
    question: "If a = 2i + 3j + k and b = i − j + 2k, a·b =",
    options: [{key:"A",text:"−1"},{key:"B",text:"1"},{key:"C",text:"3"},{key:"D",text:"5"}],
    correct: "B",
    explanation: "2 − 3 + 2 = 1.",
  },
  {
    id: "m15", subject: "Maths", topic: "3D Geometry", subtopic: "Line and plane", difficulty: 3, expectedTimeSec: 120,
    question: "Distance of point (1, 2, 3) from plane 2x − y + 2z = 5 :",
    options: [{key:"A",text:"1"},{key:"B",text:"2"},{key:"C",text:"3"},{key:"D",text:"4/3"}],
    correct: "A",
    explanation: "|2 − 2 + 6 − 5|/√9 = 1.",
  },
  {
    id: "m16", subject: "Maths", topic: "Probability", subtopic: "Conditional", difficulty: 3, expectedTimeSec: 120,
    question: "A fair die is rolled. Probability of getting an even prime:",
    options: [{key:"A",text:"0"},{key:"B",text:"1/6"},{key:"C",text:"1/3"},{key:"D",text:"1/2"}],
    correct: "B",
    explanation: "Only 2 is an even prime ⇒ 1/6.",
  },
  {
    id: "m17", subject: "Maths", topic: "Conic Sections", subtopic: "Circle", difficulty: 2, expectedTimeSec: 90,
    question: "Radius of x² + y² − 4x + 6y − 12 = 0 :",
    options: [{key:"A",text:"3"},{key:"B",text:"4"},{key:"C",text:"5"},{key:"D",text:"6"}],
    correct: "C",
    explanation: "Centre (2,−3); r = √(4 + 9 + 12) = 5.",
  },

  // ── BIOLOGY (for NEET-style tests) ────────────────────────────────────────
  {
    id: "b1", subject: "Biology", topic: "Cell Biology", subtopic: "Cell organelles", difficulty: 2, expectedTimeSec: 90,
    question: "Powerhouse of the cell is:",
    options: [{key:"A",text:"Ribosome"},{key:"B",text:"Mitochondrion"},{key:"C",text:"Lysosome"},{key:"D",text:"Golgi body"}],
    correct: "B",
    explanation: "Mitochondria produce ATP via oxidative phosphorylation.",
  },
  {
    id: "b2", subject: "Biology", topic: "Genetics", subtopic: "Mendel", difficulty: 3, expectedTimeSec: 120,
    question: "In a monohybrid cross of Tt × Tt, phenotypic ratio is:",
    options: [{key:"A",text:"1:1"},{key:"B",text:"3:1"},{key:"C",text:"1:2:1"},{key:"D",text:"9:3:3:1"}],
    correct: "B",
    explanation: "Classic Mendelian 3:1 (dominant:recessive).",
  },
  {
    id: "b3", subject: "Biology", topic: "Human Physiology", subtopic: "Circulation", difficulty: 2, expectedTimeSec: 90,
    question: "Normal human heart rate at rest is approximately:",
    options: [{key:"A",text:"30/min"},{key:"B",text:"72/min"},{key:"C",text:"120/min"},{key:"D",text:"200/min"}],
    correct: "B",
    explanation: "Resting HR ≈ 72 beats/min.",
  },
  {
    id: "b4", subject: "Biology", topic: "Plant Physiology", subtopic: "Photosynthesis", difficulty: 3, expectedTimeSec: 120,
    question: "Site of the light reaction of photosynthesis:",
    options: [{key:"A",text:"Stroma"},{key:"B",text:"Thylakoid membrane"},{key:"C",text:"Mitochondrial matrix"},{key:"D",text:"Cytoplasm"}],
    correct: "B",
    explanation: "Light reaction occurs in the thylakoid membranes of chloroplasts.",
  },
  {
    id: "b5", subject: "Biology", topic: "Ecology", subtopic: "Ecosystem", difficulty: 2, expectedTimeSec: 90,
    question: "10% of energy passes from one trophic level to the next. This is:",
    options: [{key:"A",text:"Allen's rule"},{key:"B",text:"Lindeman's law"},{key:"C",text:"Gause's principle"},{key:"D",text:"Bergmann's rule"}],
    correct: "B",
    explanation: "Lindeman's 10% law of energy transfer.",
  },
  {
    id: "b6", subject: "Biology", topic: "Reproduction", subtopic: "Human reproduction", difficulty: 3, expectedTimeSec: 120,
    question: "Fertilisation in humans normally occurs in the:",
    options: [{key:"A",text:"Uterus"},{key:"B",text:"Ovary"},{key:"C",text:"Ampulla of fallopian tube"},{key:"D",text:"Cervix"}],
    correct: "C",
    explanation: "Sperm meets ovum in the ampullary-isthmic junction.",
  },
];

// ── Sampling: build a paper of N questions with subject quotas ──────────────

export type PaperPattern = {
  totalMarks: 100 | 120 | 160;
  marksPerCorrect: number;     // JEE: +4
  negativeMarks: number;       // JEE: −1
  totalQuestions: number;
  durationMin: number;
  // subject -> number of questions
  distribution: Record<string, number>;
  label: string;
  description: string;
};

export const PAPER_PATTERNS: Record<string, PaperPattern> = {
  "100": {
    totalMarks: 100,
    marksPerCorrect: 4,
    negativeMarks: 1,
    totalQuestions: 25,
    durationMin: 60,
    distribution: { Physics: 9, Chemistry: 8, Maths: 8 },
    label: "Chapter Sprint · 100 marks",
    description: "25 Qs · 60 min · +4 / −1 · Physics 9 · Chem 8 · Maths 8",
  },
  "120": {
    totalMarks: 120,
    marksPerCorrect: 4,
    negativeMarks: 1,
    totalQuestions: 30,
    durationMin: 75,
    distribution: { Physics: 10, Chemistry: 10, Maths: 10 },
    label: "Sectional · 120 marks",
    description: "30 Qs · 75 min · +4 / −1 · 10 per subject",
  },
  "160": {
    totalMarks: 160,
    marksPerCorrect: 4,
    negativeMarks: 1,
    totalQuestions: 40,
    durationMin: 90,
    distribution: { Physics: 13, Chemistry: 13, Maths: 14 },
    label: "Half-length Mock · 160 marks",
    description: "40 Qs · 90 min · +4 / −1 · Phy 13 · Chem 13 · Maths 14",
  },
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pick `n` distinct questions for the given subject from the bank.
 *  If the bank doesn't have enough for that subject, top up from any subject
 *  so the paper still has the right total length. */
export function assemblePaper(pattern: PaperPattern): MCQ[] {
  const chosen: MCQ[] = [];
  const usedIds = new Set<string>();

  for (const [subject, count] of Object.entries(pattern.distribution)) {
    const pool = shuffle(QUESTION_BANK.filter((q) => q.subject === subject && !usedIds.has(q.id)));
    for (const q of pool.slice(0, count)) {
      chosen.push(q);
      usedIds.add(q.id);
    }
  }

  // Top up if bank ran short for any subject
  if (chosen.length < pattern.totalQuestions) {
    const extras = shuffle(QUESTION_BANK.filter((q) => !usedIds.has(q.id)));
    for (const q of extras) {
      if (chosen.length >= pattern.totalQuestions) break;
      chosen.push(q);
      usedIds.add(q.id);
    }
  }

  return shuffle(chosen);
}
