/**
 * Exam Weightage Data
 * Average weightage per topic based on recent previous year question papers.
 */

export const JEE_WEIGHTAGE: Record<string, Record<string, number>> = {
  Physics: {
    "Mechanics": 25,
    "Electromagnetism": 25,
    "Modern Physics": 15,
    "Optics": 10,
    "Thermodynamics": 10,
    "Properties of Matter": 5,
    "Oscillations and Waves": 5,
    "General": 5
  },
  Chemistry: {
    "Physical Chemistry": 35,
    "Organic Chemistry": 35,
    "Inorganic Chemistry": 30,
    "General": 5
  },
  Maths: {
    "Calculus": 30,
    "Algebra": 25,
    "Coordinate Geometry": 20,
    "Trigonometry": 10,
    "Vectors and 3D": 10,
    "General": 5
  }
};

export const NEET_WEIGHTAGE: Record<string, Record<string, number>> = {
  Physics: {
    "Mechanics": 30,
    "Electrodynamics": 25,
    "Modern Physics": 15,
    "Optics": 10,
    "Thermodynamics": 10,
    "Properties of Matter": 5,
    "SHM and Waves": 5,
    "General": 5
  },
  Chemistry: {
    "Physical Chemistry": 30,
    "Organic Chemistry": 35,
    "Inorganic Chemistry": 35,
    "General": 5
  },
  Biology: {
    "Human Physiology": 20,
    "Genetics and Evolution": 15,
    "Ecology": 12,
    "Plant Physiology": 12,
    "Cell Biology": 10,
    "Diversity of Living Organisms": 10,
    "Reproduction": 9,
    "Biology in Human Welfare": 7,
    "Structural Organisation": 5,
    "General": 5
  }
};

/**
 * Returns the exam weightage (in percentage) for a given topic.
 * Defaults to 5% if not found.
 */
export function getWeightage(exam: string, subject: string, topic: string): number {
  const isNeet = exam.toLowerCase() === "neet";
  const data = isNeet ? NEET_WEIGHTAGE : JEE_WEIGHTAGE;
  
  if (data[subject] && data[subject][topic] !== undefined) {
    return data[subject][topic];
  }
  
  // Fallback heuristic for broad matching or default
  return 5;
}
