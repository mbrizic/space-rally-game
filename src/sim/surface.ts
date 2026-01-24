export type Surface = {
  name: "tarmac" | "gravel" | "dirt" | "ice" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

export function surfaceForTrackSM(totalLengthM: number, sM: number, offTrack: boolean): Surface {
  if (offTrack) {
    return { name: "offtrack", frictionMu: 0.55, rollingResistanceN: 950 };
  }

  const t = (sM % totalLengthM) / totalLengthM;
  if (t < 0.14) return { name: "tarmac", frictionMu: 1.18, rollingResistanceN: 210 };
  if (t < 0.16) return { name: "ice", frictionMu: 0.35, rollingResistanceN: 150 };
  if (t < 0.32) return { name: "gravel", frictionMu: 0.92, rollingResistanceN: 430 };
  if (t < 0.48) return { name: "tarmac", frictionMu: 1.15, rollingResistanceN: 225 };
  if (t < 0.50) return { name: "ice", frictionMu: 0.35, rollingResistanceN: 150 };
  if (t < 0.68) return { name: "dirt", frictionMu: 0.82, rollingResistanceN: 520 };
  if (t < 0.82) return { name: "gravel", frictionMu: 0.90, rollingResistanceN: 450 };
  if (t < 0.84) return { name: "ice", frictionMu: 0.35, rollingResistanceN: 150 };
  return { name: "tarmac", frictionMu: 1.16, rollingResistanceN: 215 };
}
