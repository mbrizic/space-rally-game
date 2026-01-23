export type Surface = {
  name: "tarmac" | "gravel" | "dirt" | "offtrack";
  frictionMu: number;
  rollingResistanceN: number;
};

export function surfaceForTrackSM(totalLengthM: number, sM: number, offTrack: boolean): Surface {
  if (offTrack) {
    return { name: "offtrack", frictionMu: 0.55, rollingResistanceN: 950 };
  }

  const t = (sM % totalLengthM) / totalLengthM;
  if (t < 0.16) return { name: "tarmac", frictionMu: 1.18, rollingResistanceN: 210 };
  if (t < 0.34) return { name: "gravel", frictionMu: 0.92, rollingResistanceN: 430 };
  if (t < 0.52) return { name: "tarmac", frictionMu: 1.15, rollingResistanceN: 225 };
  if (t < 0.74) return { name: "dirt", frictionMu: 0.82, rollingResistanceN: 520 };
  if (t < 0.86) return { name: "gravel", frictionMu: 0.90, rollingResistanceN: 450 };
  return { name: "tarmac", frictionMu: 1.16, rollingResistanceN: 215 };
}
