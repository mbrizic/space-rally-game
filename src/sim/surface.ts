export type Surface = {
  name: "tarmac" | "gravel" | "ice" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

export function surfaceForTrackSM(totalLengthM: number, sM: number, offTrack: boolean): Surface {
  if (offTrack) {
    return { name: "offtrack", frictionMu: 0.62, rollingResistanceN: 950 };
  }

  const quarter = totalLengthM * 0.25;
  if (sM < quarter) return { name: "tarmac", frictionMu: 1.05, rollingResistanceN: 260 };
  if (sM < quarter * 2) return { name: "gravel", frictionMu: 0.78, rollingResistanceN: 520 };
  if (sM < quarter * 3) return { name: "tarmac", frictionMu: 1.0, rollingResistanceN: 280 };
  return { name: "ice", frictionMu: 0.28, rollingResistanceN: 180 };
}

